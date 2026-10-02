# Tombs of Amascut

The whole raid, from the Jaltevas pyramid lobby to Osmumten's burial chamber. It is a single plugin, `server/plugins/minigames/TombsOfAmascut.plugin.js`, which delegates to one unit per area in `server/plugins/minigames/toa/`.

## Layout

| File | What it owns |
| --- | --- |
| `ToaShared.js` | Room table (spawns, challenge floors, bounds), path table, ids, varbits, and helpers such as fades, tile graphics, projectiles and knockback. |
| `ToaInvocations.js` | Invocation bitmaps read from cache structs (params 1159/1161/1162), raid level, mode, team lives, time limit and supply factor. |
| `ToaParties.js` | Lobby parties: applications, kicks, the party list and party settings. |
| `ToaRaid.js` | `Raid` and the `Room` base class: instancing, scaling, points, deaths, team wipes, the HUD and completion. |
| `Lobby.*` | Pyramid entry and exit, the grouping obelisk (772/774), the invocation board (776) and invocation presets. |
| `Raid.*` | Barriers, entries, exits, teleport crystals, Osmumten, safe deaths, ghosts, damage points and the invocation punishments. |
| `Nexus.*` | Path choice and path levels, the helpful spirit's supplies (777) and the supplies bag (778). |
| `Supplies.*` | Nectar, Tears, Ambrosia, Smelling salts, Blessed crystal scarab, Liquid adrenaline, Silk dressing and Honey locust. |
| `Scabaras.*`, `Kephri.*` | Path of Scabaras: the four puzzle variants and Kephri. |
| `Het.*`, `Akkha.*` | Path of Het: the beam and mirror puzzle and Akkha. |
| `Crondis.*`, `Zebak.*` | Path of Crondis: the palm-watering puzzle and Zebak. |
| `Apmeken.*`, `BaBa.*` | Path of Apmeken: Apmeken's Sight and Ba-Ba. |
| `Wardens.*`, `ToaWardensData.js` | The Wardens: obelisk and core phases (WARDENS_P1) and the final phase (WARDENS_P3). |
| `Rewards.*`, `ToaRewards.js` | The burial chamber, loot rolls, the loot interface (771) and the lobby retrieval chest. |
| `Items.*` | Masori fortifying, Armadyl to Armadylean plates, Elidinis' ward (f), Thread of Elidinis, keris jewels and Tumeken's shadow charges. |

## Instancing

Each raid has one `PrivateArea` covering the tombs region (x 3520–3967, y 5120–5439, planes 0–3). Rooms stay at their real coordinates. The area isolates NPCs, objects, ground items and clipping per party, so two parties never see each other. `world.json` marks the region multi-combat.

Engine additions this feature needed:

- tile spot animations (`SPOT_ANIM` target type 2) in both the server encoder and the client decoder, used by `sendGraphic`/`sendGlobalGraphic`;
- per-NPC maximum hitpoints (`NPC.setMaxHitpoints`), used for raid scaling and the health bar;
- cache struct params (`CacheDefinitions.getStructParams`), used to read invocations;
- `ForceMovement`, `ForceMovementTask`, `OperationType`, `LocModelType` and `StatementDialogue` on `api.core`.

## Scaling and points

These follow the wiki's *Tombs of Amascut* mechanics:

- **NPC hitpoints:** base × (1 + 0.4% per raid level) × party factor × path-level factor. The party factor is +90% for each of players two and three, then +60% each. Results are rounded to 10 above 100, otherwise to 5.
- **NPC damage:** the same raid-level and path-level factors, capped at 2.5×.
- **Points:** puzzles are worth 300, bosses 450, plus damage dealt × the NPC's points multiplier, capped at 64,000. A death costs 20% of a player's points (at least 1,000).
- **Unique loot:** chance = total party points / (10,500 − 20 × (raid level up to 400 + a third of the next 150)) percent, capped at 55%. At most one unique per raid; the recipient is weighted by personal points. Weights out of 24: Lightbearer 7, Osmumten's fang 7, Elidinis' ward 3, each Masori piece 2, Tumeken's shadow 1. Below raid level 150, the ward, Masori and shadow need an extra 1/50 roll; below 50, so do all uniques.

## Behaviour taken only from Near-Reality

The OSRS Wiki and the cache weren't reachable while this was written (see *Unverified* below). The following came from Near-Reality's ToA code, which was used as a behaviour oracle, and should be checked:

- Every boss's attack timings, special-attack cycles, tile patterns and base damage numbers. This includes the Wardens' orb paths, rotating-blade tiles, wheel, isolation, skull-bomb and floor-collapse tables (`ToaWardensData.js`), and Akkha's orb paths and quadrants.
- Wardens phase two: only the Warden's current style (magic or ranged) breaks its shield. Core damage passes through ×5, and the core stays out for 21/29/37/45/53 ticks depending on remaining health.
- Points multipliers on Warden NPCs: obelisk 1.5, Warden 2, final Warden 2.5.
- The common loot table, its quantity factor above raid level 300, fossilised dung below 1,500 points, deathless kits and remnants, Thread of Elidinis 1/15, keris jewels 1/20 and elite clue 1/26.
- Tumeken's shadow charge cost (2 soul + 5 chaos per charge, 20,000 maximum), the Masori and Armadyl plate counts and experience, and the ward's 10,000 soul runes.

## Simplifications

- **Tumeken's shadow:** charges, checks and uncharges, but tsps has no powered-staff autocast path, so it does not cast its built-in spell yet.
- **NPC defence:** not scaled by raid level; it comes from the shared definition.
- **Zebak:** players don't swim, and there are no water crocodiles.
- **Apmeken:** the corruption special is disabled, as it is in Near-Reality.
- **Wardens phase three floor:** collapsed rows push players back onto the remaining floor rather than becoming unwalkable.
- **The pet:** rolls at 1/20 of the unique rate. This is an approximation.
- **Logout and failure:** logging out leaves the raid with no rejoin, and a failed raid keeps your items.
- **Restart recovery:** logging in inside the tombs without an active raid returns you to the lobby. The raid exit also returns stranded players to the lobby.
- **Scoreboard:** the burial chamber scoreboard (44942) isn't implemented.

## Unverified

The game cache (`archive.openrs2.org`) and the OSRS Wiki were blocked by the network policy. NPC, object and item ids were checked against the generated identifier files instead. Unnamed cache entries use numeric constants: Warden charging orb 11769, hidden Warden 11765, departing spirit 11829, blade objects 45748/45749, platform 45606, siphon block 26209, and the burial chamber chests. The following still need a check with the dump scripts:

- interface component ids and scripts for 771–778 and 481, and the boss health HUD (303 at `161:2`, varp 1683, varbits 6099/6100);
- object and NPC option labels, especially Osmumten's *Begin*, *Uncharge*/*Check* on the shadow, and the chest options;
- animation, graphic and sound ids, all taken from Near-Reality.

## Verification

Developer accounts can use `::toaskippuzzle` inside any of the four pre-boss puzzle rooms.
It completes that room for the party, removes its remaining NPCs, and opens the normal
route to the boss. Use the room exit afterward. It also works before starting the puzzle.
The command uses normal completion, including puzzle points and revival; it does not
complete bosses or work in the lobby or Nexus. Repeating it does not award points again.

`::toaskipboss` is also Developer-only. It completes the current boss encounter for the
party, removes remaining enemies, and preserves Osmumten and the normal route onward.
At the Wardens it first advances to the final phase; use it again after arriving to finish
the raid and unlock the normal reward route. Completion points and rewards still apply.

Run `npx tsc --noEmit -p tsconfig.json` in `server`, then load the plugins. With `TS_NODE_TRANSPILE_ONLY=1`, a `node -r ts-node/register` script that calls `PluginManager.loadFromDirectory()` should list `TombsOfAmascut` among the loaded plugins.

In-game follow-up, done by hand:

1. Form a party at the obelisk, set invocations and enter.
2. Clear each path's puzzle and boss.
3. Beat the Wardens and claim the chest.
4. Leave with unclaimed loot and collect it from the lobby chest.
