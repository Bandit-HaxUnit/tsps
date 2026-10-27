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
  never fires another, and is an ordinary shot: it is rolled as if no special were armed, its
  accuracy and damage included, and a special armed after the original shot stays armed with its
  energy, `PendingHitConfig.ordinary`), 90% of each volley's
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
  healed by the damage their hits did as they landed in it (`HitDamage.onApplied`: an impact
  cancelled before it lands counts nothing), capped at their max (ours: the Wiki shows a bar over the
  head and gives no formula; no bar here). Once every three minutes, reset by a real death
  (`league:last-stand-ready-at`). Not done: the Wiki's instant-kill exceptions (they are not
  hits here either), and the skills packet carries a boost as a byte, so the client's boost
  overlay for a 255 may read oddly while the level itself shows.

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

## Not yet

League tasks, area unlocks, combat masteries, the other tier passives (drop rates, run energy,
clue boxes, minigame points, the ironman restriction), the league tutorial, trophies and
rewards. Each is its own item on the progress tracker. Of the relics, the gathering, production,
clue, slayer and item ones follow in their own PRs (the plan in the relic effects PR).
