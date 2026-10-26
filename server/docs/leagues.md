# Leagues

The Leagues game mode (https://oldschool.runescape.wiki/w/Leagues) on this server: a league
character per account, League Points, relic tiers and relics. Plugins: `plugins/modes/LeagueMode.plugin.js`
(the profile, its league, XP rate, journal tab), `LeaguePoints.plugin.js` (points) and
`LeagueRelics.plugin.js` (tiers and relics); data in `plugins/modes/data/leagues.json` and
`league-relics.json`.

## The league character

Live OSRS runs Leagues on their own worlds, where an account plays a fresh character. Here a
world runs a league when its plugin config says so:

```json
"pluginConfig": { "league:type": 4 }
```

(4 Trailblazer Reloaded, 5 Raging Echoes; `world.local.json` can set it per deployment).
LeagueMode reads it at startup and claims the world's character profile (`api.setWorldProfile`,
`GameConstants.WORLD_PROFILE`), so every login is the account's **league character**, a save
kept apart from its main one (`persistence/PlayerProfile.ts`):

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
`league:type`. A new Trailblazer Reloaded character starts at Herblore 3, Runecraft 5 and
Agility 10 (Wiki). A main character never has a league, whatever its attributes say.

## Events

| Event | Payload | Who answers |
| --- | --- | --- |
| `journal:tab-mounted` | `{ player, groupId, tabIndex }` (SideJournalDefaults) | LeagueMode listens |
| `league:profile` | `{ player } -> { league: type \| null }` | LeagueMode |
| `league:login` | `{ player, league }` after a league profile's login | LeaguePoints, LeagueRelics listen |
| `league:highest-tier` | `{ player } -> { tier }` (0-based, -1 none) | LeagueRelics |
| `league:award-task` | `{ player, id, points, name } -> { awarded }` | LeaguePoints (once per id) |
| `league:points` | `{ player } -> { points, tasks }` | LeaguePoints |
| `league:points-changed` | `{ player, points, previous, tasks }` | LeagueMode (journal), LeagueRelics listen |
| `league:has-relic` | `{ player, relic } -> { active }` | LeagueRelics |

## What the client is sent

From the rsprox Leagues V recordings (osrs-captures 227/00070 and 227/00075; the packets are the
same for every league):

- Login: varbits `league_account` 10031 = 1, `league_type` 10032, `league_tutorial_completed`
  10037 = 12, `league_total_tasks_completed` 10046; varps `league_points_completed` 2614,
  `league_points_claimed` 2615, `league_points_previous` 2807; the relic selection varbits.
- A task award: 10046 and 2614 rise, then 2615; the popup (`notification:show`) "League Task
  Complete!" / "Task Completed: <col=ffffff>Name</col><br><br>Points Earned: <col=ffffff>N</col>"
  in the league's colour with jingle 283, and script 3226 refills the side panel's bar (656:23).
- The journal's Leagues tab (side_journal 629:34) shows once the varbits are set; a click mounts
  the league side panel (656) in the journal's content container (629:43) with the tab varbit
  8168 = 4, the way this client mounts its other journal tabs (live mounted it in its own slot).
- XP: the league's rate (5x; 8x from relic tier 2, 12x from tier 5, 16x from tier 7, Wiki tier
  passives) multiplies every gain after the world's rate, through the can-gain-experience
  hook's `multiplier`.

## Developer commands

- `::league [player]` - the character's league and points.
- `::leaguetask <id> <points> [name]` - award yourself a task through the real award path (the
  task catalog, LeagueTasks, does not exist yet).

## Not yet

League tasks, area unlocks, combat masteries, the other tier passives (drop rates, run energy,
clue boxes, minigame points, the ironman restriction), the league tutorial, trophies and
rewards. Each is its own item on the progress tracker.
