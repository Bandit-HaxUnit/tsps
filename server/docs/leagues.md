# Leagues

The Leagues game mode (https://oldschool.runescape.wiki/w/Leagues) on this server: a league
character per account, League Points, tasks, ranks, relic tiers and relics, area unlocks, combat
masteries and the league screens. Plugins: `plugins/modes/LeagueMode.plugin.js` (the profile,
its league, XP rate, the tiers' passives, journal tab, Summary / Info / Rank, ranks, statistics
and shared content), `LeaguePoints.plugin.js` (points), `LeagueTasks.plugin.js` (the task catalog, triggers and list), `LeagueRelics.plugin.js` (tiers and
relics), `LeagueAreaUnlocks.plugin.js` (areas) and `LeagueCombatMasteries.plugin.js` (Raging
Echoes' combat masteries); data in `plugins/modes/data/leagues.json`, `league-ranks.json`,
`league-relics.json`, `league-areas.json`, `league-boosted-drops.json` and
`league-combat-masteries.json`, `league-tasks.json` (generated), `league-task-list.json` and
`league-task-triggers.json`.

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
- Every league character plays as a standard Ironman (Wiki "Player restrictions": all players
  are Ironmen). Every league login sets a character that is anything else (new, made before this
  rule, or changed with `::ironman`) through the Ironman plugin's `ironman:set-mode`; the Ironman
  plugin's trading, loot, shop and Grand Exchange rules then apply as to any Ironman. The mode
  stays: the Ironman tutor's and Adam's setup ask `ironman:change-mode` before a change, and
  LeagueMode refuses it for a league character ("As a league character, you are always an
  Ironman.", ours). `::ironman` overrides it only until the next login. A main character's mode is
  its own. The rule needs the Ironman plugin enabled; with it disabled in world.json a league
  character is not an Ironman and nothing says so.
- Admin and save commands that look a save up by name address the character this world logs in:
  the league character on a league world (`GameConstants.WORLD_PROFILE`), the main one elsewhere, so a plain world is unchanged. That is
  `::snapshots`, `::rollback` and `::reprocorruptsave`, and the save-exists check of `::mute`,
  `::unmute`, `::ban` and `::unban` (those four are still stubs that punish nobody).
- Known limits: the SQLite backend's one-time import of legacy JSON saves reads only the main
  files; an offline update to either save (an external store purchase) is refused while the
  account's other character is online, since both share the name; the friends chat's offline
  owner lookup (`FriendsChatManager.js`) and the AI bots' name checks (`RegisterAiBots`,
  `PlayerFactory`) still read the main save only, so on a league world an offline owner's channel
  is the main character's and a name held only by a league character counts as free for a bot.

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
| `league:saved-points` | `{ save } -> { points, tasks }` (an offline league character's save) | LeaguePoints |
| `league:account-points` | `{ player } -> { leagues, total }` (a main character's league points, by type) | LeagueMode (Records) |
| `league:award-renown` / `league:spend-renown` | `{ player, amount } -> { awarded }` / `{ spent }` (Shattered Relics' Sage's Renown) | LeagueMode (Shattered) |
| `league:renown` | `{ player } -> { renown }` | LeagueMode (Shattered) |
| `league:grant-fragment` | `{ player, id, xp? }` owns a Shattered Relics fragment | LeagueMode (Fragments) |
| `league:unlock-skill` | `{ player, skill }` unlocks a Shattered Relics skill for free | LeagueMode (Unlocks) |
| `league:unlocks` | `{ player } -> { skills, bosses, quests }` | LeagueMode (Unlocks) |
| `league:open-tasks` / `league:open-fragments` / `league:open-unlocks` | `{ player }` from Shattered Relics' side panel | LeagueTasks (#1358) / Fragments / Unlocks |
| `league:completed-tasks` | `{ player } -> { ids }` | LeaguePoints |
| `league:complete-task` | `{ player, id } -> { found, completed }` (a catalog task, by id) | LeagueTasks |
| `league:points-changed` | `{ player, points, previous, tasks, previousTasks }` | LeagueMode (journal), LeagueTasks, LeagueRelics, LeagueAreaUnlocks listen |
| `league:has-relic` | `{ player, relic } -> { active }` | LeagueRelics |
| `league:masteries` | `{ player } -> { league, masteries: { melee, ranged, magic }, passiveTier, points: { earned, spent, available }, challenges }` | LeagueCombatMasteries |
| `league:mastery-point` | `{ player, challenge, earned }` after a Combat Mastery point | - |
| `league:mastery-unlocked` | `{ player, style, tier, key, passiveUnlocked }` after an unlock | - |
| `stats:heal` | `{ player, previous, amount, hitpoints }` before any heal (core); `amount` may change | LeagueCombatMasteries |
| `skills:restore` | `{ player, skill, amount, max }` before a stat restore or boost (core); `amount` may change | LeagueCombatMasteries |
| `combat:hit-rolled` | `{ attacker, target, combatType, damage, minimum, maximum }` after a hit's damage roll, before defences (core); `damage` may change | LeagueCombatMasteries |
| `league:relics` | `{ player } -> { league, chosen }` (tier index -> slot) | LeagueRelics |
| `league:content-rows` | `{ player, league, base, structs, enums, dbRows }`: units push the rows the client lacks | LeagueRelics (Catalog), LeagueTasks (Catalog), LeagueMode (Rank), LeagueAreaUnlocks answer |
| `league:send-content` | `{ player }`: send the content payload again (before an interface opens) | LeagueMode (Content) |
| `league:rank` | `{ player } -> { rank, name, next }` (ranks reached 0-7, the next threshold) | LeagueMode (Rank) |
| `league:statistics` | `{ player } -> { counters }` (the summary's rows by name) | LeagueMode (Statistics) |
| `league:joined` | `{ player, league }` the first time a character joins its league | LeagueMode (Tutorial) listens |
| `league:area-unlocked` | `{ player, league, area, slot }` when an area is unlocked | LeagueAreaUnlocks (#1352) emits; Tutorial listens |
| `league:tutorial-stage` | `{ player } -> { stage }` (league_tutorial_completed while a tutorial runs) | LeagueMode (Tutorial) |
| `screen-highlight:show` / `:close` / `:finished` | a walkthrough in an interface (see Tutorial) | ScreenHighlight |
| `interface:opened` | `{ player, groupId, targetUid, type }` whenever a group is mounted (core, PacketSender) | Tutorial listens |
| `welcome-screen:shown` | `{ player }` when the welcome screen is up | Tutorial, Welcome listen |
| `league:areas` | `{ player } -> { league, unlocked: [area ids], next: { slot, tasks } \| null, available }` | LeagueAreaUnlocks |
| `league:area-at` | `{ x, y, player \| league } -> { area: id \| null, name }` | LeagueAreaUnlocks |
| `league:relic-triggered` | `{ player, relic }` when a relic's effect fired (Undying Retribution) | nobody yet |
| `ironman:set-mode` | `{ player, mode } -> { handled }` (the Ironman plugin's) | LeagueMode emits at a league login |
| `ironman:change-mode` | `{ player, from, to, allowed, reason }` (the Ironman plugin asks before a setup choice) | LeagueMode refuses for a league character |

The client keeps one `structOverrides` and one `enumOverrides` set and replaces each whole on
every dataset (`GamemodeContentStore`), so no plugin sends them itself: LeagueMode sends the lot
at login and whenever a plugin emits `league:send-content` (before its interface opens), after
collecting every plugin's rows with `league:content-rows`.

The tier passives answer other plugins' questions rather than events of their own (below):
`npc-drops:chance` and `drops:chance`, `minigame:points`, `slayer:task-reward`,
`slayer:superior-spawn` and `treasure-trails:scroll-boxes`.

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
  hook's `multiplier`; the other tier passives are under "Tier passives" below.

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

- Before each, script 2524 sizes the modal, as live ran it: (-1, -1) for the Summary and Rank,
  (-1, -3) for the Info panel and the relic interface.
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
killed (`onPlayerDefeated`), damage dealt to NPCs and the highest hit (each hitsplat's `onApplied` as it lands, attached in
`onCombatHitResolved`, so a cancelled projectile counts nothing),
damage taken from NPCs (`onCombatHitResolved`), food (`food:eaten`), potions (`potions:drunk`),
fish, ore and logs (`fishing:success`, `mining:success`, `woodcutting:success`). Stubbed at 0 for
want of a source: echo bosses killed (none here), coins gained and lost, clues completed (no
completion event), special attacks used (the special flag is cleared before the hit resolves) and
the highest value item worn.

## Tutorial

`league/Tutorial.LeagueMode.js`, data `league-tutorial.json` (generated from the two recorded runs
on new characters: osrs-captures 227/00196 Raging Echoes and 237/01098 Demonic Pacts). A new
league character starts at `league_tutorial_completed` 0; the client draws every page (title,
body, buttons, picture) from the league struct's param 1033 tutorial struct, with enums keyed by
that varbit, so the server only moves the varbit and opens the screens. A character that joined
before the tutorial existed has no stage and counts as finished: the login sends the league's
finished value, 12 (every Raging Echoes capture's login) or Leagues VI's 14 (243 logins sent it).

- **Screens, as captured before every page:** `league_tutorial` (653) in the toplevel's
  `overlay_atmosphere` (161:1) with its click blocker 653:1 shown, `mesoverlay` (263) in
  `chatbox:crmclose` (162:565 in this cache), script 1974 with an empty line, script 2524 (-1, -1)
  and `league_tutorial_main` (677) as the main modal, closed and reopened at each stage so the
  client draws the new page. `orbs_disabled` (4084) and `chatoverlay_allowmesoverlap` (10690) are 1
  while it runs. It opens once the welcome screen's Play is clicked, or the new character's design
  closes. Not sent, though captured: `minimap_toggle` (no such packet here), `side_journal_tab` = 1
  with the quest list mounted on Get Started (this client mounts journal tabs on their click), and
  the orbs interface reopened at the end (this client keeps it).
- **Stages** (Raging Echoes; Demonic Pacts adds 11-13 and finishes at 14): 0 the welcome page, Get
  Started (677:9) sets `league_3_has_seen_cutscene` and jumps to 3; 3 flashes the journal stone
  (`flashside` 3, OP1 armed on stone2 of every gameframe layout: 161:61, 164:54, 548:66) until it is
  clicked; 4 flashes the journal's Leagues tab (script 3162 on 629:42) until the side panel (656)
  mounts, which awards "Open the Leagues Menu" (`open-the-leagues-menu`; a mount at stage 3 counts
  for both steps); 5 / 7 / 9 pulse the Tasks / Areas /
  Relics buttons (script 3185 on 656:35 / 39 / 43, 3186 stops it) and, when the section's screen
  opens, run its walkthrough (6 / 8 / 10); Raging Echoes then waits for an area unlock
  (`league:area-unlocked`) and every league for a relic pick (`league:relic-unlocked`); 11 (13 for
  Demonic Pacts) is Finishing Up, whose End Tutorial (677:8) awards "Complete the Leagues
  Tutorial" (`complete-the-leagues-tutorial`), restores the orbs and closes the screens. Both tasks
  go through the task catalog's `league:complete-task` (its points, list bit and message); with no
  catalog on the server they pay 10 points each through `league:award-task`. Exit
  Leagues (677:8 on the first page) logs the character out (ours: never pressed in a recording).
- **Other plugins' screens:** the task list (657) and the area map (512) belong to their own
  plugins. The tutorial never handles their buttons; it watches for their screen to open through
  the core's `interface:opened` (reacting once the opening plugin has finished, a microtask
  later), and a section whose screen has not opened two ticks after its button was clicked is
  skipped (on a server without the
  tasks and areas plugins, 5 goes to 7 and 7 to 9). Demonic Pacts' pacts section (stage 11, the
  tree 647) runs no walkthrough: its middle step waits for a pact point to be spent in an interface
  this server does not have, so its button goes straight to 13.
- **Always finishable:** besides the skip, a relic picked or an area unlocked before its page counts
  when that page's walkthrough ends (the relics' `league:relic-unlocked` state, the area selection
  varbit 10663); the page or a section's screen closed half way (Escape, walking away) brings the
  page back a tick later unless another screen replaced it, and the walkthrough starts again when
  the screen is reopened (a walkthrough already seen this session is not shown twice); a relog
  resumes at the page of a walkthrough stage.
- **Walkthroughs** (`plugins/interface/ScreenHighlight.plugin.js`, usable by any content): the
  cache's `screenhighlight` (664) in the screen's `tutorial_highlight` layer (657:14, 512:13,
  655:13) with OP1 on Continue (664:31) and Previous (664:32) slot 9, script 3408, the varbits
  `hnt_selected_hint` / `hnt_hint_step` / `hnt_hint_max_step`, and per step a box (3409) or a
  framed component (2463) and its text (3413 or 2465), with the arguments, texts and colour (the
  league struct's param 1027) each recording shows. The pause button live also arms (664:9) is not:
  its resume packet reaches this server as a dialogue continue. On this web client the first click
  after a step redraws can go to the component that was under the pointer before; a second click
  (or any mouse move first) reaches Continue.
- **Per league:** Raging Echoes and Demonic Pacts are as recorded. Trailblazer Reloaded and
  Trailblazer use Leagues V's tutorial struct (747), whose text this cache writes for Leagues V, so
  they get copies of its title and body enums with their own name through the content payload, and
  Raging Echoes' walkthroughs with their name. Twisted's struct has no tutorial and Shattered Relics'
  is a different flow (its class choice), so neither starts one.

## Welcome screen

`league/Welcome.LeagueMode.js`: on a league world the welcome screen's message of the week
(`welcome_screen:motw`, 378:6) reads, as captured, `Welcome to Old School RuneScape: <league>!`
and, when world.json's pluginConfig `league:end` (an ISO date) is set, `There are N days remaining
in this League.` WelcomeScreen emits `welcome-screen:shown`.

## Records

`league/Records.LeagueMode.js`: the main game's league screens, as captured on rev 229
(osrs-captures 229/00690-00702). Each opens as the main modal after script 2524 (-1, -1).

- **Points:** at a main character's login on a plain world, the account's league save is read
  through the persistence backend. LeaguePoints totals its tasks (`league:saved-points`), and the
  total goes out as that league's main-game varp (2771, 2772, 3275, 4032, 4556 or 5507, the ones
  script 9462 reads). An account keeps one league character, so the other leagues read 0.
- **Trophies (447):** the Leagues Tutor's Claim-trophies, its conversation's open_interface
  "League trophies", and `::leaguerecords trophies` open it. The setevents cover OP1 and OP10 on
  447:3, and script 1128 takes the title and five masks over enum 2778's trophies. A set bit shows
  Take, a clear one Store. The client hides a trophy above the league's points (script 1129).
- **Take and Store:** a trophy is the Tutor's to hand out while the character holds none of it in
  the inventory, equipment or bank (a bank placeholder doesn't count), so a lost one can be taken
  again (Wiki "League trophy"). Take hands out an earned one; Store takes it back from the
  inventory. Each click resends the masks through script 1130, and op10 examines. A click with
  the screen closed does nothing.
- **Accomplishment scroll (41182):** League-statistics opens 449 with script 1110 (the owner's
  name and each league's points). League-rankings opens 445 and nothing else. League-firsts opens
  676 with script 3698 on the newest league, with OP1 on one dropdown slot per league; a pick
  redraws that league. Rankings and firsts are the cache's own tables.

On a league world none of this applies: the Tutor's Claim-trophies and the scroll's options fall
through to their defaults. Bots and agent players never read a league save.

## Reward shop

`league/Rewards.LeagueMode.js`: the Leagues Reward Shop (`league_rewards`, 658), as captured on
league worlds (osrs-captures 227/00100, 02120, 237/01098).

- **Stock:** the cache's. Each league struct lists its reward structs in param 87, with the name
  (363), item (150) and cost (151). A set (the Relic Hunter outfits, six ornament kits) lists every
  item it gives in the enum param 915 names; param 2068 is how many of the item a set-less reward
  gives. The client draws every league's rewards, rows running across the leagues in order; this
  cache has 65, as rev 237 did.
- **Opening:** the Leagues Tutor's Trade (main game) and Rewards (league world) options, the
  conversations' open_shop "Leagues Reward Shop", and `::leagueshop`. It sends script 2524 (-1, -1),
  the modal, and OP1 on 658:9 over one slot per reward. The Bank PIN guards it first.
- **Buying:** a row click sets `league_rewards_shopselection` (10110) to the row. Confirm (658:22)
  sells the selected reward in the main game, if the points left cover it and the inventory has a
  slot for each piece. The points left are each league's points (Records) less what the character
  spent of them (`league:reward-points-spent`, by league type), sent as varp 2613. Confirm's click
  shows a loading layer (658:24) no script hides, so the shop closes and opens afresh a tick later.
  Closing the shop forgets the selection.
- **League worlds:** the shop opens to browse. Live sends no points there, and the client hides
  Confirm where the league struct's param 2053 says so. A Confirm that reaches the server gets the
  client's own line, "You can purchase these rewards on a Non-Leagues world."

The Wiki pools every league's points. This server knows one league per account, the one its league
character played. On this server's NPC spawns only `::leagueshop` reaches the shop: the one Leagues
Tutor spawned (315, Lumbridge) has neither Trade nor Rewards, and `npc-interactions.json` binds its
Talk-to to a custom shop, so its conversation never runs.

## Shattered Relics

Leagues III's own screens (`league/Shattered.LeagueMode.js`, `Fragments.LeagueMode.js`,
`Unlocks.LeagueMode.js`, data `league-shattered.json`). No recording exists (the league ended in
March 2022, before the captures' rev 223), so every packet is from the cache's scripts and every
rule from the Wiki's Shattered Relics pages. They draw only for league type 3 (varbit 10032).

- **Side panel (736):** the journal's Leagues tab mounts it instead of 656
  (`journal.sidePanelByLeague`). It draws points, tasks and Sage's Renown from varps. Its Info
  button opens the Info panel, Tasks emits `league:open-tasks` for the task list, and Fragments and
  Unlocks open their screens.
- **Sage's Renown:** `league:renown`, sent as varp 3276. A task award pays its tier's renown, read
  from its points (Wiki /Tasks: 5 points pay 1, 25 pay 2, 50 pay 3, 125 pay 4, 250 pay 5). Other
  amounts pay none. `::renown <amount> [player]` grants it too.
- **Class choice (737):** at the first login, and every login until chosen. Select sets varp 3345
  so the client shows that class's confirm panel. Accept unlocks its combat skill (script 5830's
  varbit), gives its fragment at level 1 and its items. 737 names the items; their amounts are this
  server's choice. Items that don't fit the inventory go to a bank tab with room; with no room for
  the whole kit, Accept gives nothing and the class stays unchosen.
- **Fragments (735):** owned fragments (fragment XP, varbits 13403-13455) and the seven slots
  (varbits 13395-13399, 13401, 13402) are saved. Slots open at the points enum 4127 gives. Equip
  puts an owned fragment in the first open empty slot, never twice; Unequip and Unequip all clear
  them.
- **Fragment XP:** each equipped fragment gains 1 XP for any XP gained in an unlocked skill, at
  most once every 4 ticks (Wiki), through the core `onExperienceGained` hook. Levels 2 and 3 come
  at 2,000 and 8,000 XP (script 5789), where a fragment stops. A set's tier counts the equipped
  fragments that list it (enum 4137: 2 or 3 pieces).
- **Drops:** a skill's XP may turn up its category's Unidentified fragment, the likelier the more
  XP; a kill may turn up the combat one, by the NPC's hitpoints, carrying the NPC's tier on the
  item (the Wiki's boss lists; any other NPC tier 1). Break opens it into a fragment not yet
  mastered whose own item it is (enum 4136 param 1462), for combat of its tier (param 1454) or the
  nearest with one left: new at level 1, or 500 XP for one already owned (Wiki). The rates are this
  server's; misc fragments have no listed source, so only `::fragment` gives their item.
- **Effects (batch 1):** Unholy Warrior / Ranger / Wizard (accuracy at 0 Prayer points),
  Bottomless Quiver (ammunition and bow charges saved, through the core `combat:ammo-saving`),
  Arcane Conduit (runes and powered-staff charges), Larger Recharger, Divine Restoration,
  Venomaster (poison on hit, poison and venom immunity), Slay All Day, and the sets Absolute Unit,
  Drakan's Touch, Twin Strikes, Double Tap and Chain Magic. Each fragment works with the number
  its level gives in the cache (params 1456-1458; Venomaster's are poison severities 15/25/35,
  hitting 3/5/7); the sets' numbers are only in their texts. Venomaster's chance (25%) is this
  server's, and its immunity stops new poison without curing a running one. The extra rolls are
  rolled with the hit's own spell, never a special attack, and pay XP like any hit, for no more
  than the hitpoints left after the damage already queued (none after a killing blow). The per-tick
  effects run as one task per Shattered Relics character, from login.
- **Effects (batch 2):** Tactical Duelist (melee weapon charges saved: the scythe of vitur, the
  crystal halberd and Arclight ask `combat:melee-charge` before spending one), Livin' On A Prayer
  (the core `registerPrayerDrainRateModifier` scales what active prayers add to the drain counter
  each tick), Special Discount (the core `registerSpecialEnergyCostModifier`, which every energy
  check and `CombatSpecial.drain` use; the cache's 500/400/250 are tenths of a percent; the Dragon
  hasta's Unleash spends all energy, which isn't its cost, so it isn't capped), Thrall
  Damage (`magic:thrall-max-hit`, asked on each thrall attack), Superior Tracking
  (`slayer:superior-spawn`; this server reads its text, which names no unlock, as working without
  Bigger and Badder, but never once superiors are toggled off), Slay 'n' Pay (`slayer:task-reward`'s multiplier,
  Mortimer's too), the god-armour four, and the sets Fast Metabolism (each Hitpoints regen heals
  four times as much, through `stats:hitpoints-regen`) and Knife's Edge (every style's max hit, in
  permille so it stays exact). The god-armour four need four worn items of their god, counted as
  the God Wars Dungeon counts protection (`godwars:god-items`, so a godsword counts): Bandosian
  Might adds its number to the melee max hit per tick of the weapon's attack speed, Zamorakian
  Sight raises magic accuracy, Armadylean Decree raises enchanted bolt chances
  (`combat:bolt-effect-chance`, after the Kandarin diary and the Armadyl crossbow's special), and
  Saradominist Defence adds to every style's max hit for 6 ticks after combat damage from an NPC
  or player lands (poison isn't a hit, so it never counts; nor does a boss's scripted damage that
  skips the combat hit). Max hit bonuses add before Knife's Edge multiplies. The god-armour count
  is God Wars' protection count (the Wiki's tables, so god books, symbols and blessings count too);
  magic specials with a fixed max hit skip both max hit
  bonuses, as they skip every magic max hit modifier.
- **Unlocks (733):** skills, bosses and quest packs bought with renown, at the cache's prices for
  skills and bosses. Quest packs have no price in the cache: each pack's varbit holds its price
  now, from the Wiki's Initial Cost less the prerequisite packs already unlocked, and 0 once
  unlocked. Buying a pack unlocks its prerequisites. Defence, Fishing and Thieving start unlocked.
  Nex can be bought only once every God Wars general is unlocked.
- **Locks:** a locked skill gives no XP, and a locked boss can't be attacked, by the player or its
  thrall (its NPC names are in the data, raids by their final boss). Kraken's Disturb and Vorkath's
  Poke ask `league:boss-locked` before waking them. Wintertodt and Tempoross aren't attacked, so
  their locks aren't enforced, and instance entries (Zulrah, the Gauntlet, raids) aren't refused,
  only the fights inside. The Wiki gives no message for either lock; the boss one is this
  server's, said once per boss every few seconds.

Not yet: the skilling, production and misc fragments' effects, the ranged weapons' own charges
(no hook reports them), and the other sets (Greedy Gatherer, Personal Banker, The Alchemist, The
Craftsman, Unchained Talent and the three that give a Sage item); quest packs complete no quests; fragments can be swapped anywhere, not only at a bank or the Sage, and only
through Equip (dragging one into a slot isn't handled); the
Display Fragments toggle (varbit 12383) is the client's own; the intro cutscene (734) has no
recording or client driver, so it isn't played.

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
  or a bank tab, so a permanent pick is never saved without its items; the room check is
  item-aware (a stackable item joins its inventory stack, an item already banked joins its bank
  stack and needs no slot, a new bank stack takes one slot of the player's bank space, which
  every tab shares, and a slot one item takes is not counted for the next), and each item
  goes where that check placed it: the inventory if it fits, else the bank tab holding it, else
  its tab or any tab with room. Refusals are game messages of ours. Items no longer in this cache (Sage's greaves, the Trailblazer tools, the crystal of
  memories, the guardian horn) are not granted; the data says so.
- **Effects** are other plugins' business: they ask `league:has-relic { player, relic }`, true
  only when the character's league has that relic and chose it. The tier passives are
  LeagueMode's (`league:highest-tier`), below.

## Tier passives

Each tier's passive text is the Wiki's (`league-relics.json`); the effects are
`leagues.json` `passives`, per league, each from the 1-based tier its `fromTier` names (a map
picks the highest tier reached), applied by `league/Passives.LeagueMode.js` and
`league/BoostedDrops.LeagueMode.js` to a league character of that league and to nobody else.
Tier 1 counts once the character chose its first relic.

- **XP rate** (both: 5x, 8x from tier 2, 12x from tier 5, 16x from tier 7): the
  can-gain-experience hook's `multiplier`, as above.
- **Combat XP** (Raging Echoes tier 3): Attack, Strength, Defence, Ranged, Magic, Hitpoints and
  Prayer gains x2 on top of the league rate (multiplicative, as the Wiki says; Slayer is not
  listed and not included).
- **Run energy** (tier 1): the run energy drain modifier (`api.registerRunEnergyDrainModifier`)
  returns 0 for the character, so running never drains.
- **Boosted drops** (Trailblazer Reloaded 2x/3x/4x/5x from tiers 1/4/6/8; Raging Echoes 2x then
  5x from tier 4): `league-boosted-drops.json` is each league's Boosted drops page (fetched
  2026-10-26), a source per Wiki row group with the NPC names it covers and the item names it
  boosts (group rows expanded by hand; N/A rows left out; rows one page lists carry `leagues`).
  NpcDrops asks `npc-drops:chance { player, npc, npcId, source, rules }` once per roll and the
  league pushes one rule `{ pattern, multiplier }` matching that source's items, which NpcDrops
  applies to every form of roll ([docs/npc-drops.md](../../docs/npc-drops.md)): a weighted roll's
  boosted weight grows and the pool with it, so 1/512 at 5x is 5/516 (the Wiki rounds to 1/102).
  Superior Slayer monsters' unique tables and Treasure Trails caskets' "clue uniques" rows ask the
  same over `drops:chance { player, source: "superior-slayer-monster" | "treasure-trails-casket",
  rules }`, the pages' Global entries (a tier's "clue uniques" and mega-rare rows; an ordinary
  casket's Open and the Mimic's reward share `Rolls.uniqueMultiplier`). Kills whose
  table NpcDrops rolls are covered as they are, Araxxor's and Zalcano's included (their plugins
  roll through NpcDrops with the NPC named); the giant lairs' chests pass `source` (Obor,
  Bryophyta). Sources rolled by their own plugins are in the data but inert until that plugin
  asks `drops:chance` with the source's name: Revenants, the Grotesque Guardians, Corporeal
  Beast's sigils (not on its table here), the raids' unique chests, Barrows, the Gauntlet,
  Wintertodt, Tempoross, Guardians of the Rift, Fishing Trawler, the Grand Hallowed Coffin, Moons
  of Peril, the Colosseum, Hunter rumours, the Shrine, the seed pack, aerial fishing, the
  Fountain of Rune, Larran's and the brimstone chest, the Zombie Pirate's Locker, chewed bones,
  the Volcanic Mine ore pack, Pyramid Plunder, Tai Bwo Wannai, Shades of Mort'ton, and the
  pickpocketed blood shards (vyres) and teleport seeds (elves).
- **Minigame points** (Trailblazer Reloaded 3x/5x/8x from tiers 2/5/7; Raging Echoes 4x/8x from
  tiers 1/4): a minigame asks `minigame:points { player, minigame, points }` as it awards and
  the league multiplies `points` (floored). Wired, from the Raging Echoes League page's "Boosted
  minigame points" section (https://oldschool.runescape.wiki/w/Raging_Echoes_League; the
  Trailblazer Reloaded pages give no list, so both leagues use it): Pest Control
  commendations, Soul Wars zeal, Castle Wars tickets, Guardians of the Rift points, Mage Training
  Arena pizazz points, Volcanic Mine points, Giants' Foundry reputation, Mastering Mixology resin,
  Mahogany Homes points, Tithe Farm points, Brimhaven Agility Arena tickets and vouchers,
  Warriors' Guild tokens, Hallowed marks, marks of grace, stardust. Not on this server: Barbarian
  Assault, Rogues' Den, Trouble Brewing, Tai Bwo Wannai favour, Motherlode nuggets, molch
  pearls, Mining Guild minerals, chompy kills.
- **Slayer** (Trailblazer Reloaded tier 4, Raging Echoes tier 3): the Slayer plugin asks
  `slayer:task-reward { player, master, freeTasks, multiplier }` as a task completes (the league
  sets `freeTasks` 0 and x5 the points; every master's, Mortimer's and Krystilia's included, the
  Wiki naming none) and `slayer:superior-spawn { player, npc, unlocked, chance }` on a task kill
  (the league unlocks Bigger and Badder and makes the chance 1 in 50; the Slayer rewards'
  toggle-off still holds; a better chance from elsewhere stands).
- **Scroll boxes** (tier 1): ClueCapacity asks `treasure-trails:scroll-boxes { player, unlocked,
  capacity }` and the league answers unlocked with no limit, so every clue drops as a stackable
  box (the Wiki says stackable; live Leagues had no cap) before X Marks the Spot.

Left out, with why: Raging Echoes' clue-step progress saved between clues (the trail runtime has
no per-step save to carry across scrolls); Raging Echoes' one-minute farming ticks (Farming's
growth model has no tick-length seam, and Farming is under active work elsewhere); the
Trailblazer Reloaded ironman restriction and the crystal of memories (not in this cache).

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
  and 0 to half the Prayer level on each player fighting them. The cooldown is
  a timestamp attribute (0 when ready), reset by a real death (the defeated hook, which every
  death reaches; the death hook stops at the first plugin that handles the death, as the raids
  do, so a death inside one would never have reset it). A plugin that already prevented the
  death on this hook is honoured; one attached after this plugin would see the relic fire first,
  since every before-death hook runs. A prevented death counts for nothing in a raid (Wiki: no
  raid death penalties): core never starts the death task, so the Chambers, Theatre, Tombs and
  Archive death handlers, which take points, count deaths, jail, ghost and check wipes, never run.
- **The Arcane grimoire** (`ArcaneGrimoire.LeagueRelics.js`), the item Superior Sorcerer and Raging
  Echoes' Grimoire relic grant: for a league character its cache options, from the inventory or
  worn, are Change Spellbook (a chat choice of the other three books), Previous Spellbook (back
  to the book the last change left; it toggles) and Check Previous (ours: "Your previous
  spellbook was the Ancient spellbook."). The swap is the altars' (`MagicSpellbook.changeSpellbook`:
  Lunar's 40 Defence, autocast cleared, the tab, "You have changed your magic spellbook."); this
  server's altars gate the books on nothing else, so neither does the grimoire where the
  Trailblazer Reloaded relics page says "providing players have unlocked them". The previous book
  is the attribute `league:grimoire-previous-spellbook`, remembered only when a swap went through.
  Holding the item is the only check (it is untradeable and only a relic grants it; a spawned one
  works for any league character). Not covered: its Book of the Dead role (the resurrection
  spells' requirement, checked in core), and Raging Echoes' Grimoire unlocking every prayer and
  spell.

## The league tutorial

Not implemented; what it takes, from the Leagues V recordings (osrs-captures 227/00196 and
227/01718 are full runs, 227/00546 a logout at stage 0) and this cache. A league character is
sent `league_tutorial_completed` 10037 = 12 (finished) at login until it exists.

- **A stage machine on varbit 10037** (0 to 12; Leagues VI has two more). The server only sets
  the varbit and (re)opens the interfaces: `league_tutorial` 653 as an overlay in 164:1 with its
  click-blocker 653:1 unhidden, `mesoverlay` 263 in the chatbox (162:564), scripts 1974 "" and
  2524 (-1, -1), then the modal `league_tutorial_main` 677 in 164:16; every stage change repeats
  that block. The client draws each stage's title, body, buttons and graphic itself from the
  league struct's param 1033 tutorial struct (enums keyed by 10037: Raging Echoes' struct 6211
  points at struct 747 and enums 3379-3383). Check that Trailblazer Reloaded's struct 4699 still
  carries them; if not, send them as `structOverrides` / `enumOverrides` like the relic catalog.
- **First login** (00196): `orbs_disabled` 4084 = 1, `minimap_toggle` 0, a teleport to Lumbridge
  (3221, 3216, 0), and the starting kit as the inventory (a dramen staff, bronze axe, pickaxe,
  tinderbox, net, shrimp, bronze dagger and sword, wooden shield, shortbow, 25 bronze arrows, 25
  air, 15 mind, 6 water, 4 earth and 2 body runes, a bucket, a pot, bread); the tutorial opens
  after the welcome screen's Play (378:72). The dramen staff is simply in the kit; The Sage
  (14143/14144 at 3222, 3213) talks only about combat achievement rewards and echo items in these
  recordings (the Wiki's "claim a free dramen staff from The Sage" is Trailblazer Reloaded's).
- **The stages:** 0->3 "Get Started" (677:9; sets `league_3_has_seen_cutscene` 13488 = 1); 3->4
  the quest tab (164:54, script 3162 flashes the journal's Leagues tab); 4->5 the journal's
  Leagues tab, which also awards "Open the Leagues Menu" (+10) and mounts the side panel (script
  3185 highlights 656:35); 5->6 the panel's Tasks button (656:36) opens `league_tasks` 657 and a
  `screenhighlight` 664 walkthrough (scripts 3408/3409/3413/2463/2465, continue 664:31); 6->7 its
  last continue; 7->8 Areas (656:40) opens `trailblazer_areas` 512 with a walkthrough; 8->9 an
  area unlocked; 9->10 Relics (656:44) opens 655 with a walkthrough; 10->11 the first relic's
  item box; 11->12 "End Tutorial" (677:8), which awards "Complete the Leagues Tutorial" (+10), sets
  `orbs_disabled` back to 0 and closes 677 then 653. "Exit Leagues" (677:8 at stage 0) was never
  pressed in a recording.
- **What it waits on:** the task list (657) and the area interface (512) with their walkthroughs,
  and the tasks it awards; a tutorial that starts but cannot be finished is worse than none. A
  new league character also skips Tutorial Island on live; this server sends every new account
  there.

## Combat masteries (Raging Echoes)

`LeagueCombatMasteries.plugin.js`, data `plugins/modes/data/league-combat-masteries.json`
(https://oldschool.runescape.wiki/w/Raging_Echoes_League/Combat_Masteries): three styles of six
tiers, each needing the previous tier of its style (`requires` in the data), paid with Combat
Mastery points; the first time any style reaches a tier, a passive for every style comes with it.
Only a Raging Echoes character (league type 5) has any of it; a Trailblazer Reloaded or main
character sees nothing and earns nothing. Tiers live in `league:masteries` ({ melee, ranged,
magic }), points in `league:mastery-points` (challenge key -> 1) and the counted challenges'
progress in `league:mastery-progress`.

- **Points.** The Wiki's ten challenges, a point each in any order: a giant (the Giant page's
  race, `giants` in the data), ten monsters of combat level 100+, Scurrius with no other
  damager, a monster with a Slayer requirement of 55+, TzTok-Jad, combat level 100 (checked on
  every level-up and at login), one, two and three distinct Echo bosses, and TzKal-Zuk. Kills are
  judged on `onNpcDeath` by the NPC's name, combat level or Slayer level. As captured
  (227/00075) a point flips its `league_combat_mastery_point_unlock_N` varbit (11585-11594),
  raises `points_earned` (11584) and `points_to_spend` (11583) and shows the green game message.
  **No Echo boss exists in this cache**, so those three points come only from `::mastery point`;
  the data marks them `_missing`.
- **The interface, as captured.** The league side panel's mastery button (656:32) opens
  `league_combat_mastery` (311) as the main modal with `if_setevents` on its clickzones (311:36,
  0-18), menu frame (311:78, 10-18) and style tabs (311:73, 0-26), then runs 3186 on the panel's
  highlight (656:31). A tab click sets `league_combat_mastery_tab` (11596, the slot / 9); a
  clickzone click sets `league_combat_mastery_last_viewed` (11595) to its slot (Melee 0-5, Ranged
  6-11, Magic 12-17; 18 is nothing) and runs 7674 with 17 components, the node's struct (the
  cache's: Melee 1165-1170, Ranged 1171-1176, Magic 1159-1164) and its tier's passive struct
  (1153, 1154, 1156, 1155, 1157, 1158, the order the captured views used). Confirm (311:71)
  unlocks the viewed node: the style's progress varbit (11580-11582), `points_to_spend`,
  animation 8524, `league_5_mastery_unlock_spot` (3045) at height 92, the modal closed, sounds
  4215/4211/4213/4212 at 8/44/80/104. Close (311:76) closes it. Clicks count only after the button
  opened it. Login also sends `league_combat_mastery_tutorial` (17553) = 5 as both recordings
  did. The cache carries this league's masteries, so nothing is sent as struct overrides; script
  2524 before the open is not sent, as for the relic interface.
- **The checks.** A Raging Echoes character, a real tier, not yet unlocked, the previous tier of
  the style, a point to spend. Refusals are game messages of ours. Unlocks are permanent.
- **The masteries** (the Wiki's numbers in the data; `leaguemasteries/Melee|Ranged|Magic|AttackRate.LeagueCombatMasteries.js`):
  - The roll effects (Melee I, an echo's roll, Ranged I, Magic I and IV) act on the core's new
    `combat:hit-rolled`: the undefended roll and the range it came from, before protection
    prayers, shields and incoming-damage modifiers reduce it, which then apply to the result.
  - Melee I: a quarter of landed hits roll again and keep the higher. Melee II: a tenth of melee
    attacks on an NPC queue an echo a tick later, an ordinary melee hit of its own accuracy
    rolled from half the max hit (a special armed since the swing neither shapes it nor is spent
    on it, and stays armed), queued as any hit (its guards and XP), with the captured echo
    projectile (3186/3187, alternating). Melee IV:
    a twentieth of landed hits heal 40% of their damage. Melee VI: echoes on a fifth, and an
    echo may echo in turn, up to eight in a row.
  - Ranged I: a landed roll below 30% of the max hit (with Ranged II's bonus on it) becomes 30%.
    Ranged II: each attack after the first raises the max hit another 5%, back to nothing after
    +20% (counted on the attack's first accuracy roll of a cycle, which comes before the max hit
    is asked for a normal attack and for a special alike). Ranged IV:
    every fifth landed hit heals 5 a hitsplat. Ranged VI: a ranged roll against an NPC is forced
    accurate (an immune target still takes nothing).
  - Magic I: a landed roll above 90% of its max hit (the target's own: a barrage's secondary
    targets have theirs) deals 50% more. Magic II: +5% max hit for
    every idle tick between two magic attacks, up to +40% (our reading: the gap less the attack's
    own tick, noted on the cast's first accuracy roll; the first cast since login takes the cap;
    the Wiki does not say). Magic IV: a roll above 90% heals 10% of the damage when it
    lands. Magic VI: +1% max hit for every 100 hitpoints the target has, up to +10%, added to
    Magic II's, and a target with fewer hitpoints than the max hit (before Magic I, Wiki) takes
    the max hit. The max-hit changes ride the core's `combat:magic-max-hit` request.
  - Tiers III and V: the style's attack rate x0.8 rounded down, or x0.5 rounded down from five
    ticks and up below (`onAttackSpeed`, after the weapon's or spell's own speed, never under a tick).
- **The passives** (`Passives.LeagueCombatMasteries.js`), live once any style reached the tier:
  1 a 95% roll keeps the runes (`magic:rune-saving`), the staff's charge (`combat:consume-charge`)
  and the ammunition (the ranged ammo handler claims the decrement, so nothing is used or
  dropped); 2 every heal +20% (the core's new `stats:heal`, emitted by `Player.setHitpoints`
  whenever hitpoints rise: a raised heal reaches full hitpoints at most, an overheal keeps its own
  target); 3 the three attack rolls x2 (the accuracy modifiers); 4 damage taken x0.85 (the
  incoming-damage modifier); 5 Prayer restores x1.25 (the core's new `skills:restore`, emitted by
  `SkillManager.increaseCurrentLevel`, whose cap stays the caller's: prayer and restore potions,
  the Prayer plugin's bone restores, Doom's holy water and the Theatre's entry go
  through it; enchanted bolts, a few specials and the Falador shield set the level directly and
  are not raised); 6 60% Prayer penetration:
  the roll bypasses the target's protection prayer and the damage then takes 40% of the usual
  reduction (0.6 + 0.4 x the core's constant).

## Areas

`LeagueAreaUnlocks.plugin.js` (units in `leagueareas/`), data `plugins/modes/data/league-areas.json`.
A league character starts in Misthalin and Karamja (the Wiki's start; live unlocks Karamja free
during its tutorial, which this server has none of) and picks up to three more areas as its
completed tasks reach the league's thresholds: Trailblazer Reloaded 60, 140 and 300 tasks from
Asgarnia, the Fremennik Province, Kandarin, the Kharidian Desert, Morytania, Tirannwn, the
Wilderness and Kourend; Raging Echoes 90, 200 and 400, Varlamore among them (Wiki). Only the next
slot can be filled, a pick is permanent, and the unlocks live in `league:areas` (area ids in
unlock order). An area the league does not offer (Varlamore on a Trailblazer Reloaded world) stays
locked for good.

- **The areas** are the cache's: DB table `region_data` (82) gives each area its id (1 Misthalin,
  2 Karamja, 3 Asgarnia, 4 Kandarin, 5 Morytania, 6 Kharidian Desert, 7 Tirannwn, 8 Fremennik,
  11 Wilderness, 20 Kourend and Kebos, 21 Varlamore), name, the interface's shield and name
  components and its teleport hub (`area_teleport_coord`). The unlock spotanims are the cache's
  `league_<type>_area_unlock_emote_spotanim_<area>`.
- **The map** is ours, since the cache has no map-square to area table: each area lists 64 x 64
  map squares (`rects` and `squares`, map coordinates = tile >> 6) drawn from the Wiki's
  descriptions, over the cache's own map list (`CacheMaps.getRegionIds`). The lowest-numbered area
  naming a square owns it, a league's `overrides` reassign squares (the Stranglewood: Kourend in
  Trailblazer Reloaded, Varlamore in Raging Echoes), an unnamed underground square (map y >= 100)
  follows its surface square (the Wiki's "underground areas with an entrance in X"; Taverley
  Dungeon is Asgarnia's, the Underground Pass Tirannwn's by explicit squares), and a square nobody
  names is open to everyone: instances, Death's Office, the POH, random events, the essence mine,
  Tutorial Island (the Wiki's accommodations). Known approximations of the grid: the four tiles
  between Lumbridge and the Al Kharid gate and Catherby's beach east of x 2816 fall with Al Kharid
  / Asgarnia, the River Salve's east bank at Paterdomus with Misthalin, Tutorial Island's eastern
  tip with the desert. `league:area-at { x, y }` answers for any tile.
- **Enforcement** (a main character is never asked): a map-square change into a locked square
  (`onPlayerMapSquareChange`, once per square crossed, by a step or by a teleport, ladder, boat or
  dialogue) goes back to where it started when that is open (the Wiki's magical barriers, at
  square granularity), else to the league home; a respawn goes to the league home. The correction's
  own move is not treated as a new crossing. A teleport whose destination is known
  (`onCanTeleport`) is refused with a message. `player:respawn` sends a respawn another plugin
  landed in a locked square, or the world's spawn when that is locked, to the league home; the
  `onPlayerDeath` hook flags the player for that tick so a later respawn handler's landing is
  caught by the map-square rule too. The league home is the world's spawn, or Misthalin's hub
  (Lumbridge) when the spawn is locked (this world's spawn sits on the Wilderness ditch), so it is
  always open; a character that logs in inside a locked square (a new one at that spawn, an old
  one whose square the data no longer gives it) starts there.
- **The interface**, as captured (227/00070, 00075, 00095, 00196, 01710): the side panel's View
  Areas (656:40) opens `trailblazer_areas` (512) as the main modal with `if_setevents` on its menu
  frame (512:7, slots 10-18). A shield, a name or the name header (512:44) sets
  `league_area_last_viewed` (11693) and runs script 3668 with the area, the state and (rev 241) a
  string: 1 unlocked ("Teleport to"), 2 affordable ("Unlock"), 0 more tasks needed, 4 no slot left,
  3 a server message (an area outside the league); the texts of 0 and 4 and the refusal messages
  are the client's own (script 3676). Confirm (512:60) unlocks: `trailblazer_league_area_unlock_emote`
  8792 with the league's spotanim for the area, the modal closed, sounds 2353/2344/2330/2331 at
  24/116/241/273, and `league:area-unlocked` at once (the save is immediate); fourteen ticks later
  (the emote's length) the slot's `league_area_selection_N` (10662-10667) = the area id, the chat
  message "Congratulations, you've unlocked a new area: <col=league colour>Name</col>.", the
  interface opened again and the popup "Area Unlocked!" with jingle 281 (a logout in between
  loses only this half; the login resends the varbits). A task award that reaches the next slot's tasks shows
  "New Area Available!" with jingle 283 once and sets `league_area_available` (11695; recomputed
  at login and after an unlock, which the one capture of it did not show). The slots' task counts
  go to the client as `structOverrides` of structs 5971-5975 (param 1010, read by script 3682),
  through LeagueMode's content packet. Shield, teleport and confirm clicks count only after View
  Areas opened the interface.
- **The teleport** (512:82 on an unlocked area): the modal closes and a home-teleport cast lands
  the player within two tiles of the area's hub, as captured (Lumbridge, Brimhaven, Rellekka,
  Canifis, Al Kharid; the other hubs are the table's). No cooldown (some ninety casts in one
  recording); interrupted like a home teleport; refused in combat (ours) and by the usual teleport
  rules. Raging Echoes plays its captured cast (`home_teleport_human_echoes_1..5` with
  `vfx_league_5_home_teleport_01..05` at +1, +4, +9, +14, +18 ticks, landing at +21,
  `HomeTeleportSequence`'s `cast` option); Trailblazer Reloaded's own was not captured, so it plays
  the standard home teleport cast.
- **Not covered**: the world map's greying of locked areas (client-side), the league tutorial's
  guided first unlock, and slayer or transport content that should read `league:areas` itself.

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
- `::leaguerecords <trophies|statistics|rankings|firsts>` - open a main-game record screen.
- `::leagueshop` - open the Leagues Reward Shop.
- `::mastery` - your combat masteries, points and challenges; `::mastery <melee|ranged|magic>
  <tier 1-6>` unlocks one through the usual checks; `::mastery point <1-10>` awards a challenge's
  point through the real path (the only way to the Echo boss challenges here).
- `::areas [id or name]` - list your areas, the next unlock and the area you stand in, or unlock
  one through the usual checks (`::area` is AdminCommands' Area-class debug).
- `::renown <amount> [player]` - grant Shattered Relics' Sage's Renown.

## Not yet

Most task triggers (see Tasks), the Echo bosses (and so three of the mastery points), the tier
passives left out above (clue-step progress and farming ticks), the boosted sources their own
plugins have yet to ask about, and Shattered Relics' rules (see its section). Each is its own item
on the progress tracker.

The records have no POH league hall to stand in: its trophy case, pedestals and scroll need the
house's league hall, which this server doesn't build yet, so the scroll's options answer only where
the loc exists.

The cache's "League Skill Cape Shop" (652) is not a shop: its only script (3201) creates 22 tiny
cape items and prints "Loading: <cape>" for each, a model preloader. Nothing sells through it, and
the Wiki names no such shop.
