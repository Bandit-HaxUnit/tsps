# Giving up on a target you cannot reach

An actor in combat holds its target and stops doing anything else with it: it faces it, walks to
it and swings when `CombatRange.canReach` allows. Live OSRS ends that engagement when the actor
cannot get to its target at all - the reply is `I can't reach that!` and the interaction is
dropped, the same answer a frozen player gets for an object or NPC out of reach
([freezes.md](freezes.md), recording 2238).

## The bug

`Combat.postMovementProcess` holds the two give-up paths, and both are skippable:

```ts
if (targetMoved || state.mobilityBlocked || movement.didMoveThisCycle()) return;   // (1)
if (this.character.isNpc() && state.routeRequested &&
    !movement.wasBlockedByDynamicOccupancy()) { cancelIfCurrent(...); return; }    // (2)
if (movement.size() > 0) return;                                                   // (3)
if (this.character.isPlayer() && (state.routeRequested || movement.wasRouteEvaluated())) { ... }
```

- An actor that **cannot move** - stunned, `isNeedsPlacement()`, or a teleport in transit
  (`MovementQueue.setBlockMovement`, `TeleportHandler`) - sets `mobilityBlocked` and is returned by
  (1) every cycle. Only the frozen *player* had its own release, in `preMovementProcess`.
- A step the mover **rejects** keeps its checkpoint (`MovementQueue.process`, "checkpoint retained"),
  so `movement.size()` never drops to 0 and (3) returns before the player's release. A pursuit
  blocked by another entity is exempted at (2) by design, and stays exempt for as long as the
  blocker stays.

Either way the actor stays in combat with a target it can never hit, for as long as the fight
lasts: `CombatFactory.inCombat` stays true, which holds teleports ("You can't use this spell
during combat."), emotes, shops, `::setlevel` and `NpcAggression` for that player; the NPC never
releases either, so it never sleeps (`DormantNpcs`) and stays in the active-region set
(`World.markNpcCombatActive`).

## The rule

`Combat.giveUpUnreachableTarget` runs in `preMovementProcess` on every cycle spent out of reach and
counts the cycles in which **the gap did not close**. Closing it is progress whoever does it, so a
fighter walking its target down, or being walked down, keeps its interaction; moving without
getting nearer - walking into a wall, shuffling against a crowd - does not. At 20 cycles (10 s) the
engagement is dropped: a player is told `I can't reach that!` and both sides `reset()` as any other
give-up does. Player bots are not messaged, matching the existing release.

The two pre-existing releases are untouched and still fire first, so a normal "attack something
behind a fence" click is refused on the spot rather than after the deadline.

## Sources

Dropping an interaction that cannot be reached, answered with `I can't reach that!`, is the rule
this server already follows for both players and interactions: [freezes.md](freezes.md) (rsprox
recording 2238 - a frozen player's far clicks get the reply "and are dropped, not queued"),
[sea-charting.md](sea-charting.md) (rsprox 3455 - a loc used from a deck but out of reach "no
longer lets go of the helm: live answers 'I can't reach that!' and nothing else") and
[loc-teleports.md](loc-teleports.md). The deadline extends that same rule to the two states where
the existing releases could not run; it introduces no new message.

## Validation

- `node --test server/tests/unreachable-combat.test.cjs` (after `yarn build`): seven tests. Three
  fail without the deadline, on the reproductions: a `setBlockMovement` player and a
  `setBlockMovement` npc, each 18 tiles from a target neither can approach, keep their target (and
  `CombatFactory.inCombat`) indefinitely; and an npc stepped back onto the same tile every cycle -
  taking a step and getting no nearer, which is what a wall or a crowd looks like to the pursuit -
  hunts forever. The other four pin down what must *not* change: a fighter still closing the gap
  keeps its target, an immobile actor keeps a target that comes to them, a fight in reach is never
  dropped, and a player with no route is refused on the first cycle.
- Own-worktree agent MCP (`AGENT_MCP=1 yarn dev`, port 49700): fought a grizzly bear at the Gnome
  Stronghold pen and walked 25 tiles away - combat and `busy` clear, logout accepted; aggroed a
  white wolf at Edgeville and stood inside its footprint - both sides land hits, the fight ends
  normally; teleported 25 tiles from a bear mid-chase - the bear walks back to its post and drops
  the target, the player is not left in combat.
- `yarn build` clean, and the full server suite: 9,835 tests, 9,834 pass. The single failure is
  pre-existing and unrelated: `tests/league-combat-masteries.test.cjs:15` requires
  `../dist/game/entity/impl/npc/Npc` while tsc emits `NPC.js`, so the file cannot load on a
  case-sensitive filesystem. It fails identically at HEAD, before any combat code runs.

## Not changed

- **The logout gate is separate and still hit-based.** `Player.inLogoutCombat` refuses with "You
  can't log out until 10 seconds after the end of combat." only while a hit landed within 16
  cycles (`Player.LOGOUT_COMBAT_TICKS`), and a hit requires `CombatRange.canReach` at the moment the
  attack is launched. Nothing in this change alters that: an NPC that genuinely can hit you still
  holds you out of logging out, as live does. So a report of *that* message repeating forever means
  hits are landing from somewhere - a spot where the reach check passes (an open shared edge or
  projectile line in the clipping) although the NPC cannot walk there, which is a map/clipping
  question with its own fix, not this one.
- `combat:close-in` NPCs still walk in while attacking from range, and `processNpcUnderTarget`
  still shuffles an overlapped NPC aside; the deadline only fires if neither makes progress.
- The 20-cycle budget is a safety net for the states above. The ordinary unreachable-target release
  happens in one or two cycles, as before.
