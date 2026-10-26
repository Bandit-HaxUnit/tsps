# Leagues

The Leagues game mode (https://oldschool.runescape.wiki/w/Leagues) on this server: a league
character per account, League Points, ranks, relic tiers and relics, and the league screens.
Plugins: `plugins/modes/LeagueMode.plugin.js` (the profile, its league, XP rate, journal tab, the
side panel's Summary / Info / Rank screens, ranks, statistics, the content its screens need),
`LeaguePoints.plugin.js` (points) and `LeagueRelics.plugin.js` (tiers and relics); data in
`plugins/modes/data/leagues.json`, `league-ranks.json` and `league-relics.json`.

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
| `league:saved-points` | `{ save } -> { points, tasks }` (an offline league character's save) | LeaguePoints |
| `league:account-points` | `{ player } -> { leagues, total }` (a main character's league points, by type) | LeagueMode (Records) |
| `league:award-renown` / `league:spend-renown` | `{ player, amount } -> { awarded }` / `{ spent }` (Shattered Relics' Sage's Renown) | LeagueMode (Shattered) |
| `league:renown` | `{ player } -> { renown }` | LeagueMode (Shattered) |
| `league:grant-fragment` | `{ player, id, xp? }` owns a Shattered Relics fragment | LeagueMode (Fragments) |
| `league:unlock-skill` | `{ player, skill }` unlocks a Shattered Relics skill for free | LeagueMode (Unlocks) |
| `league:unlocks` | `{ player } -> { skills, bosses, quests }` | LeagueMode (Unlocks) |
| `league:open-tasks` / `league:open-fragments` / `league:open-unlocks` | `{ player }` from Shattered Relics' side panel | LeagueTasks (#1358) / Fragments / Unlocks |
| `league:points-changed` | `{ player, points, previous, tasks }` | LeagueMode (journal), LeagueRelics listen |
| `league:has-relic` | `{ player, relic } -> { active }` | LeagueRelics |
| `league:relics` | `{ player } -> { league, chosen }` (tier index -> slot) | LeagueRelics |
| `league:content-rows` | `{ player, league, structs, enums }`: units push the rows the client lacks | LeagueRelics (Catalog), LeagueMode (Rank) answer |
| `league:send-content` | `{ player }`: send the content payload again (before an interface opens) | LeagueMode (Content) |
| `league:rank` | `{ player } -> { rank, name, next }` (ranks reached 0-7, the next threshold) | LeagueMode (Rank) |
| `league:statistics` | `{ player } -> { counters }` (the summary's rows by name) | LeagueMode (Statistics) |
| `league:joined` | `{ player, league }` the first time a character joins its league | LeagueMode (Tutorial) listens |
| `league:area-unlocked` | `{ player, league, area, slot }` when an area is unlocked | LeagueAreaUnlocks (#1352) emits; Tutorial listens |
| `league:complete-task` | `{ player, id } -> { found, completed }` | LeagueTasks (#1358) answers; Tutorial asks |
| `league:tutorial-stage` | `{ player } -> { stage }` (league_tutorial_completed while a tutorial runs) | LeagueMode (Tutorial) |
| `screen-highlight:show` / `:close` / `:finished` | a walkthrough in an interface (see Tutorial) | ScreenHighlight |
| `interface:opened` | `{ player, groupId, targetUid, type }` whenever a group is mounted (core, PacketSender) | Tutorial listens |
| `welcome-screen:shown` | `{ player }` when the welcome screen is up | Tutorial, Welcome listen |
| `league:relic-triggered` | `{ player, relic }` when a once-in-a-while relic fires (Undying Retribution, Last Stand) | LeagueRelics emits |

The relics also answer these generic questions, which their owners ask of any content (the
relics are the first askers; nothing changes when nobody answers):

| Event | Owner | Payload |
| --- | --- | --- |
| `ranged:ammo-saving` | core `CombatFactory.decrementAmmo`, the blowpipe and chinchompa handlers | `{ player, itemId, amount, saved }`: `saved` shots are neither broken nor dropped |
| `combat:consume-charge` | the powered staves (already), the crystal bow, venator bow, scythe, crystal halberd, Arclight, warped sceptre, bone staff | `{ player, itemId, skip }` |
| `combat:bolt-proc-chance` | EnchantedBolts | `{ player, target, itemId, chance }` after the gear's and the special's multipliers |
| `combat:status-apply` | core `CombatFactory.poisonEntity` (poison, venom), DragonfireProtection (dragonfire) | `{ target, kind, allow }`; `allow = false` and the status never takes |
| `combat-special:cost` | core `CombatSpecial` (the energy check and the drain) | `{ player, specialId, cost, available, allow, phase }`; `phase` is "check" or "drain"; `allow` lets a short player use it |
| `combat-special:regenerate` | core `RestoreSpecialAttackTask` | `{ player, amount }` a restore cycle (the cycle length is the lightbearer modifier's) |
| `skills:experience-gained` | core `SkillManager.addExperience`, after the gain | `{ player, skill, experience, multiplied }` |
| `storage:gather` (extended) | Mining, Woodcutting, Fishing | the existing `{ player, itemId, amount, stored }` now carries `skill` and the resource's `xp`, so a listener can bank or double what a skill gathered |
| `mining:attempt`, `woodcutting:attempt`, `fishing:attempt` | the skill, after its success roll | `{ player, ..., success }`: a listener may turn a miss into a hit (Fishing then lands the best fish the player can) |
| `mining:deplete-rock` | Mining | `{ player, object, rock, handled }`: handled keeps the rock standing |
| `fishing:tool`, `fishing:interval` | Fishing | `{ player, variants, variant }` when no tool was found; `{ player, ticks }` before each catch roll |
| `cooking:cooked`, `smithing:bar-for-ore`, `crafting:cut-gem`, `fletching:shafts` | Cooking, Smelting, Gems, Fletching | lookups: what a raw item, ore, uncut gem or log turns into and the XP |
| `hunter:catch-chance`, `hunter:rewards`, `hunter:lure-interval`, `hunter:jar-kept` | Hunter | `{ player, npcId, chance }` in the shared roll; `{ player, kind, npcId, rewards, xp }` for a trap's catch; `{ player, kind, ticks }` between an idle trap's looks; `{ player, kept }` for an impling jar |
| `thieving:loot`, `thieving:done`, `thieving:deplete-stall`; `pouchLimit` and `alwaysSucceeds` on `thieving:pickpocket-target` | Thieving | `{ player, npc, target, loot }` before the loot is handed over; `{ player, kind, npc \| object, succeeded, again }` after a pickpocket or theft (again repeats the click a tick later, while neither the player nor the NPC has moved); `{ player, object, handled }` before a stall empties |
| `agility:roll`, `agility:lap-reward`, `agility:mark` | Agility | `{ player, objectId, success }` after the obstacle roll; `{ player, course, count, xp }` before a lap is recorded; `{ player, location, items }` as a mark spawns |
| `skills:level-boost` | Crafting, Smithing, Herblore, Fletching and Cooking, where they check their own level | `{ player, skill, boost }`: an invisible boost |
| `skills:actions-per-cycle` | every make-X loop of those five skills (smithing sessions, fletching, mixing, cleaning, the crafting loops, pottery, cooking) | `{ player, skill, kind, recipe?, actions }`: how many items one cycle makes; `kind` names the loop (`smelt`, `smith`, `cannonballs`, the fletching group, `mix`, `clean`, `gems`, `leather`, ...) |
| `skills:produced` | each product of those loops | `{ player, skill, itemId, amount, xp }` once it is made |
| `herblore:mix` | Herblore, before a potion's ingredients go | `{ player, recipe, consume, returns, productId }`: a listener may lower a `consume` or `returns` count or change the product |
| `herblore:herbs` | Herblore | lookup: every herb `{ grimyId, cleanId, level, xp }` |
| `firemaking:light-roll`, `firemaking:logs-per-action` | Firemaking | `{ player, success }` after the lighting roll; `{ player, logId, amount }` for the logs one action burns |
| `shop:buy-price`, `shop:delivery` | core `ShopManager` (the price shown, the value check and the purchase; the purchase) | `{ player, shopId, shopName, currency, itemId, price }`: a priced item may become free (0), never below; `{ player, shopId, currency, itemId, deliverId }`: the purchase is handed over as `deliverId` (a note), whose own stacking decides the room it needs |
| `shop:can-sell`, `shop:sell-price` (extended) | core `ShopManager` | the existing payloads now carry `player` (when a player is selling) and `currency` |
| `magic:alchemy-policy` (extended) | core `MagicOnItemPacketListener` | asked before the level check (the zone rules still follow it), now with `requiredLevel`, `freeRunes`, `keepItem` and `recast` (cast again on the slot once this cast ends while it holds the same item); a plugin that turns the cast into something else (Mage Training Arena, While Guthix Sleeps) clears `confirm`, `keepItem` and `recast` |
| `bone-altars:offering` | BoneAltars | `{ player, itemId, boneItemId, cost, anyAltar }`: an item that is not a bone offered as `boneItemId`, `cost` of it an offering, and with `anyAltar` on any altar one prays at (the bone's burying XP; a private area's altars, a house's, stay its own) |
| `farming:plant-rules` | Farming, as a seed or sapling is planted | `{ player, crop, seedId, patch, keepSeed, grown, diseaseFree, undying, message }`: a line said after the planting's own; keep the seed, grow the crop at once (not anima plants), keep it from disease, or keep a diseased crop from dying (it waits for a cure); the last two are kept on the patch's state |
| `farming:harvests-per-action`, `farming:pick` | Farming | `{ player, patch, crop, harvests }` picks an action; `{ player, crop, patch, itemId, amount, experience, stored }` before a pick is handed over (`experience` is the pick's Farming XP; `stored` what a listener took itself, as the bank) |
| `skills:produced` (extended) | the production skills | now with `kind` (the loop, as `skills:actions-per-cycle` names it) and, for leather and jewellery, `materials` (`[id, amount]` one product used) |
| `construction:materials` | Construction, before a build's materials go | `{ player, buildable, materials }`: a listener may lower an amount |
| `magic:enchant-pieces`, `magic:spell-batch` | the jewellery enchantments; the Lunar crafting spells | `{ player, spellName, itemId, pieces }` pieces a cast enchants, each with its XP; `{ player, spellName, batch }` items a cast converts |
| `magic:alchemy-policy` (extended) | core alchemy | now with `high` (High Level Alchemy) |
| `minigame:points` | the Hallowed Sepulchre's coffins | `{ player, minigame, kind, amount }` before a minigame's reward points or tokens are given: a listener may raise `amount` |
| `thieving:pickpocket-target` (extended) | Thieving | now with `chanceBonus` (a percent more success, stacking as the gloves of silence do) and `painless` (a stun without the damage) |
| `prayer:bury` (extended) | Prayer | now scatters demonic ashes too (never for the bonecrusher's `crushed`) |
| `woodcutting:nest-chance`, `woodcutting:nest-drop` | Woodcutting | `{ player, multiplier }`: a bird nest `multiplier` times as likely; `{ player, itemId, handled }` before a nest falls (handled: a listener took it) |
| `farming:open-seed-vault` | Farming (the guild's seed vault) | `{ player, opened }`: the vault's menu from anywhere, behind the Bank PIN as at the guild |
| `miscellania:rules` | Managing Miscellania | `{ player, ruler, royalTrouble, payMultiplier, outputMultiplier, approval, visiting }`: who rules the kingdom (the quests), what the workers' pay costs, how much they gather (clues as rolled), an approval held fixed, whether a catch-up away from the islands counts as a visit |
| `miscellania:open` (extended), `miscellania:check`, `miscellania:collect` | Managing Miscellania | `{ player, opened }` opens the kingdom's interface; `{ player, handled }` reports the approval and coffers, or collects as Advisor Ghrim's Collect does |
| `npc-drops:tertiary-chance` (extended) | NpcDrops | a rule may give `outOf` (each matching entry at least 1 in that many) or `guarantee` (the rarest matching entry when none hit) instead of `multiplier` |
| `hunter:impling-clue-chance` | Hunter, opening an impling jar | `{ player, impling, tier, oneIn }` for each clue the jar can hold |
| `treasure-trails:vessel-chance` | Woodcutting and Hunter (clue nests), Mining (geodes), Hunter's drift nets and aerial fishing (bottles) | `{ player, vessel, tier, multiplier }`: the vessel `multiplier` times as likely |
| `treasure-trails:trail-length`, `treasure-trails:casket-rolls` | Treasure Trails (both trail kinds) | `{ player, tier, length, minimum, maximum }` as a trail starts; `{ player, tier, rolls, minimum, maximum }` as a casket opens; both kept within the tier's range |
| `treasure-trails:casket-opened` | Treasure Trails' caskets | `{ player, tier }` after a casket's rewards are handed over (not the Mimic's) |
| `treasure-trails:requirement-waived` | Treasure Trails | `{ player, kind, waived }`: `kind` "emote" (what to wear), "falo" (the item to show) or "charlie" (the item to bring) |
| `slayer:always-on-task` | Slayer, for a Slayer monster the task does not cover | `{ player, npc, npcId, name, onTask }`: counted as on task everywhere `slayer:on-task` is asked, and a kill gives its Slayer XP and superior chance without counting down the task (`offTask` on `slayer:task-kill`; no keys) |
| `slayer:superior-chance`, `slayer:superior-spawned`, `slayer:superior-rewards` | Slayer's superiors | `{ player, npc, oneIn }`; `{ player, npc, superior }`; `{ player, npc, normalId, drops, uniqueBoost, extraRolls }` as a superior drops: more rolls on the normal monster's table, a higher unique chance, drops of its own |
| `slayer:reward-cost` | Slayer's reward shop | `{ player, kind, cost, bit?, itemId? }` for an unlock, extension, cancel, block or purchase; never below 0 |
| `fairy-rings:destinations`, `spirit-trees:destinations` | FairyRings, SpiritTrees | `{ list }` -> `{ code, name, location }` for every ring with a destination; `{ player, list }` -> `{ name, location }` for the trees the player could travel to now |
| `construction:jewellery-box-destinations` | Construction's jewellery box | `{ player, list }` -> `{ label, location, wildernessLevel }` for the ornate box's destinations (its jewellery's Wilderness level: 30 for dragonstone pieces) |
| `treasure-trails:stashes`, `treasure-trails:current-step` | Treasure Trails | `{ list }` -> `{ tier, location }` for every STASH unit; `{ player, location, target }`: where the clue read last leads, while that trail is carried; `requirement-waived` now carries `itemId` (Falo's item) |
| `magic:spell-unlocked` | the Mage Arena's god spells | `{ player, spellId, unlocked }` asked before a locked spell is refused |
| `slayer:bracelet`, `slayer:remote-task` | Slayer | `{ player, npc, bracelet, chance, consumeCharge }` for the bracelet of slaughter; `{ player, allowed }` after a gem, ring or helmet check: a new task from the last master or a cancel, from anywhere |

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
  in the league's colour with jingle 283, and script 3226 refills the side panel's bar (656:23).
- The journal's Leagues tab (side_journal 629:34) shows once the varbits are set; a click mounts
  the league side panel (656) in the journal's content container (629:43) with the tab varbit
  8168 = 4, the way this client mounts its other journal tabs (live mounted it in its own slot).
- XP: the league's rate (5x; 8x from relic tier 2, 12x from tier 5, 16x from tier 7, Wiki tier
  passives) multiplies every gain after the world's rate, through the can-gain-experience
  hook's `multiplier`.

## The content payload

A league's screens read structs and enums the rev 241 cache only holds for the current league
(Demonic Pacts): the relic catalog, Leagues I-III's rank thresholds. `league/Content.LeagueMode.js`
asks every unit for its rows (`league:content-rows`) and sends them as one `structOverrides` /
`enumOverrides` payload (`sendContentData`; the client's `GamemodeContentStore` replaces the whole
set on each payload, which is why no unit sends its own; rows for one struct from several units
are merged into one) at a league login and on `league:send-content`. Virtual ids start at 200000 + league type x 1000; the relics use offsets
0-199, the ranks 900-901. A league the cache carries sends an empty payload (Demonic Pacts: no
overrides at all), which also clears whatever another league left in the client.

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
killed (`onPlayerDefeated`), damage dealt to NPCs and the highest hit (`onPlayerDealtDamage`),
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
  server's choice.
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
  rolled with the hit's own spell, never a special attack, and pay XP like any hit. The per-tick
  effects run as one task per Shattered Relics character, from login.
- **Gathering effects** (`league/FragmentGathering.LeagueMode.js`, data `gatheringEffects`): the
  harvesting fragments, Message In A Bottle, Greedy Gatherer and Personal Banker, through the
  skills' own events. Chef's Catch cooks a caught fish (`cooking:cooked`), Molten Miner smelts an
  ore into the bar whose main ore it is (`smithing:bar-for-ore`; coal makes nothing) and Slash &
  Burn burns a log (`firemaking:log-xp`), each with that skill's XP whatever its level. Greedy
  Gatherer brings two or three of each Mining, Woodcutting, Fishing and Farming resource with the
  XP of each, and Personal Banker banks them at 50% or always (then a full inventory gathers on).
  They compose on one resource: the fragment's change to every piece, the extras, then the bank or
  the inventory; extras go to an open container (a fish barrel, a log basket) first and fall to the
  floor when nothing has room (ours). What a container took of the resource itself stays as it was
  gathered (the containers hear `storage:gather` first), and a changed item the bank has no room
  for is banked as gathered, without the change's XP. Farming's extras never take the room the pick
  itself needs; a Fishing Trawler trip is no catch for Catch Of The Day. Farming's harvest (`farming:pick`, now with the pick's `experience` and
  a `stored` count) is noted and maybe doubled by Certified Farmer; Seedy Business keeps a seed
  (`farming:plant-rules`); Rock Solid keeps iron, sandstone and granite standing
  (`mining:deplete-rock`); Homewrecker makes Woodcutting's bird nests 2-4 times likelier and banks
  them (`woodcutting:nest-chance`, `woodcutting:nest-drop`); Message In A Bottle multiplies the
  clue nests, geodes and bottles (`treasure-trails:vessel-chance`); Catch Of The Day rolls
  NpcDrops' rare drop table once (`npc-drops:roll-table`) on a 1-in-N catch; Chinchonkers adds
  Hunter XP for a chinchompa and two of them at level 3 (`hunter:rewards`). The banked nest and
  rare catch messages are this server's.
- **Production effects** (`league/FragmentProduction.LeagueMode.js`, data `productionEffects`):
  the production fragments, The Alchemist, The Craftsman and Unchained Talent. The two
  all-at-once sets answer `skills:actions-per-cycle` with the inventory (28) for the Wiki's
  activities only (The Alchemist: cooking, cleaning, mixing; The Craftsman: smelting, smithing,
  cannonballs, leather, glass, uncut gems, pottery, battlestaves, spinning, fletching logs (bows
  and shields) and bolt tips). Unchained Talent keeps the non-combat skills 8 over their level, checked every tick
  (`league:fragment-tick` from the fragment task), and takes the boost off with the set; Sailing,
  which the league predates, is left out (ours). The fragments hear `skills:produced`, which now
  carries the loop's `kind` (and `materials` for leather and jewellery): Smithing Double (an anvil's
  product again with its XP, falling when the inventory is full), Imcando's Apprentice (gemmed
  jewellery again with its XP, only with room), Dragon On A Bit (dragonhide armour's leather back
  to the bank), Dine & Dash (another cooked food to the bank, no XP, never untradeable food or in an
  instance), Profletchional and Just Druid! (more XP for logs and stringing, and for cleaning),
  Pro Tips (more bolt tips a gem, rounded down: ours). Mixologist answers `herblore:mix` (a potion
  from an unfinished one with four doses; its secondary kept at the Wiki's 20/50/100%), Rooty Tooty
  2x Runeys `runecrafting:success` (each rune its chance of another, Guardians of the Rift's altars
  too), Plank Stretcher `construction:materials` (a build's planks kept: hotspots, staircases and
  the workbench's flatpacks, through House's `useMaterials`), Enchanted Jeweler
  `magic:enchant-pieces` (jewellery only, not a quest's enchanted rod or sickle),
  Rumple-Bow-String `magic:spell-batch` (Spin Flax) and Alchemaniac `magic:alchemy-policy` (High
  Alchemy only, by the policy's new `high`).
- **Skilling effects** (`league/FragmentSkilling.LeagueMode.js`, data `skillingEffects`): the
  skilling fragments and Clued In. Praying Respects buries and scatters the remains a kill drops
  through Prayer's own `prayer:bury` (which now scatters demonic ashes too) at 50/100/200% of their
  XP, and takes them off the drop (`npc-drops:roll`; NPC drops only: ours). Smooth Criminal raises
  Thieving's own pickpocket chance by its percent, stacking as the gloves of silence do, and from
  level 2 stuns without the damage (`chanceBonus` and `painless` on `thieving:pickpocket-target`).
  Deeper Pockets doubles the loot (`thieving:loot`; coins as another pouch). Hot On The Trail gives
  the Wiki's tier of scroll box for the log lit (`firemaking:success`, and `league:log-burnt` for
  Slash & Burn's logs) while the clue capacity allows another (`treasure-trails:can-receive`); logs
  the league predates give none (ours). Golden Brick Road puts its coins beside a mark of grace
  (`agility:mark`). Grave Robber raises a coffin's hallowed marks, the Grand Hallowed Coffin's too
  (ours), through the Sepulchre's new `minigame:points`. Clued In makes each clue scroll an NPC drops
  at least 1 in 30/25/15 (`npc-drops:tertiary-chance`). The scroll box message is this server's.
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

Not yet: the other fragments' effects (Barbarian Pest Wars, Rogues' Chompy Farm and Mother's
Magic Fossils; Rune Escape, which needs the
Ourania Altar this server doesn't have; Plank Stretcher outside a house build, as Mahogany Homes; Tactical
Duelist and the ranged weapons' charges, which no hook reports; Livin' On A Prayer, Special
Discount, Thrall Damage, Superior Tracking, Slay 'n' Pay and the god-armour four) and the other
sets (Fast Metabolism, Knife's Edge and the three that give a Sage item); The Alchemist's jugs of
wine (no wine making here); Fishing has no clue bottles of its own, so Message In A Bottle
reaches only Hunter's aerial fishing and drift nets for bottles; quest packs complete no quests; fragments can be swapped anywhere, not only at a bank or the Sage, and only
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
  or a bank tab, so a permanent pick is never saved without its items; each item goes to the
  inventory if it fits, else to its bank tab, else to any tab with room. Refusals are game
  messages of ours. Items no longer in this cache (Sage's greaves, the Trailblazer tools, the crystal of
  memories, the guardian horn) are not granted; the data says so.
- **Effects** are other plugins' business: they ask `league:has-relic { player, relic }`, true
  only when the character's league has that relic and chose it. The tier passives' XP rates are
  LeagueMode's (`league:highest-tier`); the other passives are not implemented. The relics this
  plugin implements itself are units `leaguerelics/<Relic>.LeagueRelics.js`, gated by
  `Common.effectActive(player, effect)`: the effect's `league` (a type, or several for a relic
  both leagues have) and its `key` (or an alias: the catalog's `last-stand-preview` and
  `treasure-seeker-preview` stand in for relics the Wiki lists once; #1324 pads those tiers).
- **The catalog's padding.** The Wiki gives Trailblazer Reloaded's tiers 2 and 3 and Raging
  Echoes' tier 6 two relics each; the catalog fills the third slot (`crystal-of-memories`,
  `treasure-seeker-preview`, `last-stand-preview`). The previews get the real relic's effect.

### Not in this cache

No unit, and the data says so: the **Guardian** of both leagues (no guardian horn, and a thrall
with its own combat would be a feature of its own), **Infernal Gathering** (no Trailblazer tools),
the **Crystal of Memories** entry (no item), **Ruinous Powers** beyond the book it grants (the
server has no Ruinous Powers prayer book), and the Sage's greaves of **Trickster** and **Corner
Cutter** (the rest of those relics is another PR's).

### Trailblazer Reloaded's combat relics

These relics have their effects (`leaguerelics/*.LeagueRelics.js`, numbers in the data's
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
- **Archer's Embrace** (tier 4): ranged speed halved (`onAttackSpeed`: above 4 rounded down,
  below 3 rounded up, so 3, 4 and 5 all become 2 as the Wiki's notes say), ranged accuracy x2,
  on a landed ranged hit a 10% chance of an extra `PendingHit` at the same target with a roll of
  its own (no ammunition spent and no projectile shown for it, a second hitsplat: ours; the extra
  never fires another), 90% of each volley's
  shots kept (`ranged:ammo-saving`, so an Ava's device recovers its share of the rest, the
  Wiki's 98%), the same 90% for a ranged weapon's charge (`combat:consume-charge` while the
  player's combat method is ranged: the crystal bow, venator bow, blowpipe scales and
  chinchompas), and enchanted bolts' chance x2 (`combat:bolt-proc-chance`). Not done: a bow of
  Faerdhinen's charges, which this server does not model.
- **Brawler's Resolve** (tier 4): melee speed halved the same way, melee accuracy x1.5, every
  defence x1.5 (the melee defence modifier, whose effective level the ranged roll shares too, and
  the magic one), a landed melee hit has a 10% chance to deal double damage
  (`onCombatHitDamage`), 90% of a melee weapon's charges kept (scythe, crystal halberd,
  Arclight), and immunity to poison, venom and dragonfire (`combat:status-apply`). Stuns and
  freezes still take, as the Wiki says roots and stuns do. Not done: "icy breath" and the other
  NPC-specific statuses the Wiki does not name. Superior Sorcerer's charge saving now checks the
  attack is a magic one, since every charge weapon asks the same question.
- **Soul Stealer** (tier 7): the minimum hit rises to 10% of the max hit (the max as combat
  computes it for that hit, floored, applied to every accurate hit), and a landed hit has a 50%
  chance to restore hitpoints and prayer by 10% of its damage rounded up. The restore skips
  special attacks and launches that struck more than one target in the same cycle (a scythe
  whose three hits land on one target counts; an enchanted bolt's effect is part of its hit, so
  it counts; a venator bow's bounces make its first hit a multi-target launch here, where the
  Wiki lets the first hit heal).
- **Weapon Master** (tier 7): special attacks against NPCs are forced accurate
  (`onCombatHitRoll`) and every special's hit is floored at 20% of the max hit, every restore
  cycle gives 30% energy (`combat-special:regenerate`; the cycle stays the usual 30 seconds, 15
  with a lightbearer), and a player short of energy may still use a special (`combat-special:cost`
  "check": `allow`), whose drain then costs 25 hitpoints and no energy ("drain": `cost` 0). Ours:
  the sacrifice needs more than 25 hitpoints, so it cannot kill.
- **Executioner** (tier 8): the Sage's axe is a ranged weapon in core's table
  (`RangedData.SAGES_AXE`, a dart-interface thrown weapon with +0 bonuses; the cache has no
  spotanim of its own for it, so it flies as a rune thrown axe: ours), with the relic page's 5
  tiles of reach (7 on long range; the item page's 6/8 is the later Demonic Pacts version) from a
  weapon profile and never used up (a ranged ammo handler). Its requirement in item-gameplay.json
  is 0 (Wiki: no requirements). A ranged hit on an NPC under 20% of its hitpoints (after the hits
  already queued) deals the rest of them (`onCombatHitDamage`), for the relic's owner only. The
  Kraken's ranged reduction applies afterwards as to any hit.

### Raging Echoes' combat relics

- **Specialist** (tier 8): every special costs 20% (`combat-special:cost`), rolls accuracy
  x2 while a special is active (the three accuracy modifiers), a special that misses refunds 10%
  (`onPlayerDealtDamage`, one refund a missed `PendingHit`), and any NPC kill restores 15%
  (`onNpcDeath`).
- **Last Stand** (tier 8; the catalog's tier 6 copy is an alias): a lethal hit from any source
  (`onPlayerBeforeDeath`) leaves the player at 1 hitpoint, boosts Attack, Strength, Defence,
  Ranged and Magic to 255 and opens a 16-tick window in which every lethal hit again leaves 1,
  food is refused (`onCanEat`) and any other heal is undone on the next tick (the Wiki forbids
  healing above 1 by any means and names no mechanism: ours). A tick task drains each boost 16 a
  tick down to base + 15; when the window closes the player is
  healed by the damage they dealt in it, capped at their max (ours: the Wiki shows a bar over the
  head and gives no formula; no bar here). Once every three minutes, reset by a real death
  (`league:last-stand-ready-at`). Not done: the Wiki's instant-kill exceptions (they are not
  hits here either), and the skills packet carries a boost as a byte, so the client's boost
  overlay for a 255 may read oddly while the level itself shows.

### Trailblazer Reloaded's gathering relics

- **Endless Harvest** (tier 1): what Mining, Woodcutting and Fishing gather is doubled and banked
  (`storage:gather` with the skill: two go to the bank and the inventory gets nothing; an open
  container such as a coal bag keeps what it took and the rest goes to the bank; when the bank
  has no room the extra goes to the inventory if it fits), the extra pays the resource's XP again
  only when it was placed, and `storage:room` says the bank's room counts so a full inventory
  keeps gathering.
  Forestry bark, Volcanic Mine fragments and sulliusceps never pass through `storage:gather`, so
  the Wiki's exclusions hold by construction.
- **Trickster** (tier 1): pickpockets always land and the pouch limit is tripled
  (`thieving:pickpocket-target`), the loot is doubled and noted (`thieving:loot`; coins come as
  pouches, so a second pouch stands for the double: ours; a clue, and an item that neither
  stacks nor notes, once), the pickpocket repeats itself while neither the player nor the NPC
  has moved (`thieving:done`), Agility rolls and fire lighting succeed (`agility:roll`,
  `firemaking:light-roll`), Hunter catches never fail (`hunter:catch-chance`), box traps give
  double loot and XP (`hunter:rewards`) and look for prey every 2 ticks instead of 5
  (`hunter:lure-interval`: the Wiki says "faster" and no more, so the number is ours), impling
  jars never break (`hunter:jar-kept`), and up to nine logs burn in one action
  (`firemaking:logs-per-action`, one fire, XP for each). Not here: the Sage's greaves (not in
  this cache) and the barbarian firemaking hotfix. "Always succeed" covers what the Agility,
  Hunter, Thieving and Firemaking plugins roll themselves: the Werewolf course, the Brimhaven
  arena, the Hallowed Sepulchre and the Chambers of Xeric tightrope roll on their own and still
  can fail.

### Raging Echoes' gathering relics

The Echo pickaxe, axe and harpoon sit in Mining's, Woodcutting's and Fishing's own tool tables as
crystal tools with no requirement (the Echo pickaxe page: always a 2-tick cycle, quicker than
this server's crystal pickaxe, which rolls every 3 ticks with a 1 in 4 chance of 2), and their
Toggle option cycles the relic's modes (`league:<relic>-mode`, our messages). Each tool's own
effects need the tool carried or wielded (Wiki); a relic's other effects (Lumberjack's sure fires,
Animal Wrangler's Hunter and cooking ones) do not.

- **Power Miner** (tier 1): a failed swing's second 50% chance (`mining:attempt`), ore straight
  to the bank (`storage:gather`), a rock that stands until its fourth ore
  (`mining:deplete-rock`; counted per rock for everyone who mines it: ours; the Wiki's
  mining-glove stacking is not modelled, gloves are not here), and the toggles: ore smelted into
  its bar (`smithing:bar-for-ore`: the furnace recipe whose main ore it is, its other ingredients
  waived, so a copper ore alone makes a bronze bar: ours) with the Smithing XP whatever the
  level, and gems cut (`crafting:cut-gem`) with the Crafting XP. Coal, never a recipe's main
  ore, is banked as it is.
- **Lumberjack** (tier 1): a failed chop's second 50% chance (`woodcutting:attempt`), logs
  straight to the bank, the toggles (logs burnt for their Firemaking XP, the default, through
  `firemaking:log-xp`; or fletched into arrow shafts for the bank with the Fletching XP, through
  `fletching:shafts`, which answers arrow shafts only, so a teak or mahogany log is banked as
  it is), and fires that never fail to light (`firemaking:light-roll`). The Wintertodt kindling
  variant is not here.
- **Animal Wrangler** (tier 1): the harpoon stands in for any fishing tool when none is held
  (`fishing:tool`; bait is still needed), catches come a tick sooner (`fishing:interval`), a
  failed catch's second 50% chance (`fishing:attempt`; it lands the best fish the player can
  catch at the spot: ours), fish straight to the bank (not
  karambwanji, which stay with the player as on live), half of them cooked on the way when the
  harpoon says so (`cooking:cooked`, the Cooking XP whatever the level; never the big shark,
  swordfish or bass), food that never burns (`cooking:burn`), and the box-trap, catch and jar
  effects Trickster has.
- **Corner Cutter** (tier 2): Agility rolls always succeed (`agility:roll`), a lap counts twice
  and its completion bonus pays 25% more (`agility:lap-reward`; the obstacles' own XP is not
  raised: ours), and a mark of grace spawns with 10,000 coins
  (`agility:mark`). Not here: the Sage's greaves, and the doubled pyramid tops, hallowed marks,
  Brimhaven vouchers and crystal shards (their plugins hand them out without a seam).
- **Dodgy Deals** (tier 2): every pickpocket lands (`alwaysSucceeds` on
  `thieving:pickpocket-target`) and the pouch limit is tripled, the loot is noted and multiplied
  by the NPCs of the same name alive within 5 tiles of the player (the Wiki's 11x11; coins a pouch
  each: ours; a clue, and an item that neither stacks nor notes, once, as the Wiki says),
  pickpockets and stall thefts repeat themselves while neither the player nor the NPC has moved
  (`thieving:done`; chests have no repeat here either), and a stall never empties for the owner
  (`thieving:deplete-stall`; another player's theft still empties it for everyone, as on live).

### The production relics

- **Production Prodigy** (Trailblazer Reloaded tier 1): Crafting, Smithing, Herblore, Fletching
  and Cooking boosted by 12 (`skills:level-boost`; invisible, wherever those skills check their
  own level, Superheat Item included, so requirements and success charts both see it: the Wiki
  does not say which; the Blast Furnace's own Smithing check is not boosted), the
  Wiki's activities all at once with full XP (`skills:actions-per-cycle`: smelting, smithing,
  cannonballs; fletching logs (shafts, shields and unstrung bows), stringing, bolt tips (the
  group also cuts kebbit and antler bolts and wolfbone arrowtips: batched too, ours); cleaning herbs
  and mixing potions whose secondary does not stack; cooking; leather, jewellery, battlestaves,
  pottery, gems, glassblowing, spinning), and a 25% chance of the same product again, banked with
  its XP (`skills:produced`; only when the bank has room). "All at once" is up to 28 a cycle, the
  inventory's slots: ours. Molten glass, smelted at a furnace, is Crafting and not on either
  list. Not here: jugs of wine (no wine making in this server); Guardians of the Rift's essence is
  not a Crafting loop here, so the Wiki's exclusion holds.
- **Production Master** (Raging Echoes tier 5): the same list all at once, plus arrow shafts,
  headless arrows, arrows, bolts and gem-tipped bolts, and darts (10 times the usual a cycle,
  Wiki; darts and bolts by default fletch in one click, and that click makes 10 too), and amethyst
  (10 December 2024). No boost and no extra product. Pies and pizzas exist only in The Mess here
  and are not batched.
- **Friendly Forager** (Raging Echoes tier 2): the Forager's pouch, carried or worn, finds a
  grimy herb when the player mines, chops, fishes or hunts (their success events), at most once
  every 9 ticks, one the player could clean at Herblore level + 25 and of a kind the pouch holds
  fewer than 30 of (`herblore:herbs` lists them); a minigame's reward (the Fishing Trawler, the
  rumour sack) is not gathering. The herb's cleaning XP for each find is ours (the Wiki: "a small
  amount"). Check, Fill and Withdraw (as notes) are the cache's options, on the pouch clicked; the
  pouch keeps its own herbs, where live shares them with the herb sack. In Herblore
  (`herblore:mix`), a secondary ingredient (any ingredient that is not a potion or a vial, and a
  super combat's or anti-venom+'s torstol potion (unf), Wiki, whose vial is kept with it) is
  kept 90% of the time, never crystal dust (Wiki), and a potion brewed from an unfinished one
  comes with 4 doses instead of 3 (an upgrade of a dosed potion keeps its doses). Unfinished
  potions keep their herb. These Herblore perks need only the relic, not the pouch (ours: the
  Raging Echoes page does not tie them to it). Not here: the Menaphite remedy (no recipe in this
  server).

### The economy and farming relics

- **Fire Sale** (Trailblazer Reloaded tier 3): every shop with the standard shop interface that
  takes coins sells for nothing (`shop:buy-price`; the stock still limits what can be bought, so a
  shop with one left sells one a click), what it sells comes noted when the item has a note
  (`shop:delivery`), and it buys nothing for coins (`shop:can-sell`). The Wiki's noting is a
  player's toggle; this shop interface has no button for it, so it is always on: ours. Tokkul and
  the other currencies are untouched (selling to a Tokkul shop works), as are costs outside shops
  (sawmills, servants). The Grand Exchange and the reward shops (Omnishop) are not this interface.
- **Golden God** (Raging Echoes tier 4): High and Low Level Alchemy need no runes and no Magic
  level, give 15% more coins (rounded down), keep the item 65% of the time (a kept item frees no
  slot, so a full inventory without coins refuses the cast rather than lose them), and cast again on what
  is left in the slot once each cast ends, until the stack is gone or moved (walking and attacking
  do not stop it; logging out does), with the usual XP and speed (`magic:alchemy-policy`). A cast
  another plugin has turned into something else (Mage Training Arena's coins, While Guthix Sleeps'
  explosive) keeps only the free runes and the level. 20,000 coins are offered on an altar as one
  dragon bone (`bone-altars:offering`): the Chaos Temple's and a house's altar give their own
  experience and keep the coins as they keep bones; any other altar one prays at gives the bone's
  burying experience (Wiki); the offering repeats while the coins last, at the altars' own pace,
  stopped by a walk or click (the Wiki: until logout). The Ectofuntus and the Libation bowl take no
  coins. What a coin shop sells comes noted (as Fire Sale; always on: ours). Not here: the casting's
  pause during production skilling (the Wiki's), which needs a skilling state this server does not
  keep; the Wiki's other chaos altars that take coins (Ourania, the Asgarnian and Black Knights'
  temples, Underground Pass) are plain altars here.
- **Farmer's Fortune** (Trailblazer Reloaded tier 6): a 20% chance to keep the seed or sapling
  planted (with its pot, and no Amulet of bounty charge; the message is ours), patches grown the moment they are planted and never
  diseased (`farming:plant-rules`; anima plants still grow, their last stage is their end),
  harvesting 25 times faster (25 picks an action, `farming:harvests-per-action`), and each pick
  three times the produce, noted (`farming:pick`; the herb sack takes only unnoted herbs, so these
  go to the inventory). The usual Farming XP a pick, not tripled: ours, the Wiki gives no XP rule.
  Wood trees, which are chopped and not picked, give the usual logs.
- **Overgrown** (Raging Echoes tier 7): the Leprechaun's vault opens the seed vault anywhere
  (`farming:open-seed-vault`); crops never die (a diseased crop waits for a cure instead,
  `farming:plant-rules` `undying`); planting keeps the seed 75% of the time, with live's message
  ("Botanical allows you to keep your ...", Wiki trivia). These need only the relic (Wiki). Both
  rules are kept on what is planted from then on. Not here: the automatic harvest and replanting
  of a grown patch from the vault's seeds (with its ultracompost memory, contract, pet and Hespori
  rules), which needs a Farming replant path of its own.
- **Pocket Kingdom** (Raging Echoes tier 7): the Pocket kingdom's Check (the approval and coffers;
  the wording is ours), Collect (Advisor Ghrim's collection, to the bank) and Manage-kingdom (the
  kingdom's interface) work anywhere, without Throne of Miscellania and with Royal Trouble's
  enhancements (`miscellania:rules`); the workers cost half the coins for the same work, gather
  twice as much (every resource doubled; the easy clue stays as rolled: ours), and approval is held
  at its maximum (127, 100%). Managing it anywhere counts as a visit (`visiting`), so the subjects'
  30 days without a visit run from the last login or use of the item. Not here:
  the hourly cycle and its 37,500 coins an hour once the coffers hold 375,000; the kingdom keeps
  its daily cycle.

### The clue and Slayer relics

- **Treasure Seeker** (Trailblazer Reloaded tier 5, and the catalog's tier 3 preview of it) and
  **Treasure Arbiter** (Raging Echoes tier 5) share their clue perks: each clue scroll an NPC
  drops comes at least 1 time in 15 (the Wiki's "a 1/15 chance to drop one", read per clue:
  ours), and an impling jar's too; clue nests (trees, birdhouses), geodes and bottles (drift nets,
  aerial fishing) come 10 times as often (Fishing has no clue bottles here); every trail has its
  tier's fewest steps (1 to 6) and every casket its tier's most rolls (3 to 7; the data's ranges
  are the Wiki's).
- **Treasure Seeker** also brings another reward casket from an opened one (not the Mimic's), at
  times a tier higher (never above master), to the inventory or else the bank. The Wiki gives
  no numbers ("more common at lower tiers"): ours, 1 in 5 for a beginner casket down to 1 in 20
  for a master one, a quarter of them upgraded. The messages are ours; with neither inventory nor
  bank room the casket is not given, and a message says so.
- **Treasure Arbiter** also lifts the item requirements of emote steps (what to wear; the elite
  and master steps' Uri outfits are part of the step, not lifted), Falo the Bard's songs (any item
  shown is right, but something must still be shown to him: ours, his steps answer only to an item
  used on him) and Charlie the Tramp's errands (he is thanked without it).
- **Bloodthirsty** (Trailblazer Reloaded tier 5): the enchanted gem, slayer ring and slayer
  helmet's check offers a new task from the last master or a cancel at the usual price
  (`slayer:remote-task`; not Mortimer's tasks, a choice with modifiers made in person: ours); the bracelet of slaughter works 35% of the time and uses no charge;
  superiors come 1 time in 25; each gives Slayer points (ours: 5 plus a fifth of its Slayer
  requirement, the Wiki says only "based on" it) and six more rolls on its normal monster's table;
  a quarter spawn bloodthirsty (a message of ours says so): nine rolls, a clue scroll for sure when
  its table has one (the rarest the player can take now, by its chance), three times the unique chance and a roll on the bloodthirsty
  table (Wiki, Bloodthirsty Nechryarch). Not here: the expeditious bracelet (not in this server);
  the variants' stronger stats, names and icon (no NPCs of their own in this cache).
- **Slayer Master** (Raging Echoes tier 5): every Slayer monster counts as on task
  (`slayer:always-on-task`; a monster some task counts, not one only a boss task gives): its Slayer
  XP, its superior (with Bigger and Badder), the slayer helmet's bonus and every "on task" check,
  without counting down the real task. So combat achievements done "without a Slayer task" cannot
  be done on those monsters with the relic (ours: the Wiki does not say); the reward
  shop's unlocks, extensions, cancels and blocks and its rune pouch, herb sack and looting bag cost
  no points (`slayer:reward-cost`; unlocks still take a click: ours); and the 100th kill of each
  Slayer monster (by name) gives bonus Slayer XP, "You gain [X] bonus Slayer XP." (Wiki), from
  1,000 at Slayer level 1 to 15,000 at 99 in a straight line (ours), with the usual multipliers.
  Not here: Brimstone and Larran's keys anywhere (they follow the league's areas; off-task kills
  drop no keys).

### The item and teleport relics

Their teleports share the standard animation, their item's Wilderness limit, and the league's
areas: a destination in an area the character has not unlocked is refused (`league:area-at`
and `league:areas`, answered by the league's area unlocks; with nobody answering, everywhere is
open). Each item remembers its last destination. The menus' grouping and wording are ours.

- **Fairy's Flight** (Trailblazer Reloaded tier 2, Raging Echoes tier 3): the fairy mushroom's
  Teleport (or, worn, Fairy-Ring, Spirit-tree, Tool-leprechauns) goes to any fairy ring by its
  code, any spirit tree the character could travel to by tree, and any tool leprechaun (named
  after their nearest fairy ring: ours); from any Wilderness level except to a spirit tree (level
  20, Wiki). Not here: the Tree Gnome Village autocompletion (the quest's own).
- **Globetrotter** (Trailblazer Reloaded tier 2): the pendant's Nexus goes to the spellbooks'
  teleports (standard, ancient, lunar, Arceuus, and the house when the character owns one: not
  a Last-destination, which could not enter it), its
  Jewellery to the ornate jewellery box's 27 destinations, up to level 20 Wilderness, 30 for a
  dragonstone piece's destination and its last destination (Wiki, 6 December 2023). No runes.
- **Banker's Note** (Trailblazer Reloaded tier 3, Raging Echoes tier 6): an item used on the note
  is noted, a note unnoted (as many as the inventory and the stack's limit hold); Activate repeats
  the last item;
  Note-Quantity and Un-note-Quantity set how many each use converts (all until set: ours); Toggle
  switches Activate between noting and unnoting (ours: the Wiki does not say). Not here: Guardians
  of the Rift's essence rule.
- **Clue Compass** (Raging Echoes tier 3): the compass goes to any STASH unit, built or not, and
  to Falo the Bard; Current-step to where the clue read last leads (not a step that asks for a
  kill, nor a hot-cold step's spot: ours), from any Wilderness level, onto the nearest open tile
  when the spot is solid; used on Falo it is the item he asks for. The Wiki's three Varlamore
  units left out near the Twilight Temple count here. Not here: beginner clues' Current-step
  (their trails are kept apart).
- **Total Recall** (Raging Echoes tier 6): the Crystal of Echoes' Save-memory keeps the place,
  Hitpoints (up to 127, as live), Prayer and special attack energy; Teleport-back returns there
  from any Wilderness level and sets the three back; Check-memories says what is kept (ours). Not
  in an instance, nor underwater at Fossil Island. No cooldown; the memory outlasts death.
- **Grimoire** (Raging Echoes tier 7): spells' area, quest and diary requirements are lifted
  (`magic:spell-unlocked`; here the Mage Arena's god spells without their 100 casts); the Prayer
  level still counts, and no prayer here is gated by a quest. The Arcane grimoire's spellbook
  swap is the item's own plugin (Leagues polish).
- **Reloaded** (Raging Echoes tier 4): one more relic of tiers 1-3, a different one from that
  tier's own pick, chosen with the same click on it (`league:relics-extra`; any item it hands out
  is given). The relic interface shows only each tier's own pick: ours.

### Equilibrium (both leagues)

Trailblazer Reloaded's tier 6 and Raging Echoes' tier 4: every gain of experience
(`skills:experience-gained`, emitted after the gain) adds a bonus in the same skill of 10% of
the total level, 20% when the skill is the one with the least experience, added with the
multipliers off (neither the world's nor the league's rate) and floored to tenths like any
gain; the bonus's own gain brings no bonus. Several skills tied for least experience (a fresh
character) resolve to the first in skill order: ours. Live tracks and shows the relic's XP; here
it is a plain XP drop.

## Developer commands

- `::league [player]` - the character's league and points.
- `::leaguetask <id> <points> [name]` - award yourself a task through the real award path (the
  task catalog, LeagueTasks, does not exist yet).
- `::relic [tier 1-8] [slot 1-3]` - list your relics, or choose one through the usual checks.
- `::leaguerecords <trophies|statistics|rankings|firsts>` - open a main-game record screen.
- `::leagueshop` - open the Leagues Reward Shop.
- `::renown <amount> [player]` - grant Shattered Relics' Sage's Renown.

## Not yet

League tasks, area unlocks, combat masteries, the other tier passives (drop rates, run energy,
clue boxes, minigame points, the ironman restriction), and Shattered Relics' rules (see its
section). Each is its own item on the progress tracker. Of the relics, Bank Heist follows in its
own PR (it needs a list of the world's banks); Overgrown's automatic harvest and replanting and
Pocket Kingdom's hourly cycle are their own items. The records have no POH league hall to stand in: its trophy
case, pedestals and scroll need the house's league hall, which this server doesn't build yet, so
the scroll's options answer only where the loc exists.

The cache's "League Skill Cape Shop" (652) is not a shop: its only script (3201) creates 22 tiny
cape items and prints "Loading: <cape>" for each, a model preloader. Nothing sells through it, and
the Wiki names no such shop.
