# Bot combat training

`::bot combat_training` spawns a new melee trainer at the invoking player's position.
The existing bot activity command can also assign `combat_training` to a controlled bot.
Commands retain their existing developer permissions.

At startup the `sites` in `bot-activities.json` spawn 500 bots around the Lumbridge spawn
(3222,3218, radius 6). A site's bots only ever run its `activities`; on the shared
`switchAfterSeconds` default each bot swaps to another of them at random once its
current activity has run that long (between fights, never under a bank-trip/fight-back
overlay; a switch with no free capacity slot elsewhere retries 30 s later). Without it the
bots are dedicated: a failed activity waits out its cooldown and resumes.

| Site | Bots | Activities |
| --- | --- | --- |
| `lumbridge_all_rounders` | 500 | combat training, woodcutting, mining (copper + tin), firemaking, smelting; switch every 15–25 min |

Trainers find their NPCs through the NPC cluster index (below), so they fan out across every
nearby group of their tier's monsters. Each bot starts on a random activity that has a free slot; the skilling
activities have 150/80/60/40 slots (woodcutting/mining/firemaking/smelting), the rest train combat. Change `count` there, or set `BOT_SITES=0` for
a bot-free world. `maxFailedTargets` (default 6) sets how many targets or frozen routes in a row
without landing damage fail a training site; that cluster is then skipped by the bot for 10 min.

The activity uses the lowest permanent level of Attack, Strength and Defence to choose a
melee training tier. Between kills it selects the combat style for the lowest of those three
skills. A temporary boost does not promote a bot; drained stats cannot unlock equipment.
Each trainer is assigned melee, ranged or magic from the activity's `styles` config
(deterministically per username). Ranged trainers level Ranged with tiered bows and arrows,
and magic trainers level Magic with tiered staffs, autocast low-level strike/bolt/blast
spells and carry the matching runes; their site and gear tiers follow the trained skill.

| Lowest trained level | Stage | Opponent combat levels (`npcLevels`) | Found near the Lumbridge spawn |
| --- | --- | --- | --- |
| 1–9 | `beginner` | 1–5 | rats, men, goblins, cows, chickens, spiders; swamp rats and frogs |
| 10–19 | `novice` | 2–13 | goblins, cows, swamp frogs, big and giant frogs, giant rats |
| 20–39 | `intermediate` | 9–27 | big/giant frogs, Al Kharid warriors, scorpions, unicorns, barbarians, guards |
| 40+ | `advanced` | 20–45 | guards, desert wolves, skeletons, black knights, hill/moss giants |

Stages give an NPC combat-level band - no names, coordinates or areas. Opponents are any
attackable NPC in the band; `excludeNames` (`Duck`, `Duckling`) drops ones that cannot be
fought where they stand. The NPC cluster index (`plugins/bots/brain/NpcClusterIndex.js`)
groups the live world's spawns by combat level into 32x32-tile cells (spawn tiles, so
wandering does not move a cluster), skipping the surface Wilderness, instances and, on a F2P
world, members land. A trainer picks the cluster with the lowest `trainers per NPC +
distance / spreadDistance` (`spreadDistance`, default 150 tiles), so near, roomy clusters fill
first and bots spill outward in proportion to cluster size; its targets must be within 24
tiles of the cluster centre. Clusters the route planner cannot reach (Shantay Pass, Draynor jail, islands) are skipped;
a walk that freezes makes only that trainer skip the cluster for 10 minutes. The same index groups by NPC name for
fishing spots, which are NPCs too.

These are configurable simulated-player preferences, not changes to monster mechanics or
an optimal XP guide. Chicken training is consistent with the OSRS Wiki's beginner melee
training guidance; subsequent starter-monster choices follow the requested progression:
https://oldschool.runescape.wiki/w/Pay-to-play_melee_training
https://oldschool.runescape.wiki/w/Free-to-play_melee_training

Each visit lasts 5–12 minutes, including travel. On expiration or a tier promotion, the
bot finishes its current fight before starting another visit, at another cluster than the
last. Guards are the final implemented
tier; this activity does not yet cover advanced PvM.

## Runtime behavior

- Uses the existing segmented movement requests to travel from its spawn to a training
  site, and the normal combat engine to follow and attack NPCs. It does not teleport or
  award XP directly. A route blocked by a closed door or gate makes the brain open the
  door that actually makes the target reachable (checked by re-pathing with the door's
  clipping temporarily removed), then retry the route before falling back to the existing
  stall/repick handling. Doors are not filtered by direction: a walk to a fenced site parks
  the bot on the fence tile nearest the target, usually already past the gate. Checked
  against the real map: every site is reachable from the Lumbridge spawn and from inside
  the castle, opening the cow-field and chicken-coop gates on the way.
- Looks up nearby NPCs using World's existing spatial update buckets, not a full world
  scan. Matches attackable NPCs in the stage's combat-level band near the chosen cluster, on the same plane and in the
  same private area. Checks normal combat permission and excludes dead/unregistered NPCs.
- Avoids taking another player's target. A shared expiring NPC claim prevents two trainers
  choosing the same idle target during one tick.
- Uses the existing simulated-bot provisioning model: each trainer picks a stable random
  loadout from configurable tier pools (`gearTiers`, `rangedTiers`, `magicTiers` in
  `bot-activities.json`) of low-level monster drops - bronze/iron/steel weapons, bows and
  arrows, staffs and runes, bronze/iron/leather/wizard armour, capes, gloves, boots,
  amulets - plus a stock of trout between fights. Attack and Defence (or the trained
  ranged/magic skill) unlock gear tiers independently, and individual slots can roll empty,
  so trainers spawn with partial outfits. Cache-derived equipment requirements are still
  checked. Food consumption uses the existing bot support action. This does not implement
  purchasing, loot collection, or an economy-funded equipment progression.
- Abandons targets with no movement/damage progress for 45 seconds; a site with no progress
  for two minutes fails and enters the existing activity cooldown. Death clears the current
  target/site; after the server respawns the bot it provisions and travels again without
  resetting earned skill levels.
- Replacing a brain now calls its action cleanup from top frame to bottom, so training
  cannot leave combat following or a target reservation behind.

The definitions live in `data/definitions/bot-activities.json`; `trainCombat` is a shared
brain action with per-player state, and its gear tables live in
`data/definitions/bot-combat-gear.json` (the activity references them by `gearRef`). It can
participate in future general-purpose activity selection without adding another bot runner.

## Validation

Extended `tests/bot-brain.test.cjs` covers starter targets, independent equipment upgrades,
balanced styles, promotion after a fight, session expiration, higher tiers, walking from
home, contested/dead/forbidden NPCs, shared claims, stalled targets, death, brain replacement,
real-core activity compilation and canonical NPC spawns at every configured site.

Run from `server/`:

```sh
node --test tests/bot-brain.test.cjs tests/pvp-retreat.test.cjs tests/pvp-f2p-eat.test.cjs tests/player-bot-cap.test.cjs
```

The tests verify movement requests and normal combat handoff. Full travel through gates,
combat animations, food use over extended play, and XP progression have not been verified
in a running world. The existing navigation's ability to reach each site must be checked
in-game. Start a fresh trainer with `::bot combat_training`, observe arrival/kills/XP, then
assign
trainers with all three melee stats at 10, 20 and 40 to check the subsequent sites. Confirm
another player fighting a training NPC is never displaced.

## Gathering and stuck-bot handling

- Gatherers find trees/rocks through the object index: live objects within 64 tiles, else the
  nearest indexed one up to ~512 tiles away. Only objects offering the action's option count
  ("Chop down", "Mine"): 149 of 216 objects named "Tree" are unchoppable scenery. Each bot claims
  its tree/rock (10 s, refreshed while targeted); after a minute with everything in range claimed
  the bot picks one spot past 64 tiles, so a lasting crowd moves on instead of queueing.
- A bot commits to its far spot: it does not re-pick halfway (no turning back), and on arrival
  it waits for respawns. Far spots must have a planned route (the planner's cached verdict), so
  an island is never chosen. A walk that gets no closer for 60 s while more than 20 tiles away
  makes that bot alone skip the spot for 10 min. Nothing is blacklisted for everyone on the
  strength of a failed walk: resources never run out, and a slow walker says nothing about
  the spot.
- Before clicking, the bot checks it can really reach the object (wall-aware). Otherwise it walks
  at it with brain movement, which opens gates. Three attempts from the same tile with nothing
  produced make that bot alone use another object for a while (2 min if it was right next to it,
  10 min if it never got near). Nothing is blacklisted for every bot, and depletion is never a
  failure: a depleted rock is a different object, waited out until it respawns.
- A trainer that reaches its cluster waits there for a target. A frozen walk skips only the NPC
  it was walking at; one that stops within the cluster radius trains from there; only a walk that
  never gets near marks the cluster unreachable for everyone.
- `::botinfo <bot>` (developer) prints a bot's activity frames, training cluster / gathering
  target, pending walk, door attempt and when its brain last ticked.


## Full inventory (skilling)

Gathering templates end with a `choose` step: each time the inventory fills, a weighted option
is rolled and its actions run in order, then the activity repeats (back to gathering).

| Option | Weight | Mining (`mine_rocks`) | Woodcutting (`chop_trees`) |
| --- | --- | --- | --- |
| bank | 2 | yes | yes |
| drop the resources and keep going | 1 | yes | yes |
| sell to the nearest general store | 1 | yes | yes |
| smelt, then bank / sell / drop | 1 each | yes | - (fletching/firemaking later) |

- `choose` (`actions/Choose.js`): `{ "type": "choose", "options": [{ "weight": 2, "actions": [...] }] }`,
  usable at any step of any activity.
- `sellItems` (`actions/SellItems.js`) walks to the nearest general store keeper (stores matched by
  name in `shops.json`, keepers located through the NPC cluster index) and sells the listed items
  through the normal shop code; anything unsellable stays in the inventory.
- `dropItems` / `sellItems` take `itemIds` from the activity's fields: `resources` (what it gathers)
  and, for mining, `smelted` (the bar plus leftover ores). `bar` names the smelting recipe
  (copper + tin -> `Bronze bar`); unpaired ores are what the follow-up bank/sell/drop handles.
  Smelt-then-bank uses `"until": { "inventoryFull": false }` so the bank deposits a part-full bag.
- Combat supplies are training-only: when combat training stops (switching to skilling, failing,
  a brain reset) the trout and runes it provisioned are taken back, so a skiller starts with a
  free inventory. The next fight re-provisions them; equipped arrows stay.
- A walk to a bank that leaves the bot standing for 20 s makes that bot alone use the next-nearest
  bank for 10 min; with none left the bank step fails and the next full inventory rolls again.

## No free resources

Bots are given tools (axe, pickaxe, tinderbox, training weapons/armour) but never resources:
smelting withdraws its ores and firemaking its logs from the bot's own bank (`bank` with
`withdraw`), so bars and burnt logs only exist if a bot gathered and banked the inputs. A
withdrawal that finds none of an item fails the step and the activity backs off and rotates.
A test fails if any activity uses `ensureItem` for something other than a tool. Combat
consumables (food, runes, arrows) are still provisioned for training, taken back when training
stops and not dropped on NPC deaths, so they never reach banks, shops or the ground.
- Far-from-player bots think on a due-time schedule (every LOD stride since they last ran), not
  `(cycle + shard) % stride === 0`, which aliased with the task budget's round-robin and left some
  bots without a brain tick for minutes.


## Long-distance routes

The in-game route finder only sees a 128x128 window, so straight-line staged walking could not
find detours: miners for Varrock's mine walked into the fenced Lumbridge cow field, the
Champions' mine needed a loop back out of the far-west cow field. Long walks now follow a
planned route (`behaviours/navigation/LongRoutePlanner.js`, wired in by `BotLongRoutes.js`):

- A* over tile collision flags, 4-directional, using the route finder's own blocking rules. A
  step through a wall is allowed only at a closed door/gate (resolved per player, so the Al
  Kharid toll gate counts); the brain opens it on arrival. The search box starts at the two ends
  plus 64 tiles and doubles when no way through is found; a goal on water settles for the
  nearest reachable tile only after the widest search. 120k tiles max per plan.
- Waypoints every 12 tiles plus both sides of each door crossing. The far side of a gate must be
  stood on: proximity across a fence never counts as passing it.
- Used for walks over 32 tiles, or any walk a straight dispatch already failed to path.
- Routes are cached by destination area (16x16, 10 min); a bot joins a cached route at the
  furthest nearby waypoint it can actually walk to. Failed plans are cached for 5 min. Planning
  is capped at 60 ms per game tick; a bot choosing a far spot or combat site waits for the
  planner's verdict rather than walking blind (straight-line into the sea).
- Cost (warm): 1-3 ms for Lumbridge -> Al Kharid / Varrock; ~25 ms to prove an island
  unreachable (cached).

## Other floors (stairs and ladders)

A walk whose target is on another plane (Lumbridge castle's top-floor bank) goes by the stairs
(`brain/Climbing.js`), using the cache-backed links from `plugins/objects/ClimbLinks.js`; no
coordinate lists. Stairs are searched near the bot and near the target; one counts only if the
bot can get to it (door-aware) and its landing leads on: to the target, or to further stairs that
do. That passes over Lumbridge castle's tower ladders, whose top rooms do not reach the bank.
The walk heads for the stairs (`request.climbVia`), the bot clicks the climb option once in reach,
and carries on from the new floor. Banks look for booths on every floor, 15 tiles further per
floor.

## Bots standing around

- Every action that ends drops its pending walk (`BotBrain.stopAction`), and a walk that finds no
  path 3 dispatches in a row with no door to open is dropped: the next action re-decides
  instead of waiting forever (bank walks onto a booth tile, rock approaches).
- Trainers settled at a cluster with nothing attackable (caged jail NPCs, all claimed) move on
  after 45 s.
- LOD: bots far from real players run every 4 cycles (was 12), medium every 2, with a 60 ms per
  tick budget. A CPU profile with 615 players had the server 87% idle and bots under 10%.

## Fishing and cooking

Tiered like the other skills, one activity per tier in each town's rotation (template `catch_fish`):

| Activity | Level | Tool | Spots | Fish |
| --- | --- | --- | --- | --- |
| `net_fishing` | 1 | small fishing net | Small Net/Net spots | shrimps, anchovies |
| `fly_fishing` | 20 | fly fishing rod + feathers | Lure spots | trout, salmon |
| `lobster_fishing` | 40 | lobster pot | Cage spots | lobster |
| `harpoon_fishing` | 60 | harpoon | Harpoon spots | tuna, swordfish |

Spots are NPCs, so they come from the NPC cluster index, keyed by the tool each spot option takes
(`Fishing.spotTools`, from the cache option list), and a fisher picks a cluster as a combat trainer
does: fewest fishers per spot plus distance, skipping clusters the route planner cannot reach
(Karamja) or it never gets closer to (the Fishing Guild below 68). Fishing goes through the fishing
plugin's own NPC option handler (`api.emitNpcInteraction`). Feathers are lent like a combat bot's
runes and taken back when the step ends, so they never reach a bank.

On a full inventory: bank, drop, sell, or cook then bank/sell/drop. `cook` uses a range within 24
tiles (object catalog `range`), else a fire within 8; with neither it drops a fish for room, chops
one log (axe as a tool), lights one fire and cooks on it, through the cooking plugin's item-on-object
handler (`api.emitItemOnObject`). Food the bot's Cooking level cannot cook is left raw.

## PvP (wilderness) bots

Configured in the same file, under `"pvp"`: `botPool` (how many `WildyBot` names exist),
`activeRegionBotsPerRegion` / `activeRegionInset` (regional spread around players) and `hotspots`
(area, anchor, `targetBots` / `maxBots`, level ranges, allowed loadouts). The gear catalogue stays
in `pvp-bot-loadouts.json`; hotspots refer to it by loadout id.

A wilderness bot's brain runs `pvp` with no rotation, so it only ever returns to `pvp`. The pvp
loop reports progress while the bot fights or moves; before that, the brain's 3-minute stall check
ended it and the bot was handed a random activity (WildyBots skilling in Lumbridge).

## Test tiers

Startup spawns 1000 bots: 200 each at Lumbridge, Varrock, Falador, Seers' Village and East
Ardougne market, each town split over the same four tiers (sites `<town>_novices` ... `<town>_experts`).
A site in `bot-activities.json` is just `{ id, tier, count, anchor, activities }`: the tier's
level band is code-owned (`SITE_TIER_LEVELS` in `BotActivityRegistry.js`) and each skill rolls
inside it at spawn (hitpoints at least 10, agility always 99); the rotation timing and spawn
radius are shared defaults in the same file. Gear — combat kit and the best usable
axe/pickaxe — follows from the levels. Trees, rocks, banks, stores and NPC clusters are found
from wherever the bot is, so the same activities work in every town. Activity capacities are
global (shared by all towns).

| Tier (per town) | Bots | Spawn levels | Rotates between |
| --- | --- | --- | --- |
| `novices` | 70 | 1-19 | combat (NPC lv 1-5), normal trees, copper/tin, burn logs, smelt bronze |
| `intermediates` | 50 | 20-39 | combat (lv 9-27), oaks, iron, burn oak logs |
| `advanced` | 40 | 40-59 | combat (lv 20-45), willows, coal, burn willow logs |
| `experts` | 40 | 60-99 | combat (lv 30-90), yews, mithril, burn yew logs |

Level 40-90 NPCs near Lumbridge are almost all past the Shantay Pass or the River Salve, which
the route planner cannot reach, so the expert band starts at 30.

