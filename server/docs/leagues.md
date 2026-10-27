# Leagues

The Leagues game mode (https://oldschool.runescape.wiki/w/Leagues) on this server: a league
character per account, League Points, tasks, ranks, relic tiers and relics, and the league screens.
Plugins: `plugins/modes/LeagueMode.plugin.js` (the profile, its league, XP rate, journal tab, the
side panel's Summary / Info / Rank screens, ranks, statistics, the content its screens need),
`LeaguePoints.plugin.js` (points), `LeagueTasks.plugin.js` (the task catalog, its triggers and the
task list) and `LeagueRelics.plugin.js` (tiers and relics); data in `plugins/modes/data/leagues.json`,
`league-ranks.json`, `league-tasks.json` (generated), `league-task-list.json`,
`league-task-triggers.json` and `league-relics.json`.

## The league character

Live OSRS runs Leagues on their own worlds, where an account plays a fresh character. Here a
world runs a league when its plugin config says so:

```json
"pluginConfig": { "league:type": 4 }
```

(every league the cache names in enum 2670: 1 Twisted, 2 Trailblazer, 3 Shattered Relics, 4
Trailblazer Reloaded, 5 Raging Echoes, 6 Demonic Pacts; `world.local.json` can set it per
deployment, and `pluginConfig` `"league:start"`, an ISO date, says when the league began for the
client's league clock). LeagueMode reads it at startup and claims the world's character profile
(`api.setWorldProfile`, `GameConstants.WORLD_PROFILE`), so every login is the account's **league
character**, a save kept apart from its main one (`persistence/PlayerProfile.ts`):

- JSON saves: `data/saves/characters/league/<name>.json` beside the main `<name>.json`.
- SQLite and IndexedDB: the key `league:<name>`, prefixed after the name is normalised, so no
  account name can collide with it.
- `Player.getProfile()` says which character is online; it is never written into the save. Both
  share the name, so only one can be online at a time, as on live, and friends see the account
  online either way.
- The account has one credential: its main character's. A league character's own hash only
  stands in while no main character exists (an account first made on a league world), and a
  main character made later takes it. So a name can't be claimed on either world with a password
  of one's own, and `::changepassword` (`PlayerPersistence.changePassword`) writes the new hash
  to both characters and signs out every remembered login on both.
- A "Stay logged in" token belongs to the character it was issued on (each save keeps its own),
  and the world decides the character, so a token from one world's character never opens the
  other's.
- Known limits: the SQLite backend's one-time import of legacy JSON saves reads only the main
  files; admin commands that address saves by name reach the main profile only; an offline
  update to either save (an external store purchase) is refused while the account's other
  character is online, since both share the name.

The world's league is the one a new league character joins; the character keeps it in
`league:type`. A new character starts at the league's levels (Wiki: Trailblazer and Trailblazer
Reloaded Herblore 3, Runecraft 5, Agility 10; Raging Echoes and Demonic Pacts Herblore 3 and
Runecraft 5; Twisted Herblore 3; Shattered Relics none, its skills being unlocked with Renown). A
main character never has a league, whatever its attributes say. Leagues I-III have their names,
colours and screens here but no relic, area or task catalogs yet.

## Events

| Event | Payload | Who answers |
| --- | --- | --- |
| `journal:tab-mounted` | `{ player, groupId, tabIndex }` (SideJournalDefaults) | LeagueMode listens |
| `league:profile` | `{ player } -> { league: type \| null }` | LeagueMode |
| `league:login` | `{ player, league }` after a league profile's login | LeaguePoints, LeagueRelics listen |
| `league:highest-tier` | `{ player } -> { tier }` (0-based, -1 none) | LeagueRelics |
| `league:award-task` | `{ player, id, points, name } -> { awarded }` | LeaguePoints (once per id) |
| `league:points` | `{ player } -> { points, tasks }` | LeaguePoints |
| `league:completed-tasks` | `{ player } -> { ids }` | LeaguePoints |
| `league:complete-task` | `{ player, id } -> { found, completed }` (a catalog task, by id) | LeagueTasks |
| `league:points-changed` | `{ player, points, previous, tasks }` | LeagueMode (journal), LeagueTasks, LeagueRelics listen |
| `league:has-relic` | `{ player, relic } -> { active }` | LeagueRelics |
| `league:relics` | `{ player } -> { league, chosen }` (tier index -> slot) | LeagueRelics |
| `league:content-rows` | `{ player, league, base, structs, enums, dbRows }`: units push the rows the client lacks | LeagueRelics (Catalog), LeagueTasks (Catalog), LeagueMode (Rank) answer |
| `league:send-content` | `{ player }`: send the content payload again (before an interface opens) | LeagueMode (Content) |
| `league:rank` | `{ player } -> { rank, name, next }` (ranks reached 0-7, the next threshold) | LeagueMode (Rank) |
| `league:statistics` | `{ player } -> { counters }` (the summary's rows by name) | LeagueMode (Statistics) |

## What the client is sent

From the rsprox Leagues V recordings (osrs-captures 227/00070 and 227/00075; the packets are the
same for every league):

- Login: varbits `league_account` 10031 = 1, `league_type` 10032, `league_tutorial_completed`
  10037 = 12, `league_total_tasks_completed` 10046, `league_rank_notification` 17299 (the ranks
  reached), `current_runeday` 9535 (whole days since 27 February 2002: live sends it with the
  journal tabs and the Info panel's script reads it); varps `league_points_completed` 2614,
  `league_points_claimed` 2615, `league_points_previous` 2807, the summary's tracking varps
  (below) and, when the world's `league:start` is set, `tracking_playtime_leagues` 4523 =
  minutes since the epoch of the league's start (the same value for every player in the Leagues V
  captures, 27 November 2024, so it is the league's clock, not a play time); the relic selection
  varbits.
- A task award: 10046 and 2614 rise, then 2615; the popup (`notification:show`) "League Task
  Complete!" / "Task Completed: <col=ffffff>Name</col><br><br>Points Earned: <col=ffffff>N</col>"
  in the league's colour with jingle 283, the game message "Congratulations, you've completed an
  easy task: <col=20C2FE>Name</col>." (the league's colour), and script 3226 refills the side
  panel's bar (656:23). `league_reward_points_buffer` (13341) then goes 10 and back to 0 for the
  bar's animation; not sent.
- The journal's Leagues tab (side_journal 629:34) shows once the varbits are set; a click mounts
  the league side panel (656) in the journal's content container (629:43) with the tab varbit
  8168 = 4, the way this client mounts its other journal tabs (live mounted it in its own slot).
- XP: the league's rate (5x; 8x from relic tier 2, 12x from tier 5, 16x from tier 7, Wiki tier
  passives) multiplies every gain after the world's rate, through the can-gain-experience
  hook's `multiplier`.

## The content payload

A league's screens read structs, enums and DB rows the rev 241 cache only holds for the current
league (Demonic Pacts): the relic catalog, the task list, Leagues I-III's rank thresholds.
`league/Content.LeagueMode.js` asks every unit for its rows (`league:content-rows`) and sends them
as one `structOverrides` / `enumOverrides` / `dbRowOverrides` payload (`sendContentData`; the
client's `GamemodeContentStore` replaces the whole set on each payload, which is why no unit sends
its own; rows for one struct from several units are merged into one) at a league login and on
`league:send-content`. Virtual struct and enum ids start at 200000 + league type x 1000; the relics
use offsets 0-199, the ranks 900-901. The tasks' DB rows are their own id space (300000 + league
type x 10000 + position) and replace the cache's task enums 5950 and 2671. A league the cache
carries sends an empty payload (Demonic Pacts: no overrides at all), which also clears whatever
another league left in the client.

## Panels

The side panel's three top buttons, each opening its interface as the main modal with the click
events on its menu frame, as captured (227/00075, 227/01845, 227/00579); the client draws the rest
from varps and the league struct, so the server sends nothing else (`league/Panels.LeagueMode.js`,
data `panels`):

- **Summary** (656:7 -> `league_summary` 529): sound 2266, `if_setevents` on the stats row 2 (Time
  Played, OP1 and the six target kinds) and script 7741 `[529:23, 2, "(Click to reveal)"]`; a click
  on that row closes and re-opens the summary with the time played, in the captured shape (the two
  largest non-zero units: "17 days, 2 hours", "17 days, 58 minutes", "19 hours, 46 minutes"), and
  it stays revealed for the session. The time is the character's time online, counted here
  (`league:play-time`, milliseconds, saved every minute and at logout) since the capture has no
  play-time varp. Each of the three asks for the content payload again before it opens.
  Live also ran the account summary's playtime script (3970) on the open; not sent, since that
  panel is not mounted here. The rows read the points and task varps (LeaguePoints), the relic and
  area selection varbits, varp 5484 `talent_points_earned` (Demonic Pacts' masteries, theirs) and
  the statistics below. Every league type.
- **Info** (656:2 -> `league_info` 654): `if_setevents` OP1 on `league_menu_frame` 654:17 slots
  12-18. The panel's texts are the league struct's (the cache's, every league type).
- **Rank** (656:10 -> `league_rank` 64): `if_setevents` OP1 on 64:16 slots 10-18; script 730 draws
  the seven ranks from the struct's threshold enum (param 1857) and trophy enum (2041), the names
  from enum 5201 and `league_points_completed`.

### Ranks

`league/Rank.LeagueMode.js`, data `league-ranks.json`: seven ranks a league (Bronze to Dragon) at
the League Points thresholds the trophies are awarded in. Leagues IV-VI's are the cache's enums
(5237 / 5719 / 5979; the Wiki's League_trophy tables agree, and the test checks it); Leagues
I-III's structs carry none, so their rows are the Wiki's thresholds and the cache's trophy items
by name, sent through the content payload. As captured, varbit `league_rank_notification` 17299 =
the number of ranks reached, sent at login and on the award that crosses a threshold, with one
game message per rank (`<col=229628>You've obtained Iron rank! You can claim your trophy from the
Leagues Tutor in the main game.`); no popup. Trophies themselves (447) are not handed out yet.

### Statistics

`league/Statistics.LeagueMode.js`, data `statistics`: the summary's rows read the `tracking_*`
varps 4510-4527 and varbit 11561; the server counts what its hooks see for a league character,
one attribute `league:statistics` (name -> value), sent at login and as each changes: NPCs killed
(`onNpcDeath`; bosses by the cache's boss param 1361, as NpcDrops reads it), deaths, players
killed (`onPlayerDefeated`), damage dealt to NPCs and the highest hit (`onPlayerDealtDamage`),
damage taken from NPCs (`onCombatHitResolved`), food (`food:eaten`), potions (`potions:drunk`),
fish, ore and logs (`fishing:success`, `mining:success`, `woodcutting:success`). Stubbed at 0 for
want of a source: echo bosses killed (none here), coins gained and lost, clues completed (no
completion event), special attacks used (the special flag is cleared before the hit resolves) and
the highest value item worn.

## Relics

`LeagueRelics.plugin.js`, data `plugins/modes/data/league-relics.json`: eight tiers a league,
each with a point cost, a passive and three relics (Wiki); a tier's pick is permanent. A
character's picks live in `league:relics` (tier index -> slot 1-3).

- **The catalog.** The cache's relic interface (655) reads the league struct's tier enum (param
  870), tier structs (877 cost, 878 relic enum, 2045 passive struct) and relic structs (879 name,
  880 description, 885 tier, 1855 has-item), but the cache only carries the current league's.
  The server sends a league's own as `structOverrides` / `enumOverrides` datasets through the
  content payload above (`GamemodeContentStore` and the cs2 `struct_param` / `enum` ops read them
  before the cache) at login and before the interface opens. Ids start at 200000 + league type
  x 1000; icons are borrowed from the cache's own relic in the same tier and slot. Demonic Pacts
  (`"6": { "fromCache": true }`) is read from the cache instead: its tiers, costs, passives and
  relics come from struct 6436's enums, the relic keys are their names slugged, and no relic
  hands out an item, since the cache does not say which do.
- **The flow, as captured.** The side panel's View Relics (656:44) opens 655 as the main modal
  with `if_setevents` on its slots (655:22, 0-23) and menu (655:6, 10-20). A slot click sets
  `league_relic_last_viewed` (10048) to tier x 3 + slot and runs the client's redraw scripts 3193
  (the panel's components, the state 2 both captured clicks sent for an affordable, unchosen
  tier (other states were not captured), the relic struct, the tier's passive struct) and 3181.
  Known issue: on this web client the relic information panel stays blank after those two
  scripts (`extra_info` 655:27 remains hidden, for data-driven and cache-native leagues alike;
  every component id was re-checked against the rev 241 gamevals and the scripts run without a
  cs2 error), so the pick is only reachable through `::relic` until the client's cs2 side is
  fixed. Confirm (655:50) unlocks the viewed relic: its tier's selection varbit
  (10049-10053, 11696, 17301, 17302) = the slot, animation 8524, the league's unlock graphic
  (struct param 1021: 2603 Trailblazer Reloaded, 3044 Raging Echoes) at height 92, the modal
  closed, sounds 4215/4211/4213/4212 at 8/44/80/104. Points crossing a tier's cost show "New
  Relic Available!" / "You've gained enough points to unlock a tier N Relic!" with jingle 281, in
  the orange the capture shows on a Raging Echoes world (the task popup, by contrast, uses the
  league's colour). Slot and confirm clicks count only after View Relics opened the interface.
- **The checks.** A league character, a real slot, no pick in that tier, the tier's points, a
  bank open when the Wiki says the relic must be unlocked in one (`requiresBank`: every
  Trailblazer Reloaded item relic; Raging Echoes' Clue Compass, Bank Heist and Fairy's Flight,
  while its tier-1 tools are handed out anywhere, as the Leagues V tutorial's Animal Wrangler
  unlock in osrs-captures 227/00196 shows; the modal replaces the bank as the main interface, so
  what was open when View Relics was clicked counts), and room for every item in the inventory
  or a bank tab, so a permanent pick is never saved without its items; each item goes to the
  inventory if it fits, else to its bank tab, else to any tab with room. Refusals are game
  messages of ours. Items no longer in this cache (Sage's greaves, the Trailblazer tools, the crystal of
  memories, the guardian horn) are not granted; the data says so.
- **Effects** are other plugins' business: they ask `league:has-relic { player, relic }`, true
  only when the character's league has that relic and chose it. The tier passives' XP rates are
  LeagueMode's (`league:highest-tier`); the other passives are not implemented.

### Trailblazer Reloaded's combat relics

Three relics have their effects (`leaguerelics/*.LeagueRelics.js`, numbers in the data's
`effects`; the Wiki's, as no recording of Trailblazer Reloaded exists):

- **Superior Sorcerer** (tier 4): magic attacks every 2 ticks (the new `onAttackSpeed` hook, asked
  after the weapon's, spell's or special's own speed), magic accuracy x2.75 and +200 permille
  magic damage (the equipment-effect modifiers), a 90% roll a cast that keeps the runes (the
  existing `magic:rune-saving`, asked once the cast has checked the player has them, so they are
  required but not spent) or the staff's charge (`combat:consume-charge`, asked by the trident in
  core and by the Sanguinesti staff and Tumeken's shadow before a charge is spent), in multicombat
  a landed spell also hits up to five attackable targets within a tile of its target for 0 to 25%
  of its damage (fixed-damage hits that pay no XP, never splash themselves and are not scaled
  again by Berserker, since the hit they derive from already was), and the standard
  binds and Ancient ice spells always land unless the target is frozen or still freeze-immune.
- **Berserker** (tier 7): every hit is multiplied by 1 + 0.004 x missing hitpoints (floored), and a
  hit on an NPC at full health is forced accurate at its max.
- **Undying Retribution** (tier 8): when a death would go ahead (`onPlayerBeforeDeath`, after any
  other content kept the player alive) and three minutes have passed since it last fired:
  hitpoints and prayer to their max, poison, venom and the poison immunity cleared, the
  Retribution prayer's graphic 437 (ours), and a reflected hit of 0 to 2 x Prayer level on every
  attackable NPC within three tiles that is not attack-immune and that the area's policy lets
  the player fight (recoil-immune ones only if Nex, the Hespori, Vorkath or a Wilderness boss)
  and 0 to half the Prayer level on each player fighting them. The cooldown is a timestamp
  attribute (0 when ready), reset by a real death (`onPlayerDefeated`, which fires only once
  the death went ahead). A plugin that already prevented
  the death on this hook is honoured; one attached after this plugin would see the relic fire
  first, since every before-death hook runs. Raid death penalties are not exempted yet.

## Tasks

`LeagueTasks.plugin.js` with its units in `plugins/modes/leaguetasks/`: the catalog of each league's
tasks, the triggers that award them and the cache's task list interface. A completed task is a key
of LeaguePoints' `league:tasks` (id -> points); the task's points are its tier's.

- **The catalog** is `data/league-tasks.json`, **generated** by `scripts/generate-league-tasks.ts`
  (`yarn generate:league-tasks [--from <dir>] [--save <dir>] [--check]`) from the Wiki's
  Trailblazer_Reloaded_League/Tasks and Raging_Echoes_League/Tasks pages (one `{{TRLTaskRow}}` /
  `{{RELTaskRow}}` template per task in the raw wikitext: name, description, requirements, tier,
  region, the Wiki's id) and the rev 241 cache; never edit it by hand, change the generator and
  re-run it (same inputs, identical file; `--check` fails when the committed file is stale). A
  task has a stable string id (its name's slug; saves hold ids, so the list order is free to
  change), `wikiId`, tier 1-5, points (Easy 10, Medium 40 Trailblazer Reloaded / 30 Raging
  Echoes, Hard 80, Elite 200, Master 400: the Wiki rows show the first two, the pages' per-area
  totals reproduce the rest, and Raging Echoes' match cache enum 2671), the client's area id
  (enum 3412: Global 0, Misthalin 1 ... Kourend 10, Wilderness 11, Varlamore 21), a category (enum
  3411: 1 Skill, 2 Combat, 3 Quest, 4 Achievement, 5 Minigame, 6 Other) and, where derivable, a
  `trigger`. The Wiki has no category: a task the cache's own list has by name (enum 5950's rows
  of DB table 118 `action`, column 35: most of Raging Echoes and the Trailblazer Reloaded tasks
  that share a name) takes the cache's, the rest a rule in the generator (`categorySource:
  "rule"`, ours). The Wiki's Trailblazer Reloaded id 1522 is on two tasks (The Frozen Door,
  Defeat Vardorvis); kept as the Wiki has it.
- **The list** (`league_tasks`, 657; `data/league-task-list.json` holds every id below). As the
  cache's scripts read it (3202 -> 3204 -> 9428): the rows come from enum 5950 (position -> a row
  of DB table 118: 0 name, 1 description, 32 tier, 34 "in this league", 35 category, 36 area),
  a tier's points from enum 2671, and a task's **completion** from bit `position % 32` of varps
  2616-2631 (positions 0-511), 2808-2835 (512-1407), 3339-3342 (1408-1535) and 4036-4049
  (1536-1983) (script 9470). The cache only carries the current league's rows, so a league's own
  catalog goes in the content payload (see above) as `enumOverrides` (5950 and 2671) and
  `dbRowOverrides` (rows 300000 + league type x 10000 + position), at login and again before the
  list opens (`Catalog.LeagueTasks.js` answers `league:content-rows`; `GamemodeContentStore` and the
  cs2 `db_getfield` / `db_getfieldcount` / `db_getrowtable` ops read the rows before the cache, the
  only table reads the list's scripts make). The
  recordings never carry the completion varps, the scripts read them, so they are sent at login
  and whenever the points change (`Complete.LeagueTasks.js`, only the varps that changed). The
  task's position in its league's list is its bit.
- **The flow, as captured** (227/00070, 00067, 00068, 01710): View Tasks (656:36) opens 657 in
  the toplevel floater as an overlay (the main modal closed first) with `if_setevents` OP1 on the
  five dropdowns' option lists (7, 8, 15, 7 and 4 slots from 1: the tier, type, area, skill and
  completed enums 2676, 3413, 3414, 4105, 2677), the task rows (0 to the task count) and the menu
  frame 657:6 (10-18). A dropdown option slot N sets its filter varbit to N - 1: the tier
  (`league_task_filter_tier` 10033: slot 3 -> 2, 5 -> 4, 1 -> 0) and type (11689: slot 2 -> 1)
  picks are captured, the area (11692), skill (13340) and completed (10034) ones follow. The
  recordings are revision 227, where the lists were 657:35-39 and the rows 657:17; in this cache
  (241) the lists are the components the filter rows' scripts (3207) build each one in,
  `dropdown_tier` 657:37, `_type` 38, `_area` 39, `_skill` 40 and `_completed` 42, and the rows'
  Expand ops sit on `tasks_background` 657:18, so those take the events (the cache wins on ids;
  the recordings' components would never reach the server from this client). The client's
  scripts filter the rows from the varbits (3699; the area filter's "Unlocked" reads the area
  varbits, the areas plugin's), plus a client-side search. The filters are kept in
  `league:task-filters` and re-sent at login, as the recordings show (10034 = 1, 11692 = 13). A
  row click is the client's expand/collapse and gets no reply; the close button (657:3) closes
  the floater. Clicks count only after View Tasks opened the list.
- **Completing** a task (`Complete.LeagueTasks.js`, `league:complete-task { player, id }`): a league
  character, a task of its league, not yet done; the completion bit goes out first (the points
  varp's redraw then shows the tick), `league:award-task` pays the points and shows the popup,
  then the captured game message in the league's colour with the tier's name.
- **Triggers** (`Triggers.LeagueTasks.js`) are data: a task's `trigger` from the generator, or from
  the hand-maintained overlay `data/league-task-triggers.json` (by league type and task id; it
  wins). Kinds: `kill { npcs, count }`, kills of any of the NPCs (by name) added up per task in
  `league:task-kills` (task id -> kills); `level { skill, level }`, `any-level { level,
  excluding }`, `total-level`, `base-level` (Sailing left out, it came after both leagues) and
  `combat-level { level }` on `onPlayerLevelUp` and at login; `level-up` on any level gained;
  `quest { name }` on `quest:completed` and at login (`quest:is-complete`). A kill is credited
  from an NPC's death (`onNpcDeath`, to its killer) and from the shared credited-kill event
  `combat-achievements:kill { player, monster, amount? }` that scripted encounters emit for each
  rewarded player when no NPC dies (the Nightmare's ending transforms her) and some bosses emit
  beside the death, a singles boss under its main boss's name (Artio as Callisto); within one
  tick a task takes the larger of the two counts, so one kill reported both ways counts once and
  several kills in a tick all count. The generator derives a kill only when every NPC the task
  accepts is a cache NPC of that exact name and the description adds no place or condition
  ("Defeat a Goblin", "Defeat Cerberus 50 times", "Kill 5 Sand Crabs"; the alternatives its
  description lists join it: "Defeat Callisto or Artio 50 times", "Defeat The Nightmare or
  Phosani's Nightmare 50 times combined"; "in the Fremennik Province", "on Ungael", "without
  leaving" or Raging Echoes' "must be of one difficulty" leave the task unmapped, the places
  until the area unlocks exist, even for a boss with one home), a quest only when
  `plugins/quests/quests` registers that name, and a level only for a known skill; its report
  lists the kill tasks it could not map. To map more: add a kind (a trigger kind is a few lines in Triggers.LeagueTasks),
  a rule in the generator, or an entry in the overlay; or have the plugin that knows the deed emit
  `league:complete-task`. Everything else in the catalog is visible and counts once mapped.
- **Not mapped yet:** kills with a place or a condition, equipment, skilling counts, clue
  scrolls, minigames, the Leagues tutorial task, and the Raging Echoes pacts (league 6's rows).

## Developer commands

- `::league [player]` - the character's league and points.
- `::leaguetask <id> [points] [name]` - complete a catalog task by its id, or award an ad-hoc task
  with the points given, through the real award path.
- `::leaguetasks <search>` - find a league's tasks by name or id, with tier, points and whether done.
- `::relic [tier 1-8] [slot 1-3]` - list your relics, or choose one through the usual checks.

## Not yet

Most task triggers (see Tasks), area unlocks, combat masteries, the other tier passives (drop
rates, run energy, clue boxes, minigame points, the ironman restriction), the league tutorial,
the trophies, rankings, statistics and firsts screens, the reward and skill cape shops, and
Shattered Relics' own panels. Each is its own item on the progress tracker.
