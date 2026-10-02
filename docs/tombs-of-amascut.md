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
- **Points:**
  - Everyone starts on 5,000 points, which are taken off again for the loot and the purple chance.
  - Damage dealt × the NPC's points multiplier earns room points, capped at 20,000 a room (60,000 for the Wardens, from OpenRune). They're added to the total, capped at 64,000, when the room is completed.
  - The room's top scorer gets an MVP bonus of 300 × team size.
  - Puzzle completions are worth Scabaras 300, Apmeken 450 and Crondis 400. These are OpenRune's numbers; the Wiki gives none.
  - A death costs 20% of a player's total (at least 1,000).
  - At the end, each player's loot points go to `TOA_PERSONAL_CONTRIBUTION` (varp 3606).
- **Unique loot:** chance = total party points / (10,500 − 20 × (raid level up to 400 + a third of the next 150)) percent, capped at 55%. At most one unique per raid; the recipient is weighted by personal points. Weights out of 24: Lightbearer 7, Osmumten's fang 7, Elidinis' ward 3, each Masori piece 2, Tumeken's shadow 1. Below raid level 150, the ward, Masori and shadow need an extra 1/50 roll; below 50, so do all uniques.

## Behaviour taken only from Near-Reality

The OSRS Wiki and the cache weren't reachable when this was first written, so Near-Reality's ToA code was the behaviour oracle. The following still come from it alone, where the Wiki gives no numbers (see *Checked against the Wiki and the cache*):

- Every boss's attack timings, special-attack cycles, tile patterns and base damage numbers. This includes the Wardens' orb paths, rotating-blade tiles, wheel, isolation, skull-bomb and floor-collapse tables (`ToaWardensData.js`), and Akkha's orb paths and quadrants.
- Wardens phase two: only the Warden's current style (magic or ranged) breaks its shield. Core damage passes through ×5, and the core stays out for 21/29/37/45/53 ticks depending on remaining health.
- Points multipliers on Warden NPCs: obelisk 1.5, Warden 2, final Warden 2.5.
- The common loot table's items and divisors, fossilised dung below 1,500 points, and the deathless kits and remnants. (The quantity factor above raid level 300 matches the Wiki.)
- Tumeken's shadow charge cost (2 soul + 5 chaos per charge, 20,000 maximum), the Masori and Armadyl plate counts and experience, and the ward's 10,000 soul runes.

## NPC animations

Each Tombs of Amascut NPC (11689-11804) has its block and death animations in `npc-combat-defs.json`. Without them, they fell back to the player's block (424) and death (836), so Zebak "blocked" like a human when hit.

- **Block:** none of them has a block or defend animation, except Osmumten's ghosts, so a hit plays nothing.
- **Death:** each uses its own death sequence, identified by its Jagex name in RuneLite's gameval `AnimationID`, for example `NPC_ZEBAK01_DEATH` (9634) and `NPC_KEPHRI_DEATH` (9582). The Near-Reality data gives Zebak and Kephri zombie animations (5568/5569), which aren't used.
- **Scripted deaths:** the bosses' deaths are played by the plugins, and the definitions agree with them.

## Simplifications

- **Tumeken's shadow:** charges, checks and uncharges, but tsps has no powered-staff autocast path, so it does not cast its built-in spell yet.
- **NPC defence:** not scaled by raid level; it comes from the shared definition.
- **Apmeken:** the corruption special is disabled, as it is in Near-Reality.
- **Wardens phase three floor:** collapsed rows push players back onto the remaining floor rather than becoming unwalkable.
- **The pet:** the Wiki gives its formula but not its exact raid level scaling beyond thresholds at 400 and 550; it uses a third of the levels between them.
- **Logout and failure:** logging out leaves the raid with no rejoin, and a failed raid keeps your items. OSRS sends them to a retrieval chest in the lobby for a fee; there's no retrieval chest yet.
- **Zebak's death:** no camera shake, because the core has no camera-shake packet.
- **Restart recovery:** logging in inside the tombs without an active raid returns you to the lobby. The raid exit also returns stranded players to the lobby.
- **Scoreboard:** the burial chamber scoreboard (44942) isn't implemented.

## Checked against the Wiki and the cache

The first version was written without access to the Wiki or the cache, so it followed Near-Reality alone. A later pass checked it against both, along with RuneLite's gameval names (Jagex's own names for animations, spotanims, interfaces, varbits and varps).

**Ids:**
- **Animations:** every boss's matches its name. Zebak's and his tail's melee animations had been swapped.
- **Projectiles and graphics:** all are named and fit.
- **Interfaces 771–778 and 481:** all are the ToA groups they're used as. The boss health HUD (303 at `161:2`, varp 1683, varbits 6099/6100) matches a live capture from the Gemstone Crab.
- **Varbits and varps:**
  - The reward niche (46224) switches on `TOA_SHOULD_HAVE_LOOT` (14319); 14139 was a PvP Arena varbit.
  - Points had been sent to "varbit" 3586, a farming varbit in this cache. Now only each player's final loot points are sent, to `TOA_PERSONAL_CONTRIBUTION` (varp 3606), as OpenRune does.
  - The crocodile wall openings (`TOA_WALL02_CROCODILES04`, 45434) and Zebak's rock steps (`TOA_ZEBAK_CLIMBING_ROCK`, 45509) are the cache's.
- **The obelisk's interfaces:** the party list (772) and details panel (774) are built from pause buttons (`resume_pausebutton`), as OpenRune sets them. Ours had set op1 events, and the member rows always got the leader's view value.
- **Options:** every hooked NPC, item and loc option exists in the cache. The supplies bag's are *Open*, *Withdraw 1*, *Withdraw All* and *Resupply*, and now all work.

**Behaviour, against the Wiki:**
- **Raid scaling** (raid level, party size, path level) matches.
- **Zebak:** max hits are now 38 melee and 16 magic/ranged, and a wave hits for 6–10.
- **Kephri:** her attacks speed up with path level, and her fireball's max hit is 24.
- **Ba-Ba:** Protect from Melee fully blocks her melee (since June 2025), and her boulders have 27 and 31 hitpoints at path levels 2 and 4. She is worth 2 points per damage.
- **Zebak's water:**
  - A wave that runs out of floor throws the player into the water (5 tiles, from OpenRune).
  - Swimmers can't attack or run, and climb out by the rock steps.
  - The water crocodiles (11741: bubbles with strength 70, so a max hit of 8 before scaling) bite swimmers every 2 ticks.
  - A bite bleeds 1 time in 4 instead of hitting: 5–10 at once, then 1–8 on each tick spent moving, for 10 ticks. These numbers are OpenRune's; the Wiki only says moving makes it worse.
- **Crondis puzzle:**
  - The palm needs 175 water, plus 125 for each extra player.
  - A crocodile bites for 18, plus 3 for each acid or spear hit in the last 30 seconds, up to 36.
  - Crocodiles go for anyone carrying water nearby, then a watered palm, then someone without a container who hit them.
  - From OpenRune: crocodiles enter from one of three sides, a wave comes every 46–50 ticks, and they wake 4 ticks after spawning.
- **Invocations:**
  - On a Diet blocks all food, honey locusts included.
  - Dehydration blocks every potion that restores health, Guthix rests included.
  - The help invocations cut supplies to 66%, 33% and 10%.
- **Supplies:** the helpful spirit's chaos pack is rolled (1–8 nectar, 0–6 tears, 0–2 salts, with rare ambrosia and adrenaline), and the power pack has 1 liquid adrenaline. A supply used on the bag goes back in (from OpenRune).
- **Ghosts:** a ghost's inventory and worn equipment tabs close until it's revived (from OpenRune).
- **Raid items:** logging in outside a raid strips raid supplies.
- **The chest:** the unique chance and weights, the pet, the Thread of Elidinis, the four keris jewels and the elite clue now use the Wiki's rates.
- **Moving NPCs:** Zebak's waves and jugs, Akkha's unstable orbs, Ba-Ba's boulders and the moving Wardens move with collision off, as in Near-Reality. Before, the route finder couldn't move them over tiles the map blocks.

**Still open:**
- **Akkha's damage:** the Wiki's infobox gives a max hit of 55, and the plugin uses 22 for every style. 22 x 2.5 (the +150% damage cap) is exactly 55, so the 55 may be the capped value.
- **Impact graphics:** a few use generic graphics where the cache has dedicated ToA ones, for example Zebak's magic impact (`FIREBLAST_IMPACT` versus `ZEBAK_MAGE_SPLIT`). Only a capture would show which one OSRS plays.
- **Sound ids:** RuneLite has no names for them.
- **Unnamed cache entries:** these keep their numeric constants: Warden charging orb 11769, hidden Warden 11765, departing spirit 11829, blade objects 45748/45749, platform 45606, siphon block 26209.

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
