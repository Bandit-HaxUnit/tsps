# Leagues

The Leagues game mode (https://oldschool.runescape.wiki/w/Leagues) on this server: a league
character per account, League Points, relic tiers and relics, area unlocks and combat masteries.
Plugins: `plugins/modes/LeagueMode.plugin.js` (the profile, its league, XP rate, the tiers' passives, journal tab,
the league content the client reads), `LeaguePoints.plugin.js` (points), `LeagueRelics.plugin.js`
(tiers and relics), `LeagueAreaUnlocks.plugin.js` (areas) and `LeagueCombatMasteries.plugin.js`
(Raging Echoes' combat masteries); data in `plugins/modes/data/leagues.json`, `league-relics.json`,
`league-areas.json`, `league-boosted-drops.json` and `league-combat-masteries.json`.

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
| `league:points-changed` | `{ player, points, previous, tasks, previousTasks }` | LeagueMode (journal), LeagueRelics, LeagueAreaUnlocks listen |
| `league:has-relic` | `{ player, relic } -> { active }` | LeagueRelics |
| `league:masteries` | `{ player } -> { league, masteries: { melee, ranged, magic }, passiveTier, points: { earned, spent, available }, challenges }` | LeagueCombatMasteries |
| `league:mastery-point` | `{ player, challenge, earned }` after a Combat Mastery point | - |
| `league:mastery-unlocked` | `{ player, style, tier, key, passiveUnlocked }` after an unlock | - |
| `stats:heal` | `{ player, previous, amount, hitpoints }` before any heal (core); `amount` may change | LeagueCombatMasteries |
| `skills:restore` | `{ player, skill, amount, max }` before a stat restore or boost (core); `amount` may change | LeagueCombatMasteries |
| `combat:hit-rolled` | `{ attacker, target, combatType, damage, minimum, maximum }` after a hit's damage roll, before defences (core); `damage` may change | LeagueCombatMasteries |
| `league:relics` | `{ player } -> { league, chosen }` (tier index -> slot) | LeagueRelics |
| `league:send-content` | `{ player }`: send every plugin's struct/enum overrides again | LeagueMode |
| `league:content-rows` | `{ player, league, structs: [], enums: [] }`: plugins push their rows | LeagueRelics, LeagueAreaUnlocks answer |
| `league:areas` | `{ player } -> { league, unlocked: [area ids], next: { slot, tasks } \| null, available }` | LeagueAreaUnlocks |
| `league:area-at` | `{ x, y, player \| league } -> { area: id \| null, name }` | LeagueAreaUnlocks |
| `league:area-unlocked` | `{ player, league, area, slot }` the moment an unlock is saved | LeagueAreaUnlocks emits |
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
  hook's `multiplier`; the other tier passives are under "Tier passives" below.

## Relics

`LeagueRelics.plugin.js`, data `plugins/modes/data/league-relics.json`: eight tiers a league,
each with a point cost, a passive and three relics (Wiki); a tier's pick is permanent. A
character's picks live in `league:relics` (tier index -> slot 1-3).

- **The catalog.** The cache's relic interface (655) reads the league struct's tier enum (param
  870), tier structs (877 cost, 878 relic enum, 2045 passive struct) and relic structs (879 name,
  880 description, 885 tier, 1855 has-item), but the cache only carries the current league's.
  The server sends a league's own as `structOverrides` / `enumOverrides` datasets
  (`sendContentData`; `GamemodeContentStore` and the cs2 `struct_param` / `enum` ops read them
  before the cache) at login and before the interface opens. Ids start at 200000 + league type
  x 1000; icons are borrowed from the cache's own relic in the same tier and slot.
- **The flow, as captured.** The side panel's View Relics (656:44) opens 655 as the main modal
  with `if_setevents` on its slots (655:22, 0-23) and menu (655:6, 10-20). A slot click sets
  `league_relic_last_viewed` (10048) to tier x 3 + slot and runs the client's redraw scripts 3193
  (the panel's components, the state 2 both captured clicks sent for an affordable, unchosen
  tier (other states were not captured), the relic struct, the tier's passive struct) and 3181. Confirm (655:50) unlocks the viewed relic: its tier's selection varbit
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

## Developer commands

- `::league [player]` - the character's league and points.
- `::leaguetask <id> <points> [name]` - award yourself a task through the real award path (the
  task catalog, LeagueTasks, does not exist yet).
- `::relic [tier 1-8] [slot 1-3]` - list your relics, or choose one through the usual checks.
- `::mastery` - your combat masteries, points and challenges; `::mastery <melee|ranged|magic>
  <tier 1-6>` unlocks one through the usual checks; `::mastery point <1-10>` awards a challenge's
  point through the real path (the only way to the Echo boss challenges here).
- `::areas [id or name]` - list your areas, the next unlock and the area you stand in, or unlock
  one through the usual checks (`::area` is AdminCommands' Area-class debug).

## Not yet

League tasks, the Echo bosses (and so three of the mastery points), the tier passives left out
above (clue-step progress and farming ticks), the boosted sources their own plugins have yet to
ask about, the league tutorial (see above), trophies and rewards. Each is its own item on the
progress tracker.
