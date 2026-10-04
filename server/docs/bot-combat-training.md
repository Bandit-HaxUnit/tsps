# Bot combat training

`::bot combat_training` spawns a new melee trainer at the invoking player's position.
The existing bot activity command can also assign `combat_training` to a controlled bot.
Commands retain their existing developer permissions. No additional bots spawn at startup.

The activity uses the lowest permanent level of Attack, Strength and Defence to choose a
training tier. Between kills it selects the combat style for the lowest of those three
skills. A temporary boost does not promote a bot; drained stats cannot unlock equipment.

| Lowest melee stat | Training sites |
| --- | --- |
| 1–9 | Lumbridge chicken coop |
| 10–19 | Lumbridge goblins or cows |
| 20–39 | Edgeville Monastery monks or Barbarian Village barbarians |
| 40+ | Varrock or Falador guards |

These are configurable simulated-player preferences, not changes to monster mechanics or
an optimal XP guide. Chicken training is consistent with the OSRS Wiki's beginner melee
training guidance; subsequent starter-monster choices follow the requested progression:
https://oldschool.runescape.wiki/w/Pay-to-play_melee_training
https://oldschool.runescape.wiki/w/Free-to-play_melee_training

Each visit lasts 5–12 minutes, including travel. On expiration or a tier promotion, the
bot finishes its current fight before starting another visit. When a tier offers multiple
sites it prefers a different site from its last visit. Guards are the final implemented
tier; this activity does not yet cover advanced PvM.

## Runtime behavior

- Uses the existing segmented movement requests to travel from its spawn to a training
  site, and the normal combat engine to follow and attack NPCs. It does not teleport or
  award XP directly.
- Looks up nearby NPCs using World's existing spatial update buckets, not a full world
  scan. Matches exact NPC names inside the configured site, on the same plane and in the
  same private area. Checks normal combat permission and excludes dead/unregistered NPCs.
- Avoids taking another player's target. A shared expiring NPC claim prevents two trainers
  choosing the same idle target during one tick.
- Uses the existing simulated-bot provisioning model: creates level-appropriate scimitars,
  basic metal armour, and a stock of trout between fights. Attack and Defence unlock weapon
  and armour upgrades independently. Cache-derived equipment requirements are still checked.
  Food consumption uses the existing bot support action. This does not implement purchasing,
  loot collection, or an economy-funded equipment progression.
- Abandons targets with no movement/damage progress for 45 seconds; a site with no progress
  for two minutes fails and enters the existing activity cooldown. Death clears the current
  target/site; after the server respawns the bot it provisions and travels again without
  resetting earned skill levels.
- Replacing a brain now calls its action cleanup from top frame to bottom, so training
  cannot leave combat following or a target reservation behind.

The definitions live in `data/definitions/bot-activities.json`; `trainCombat` is a shared
brain action with per-player state. It can participate in future general-purpose activity
selection without adding another bot runner.

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
in a running world. The existing navigation's ability to cross each site's doors/gates
must be checked in-game; the training action does not add general door-opening behavior.
Start a fresh trainer with `::bot combat_training`, observe arrival/kills/XP, then assign
trainers with all three melee stats at 10, 20 and 40 to check the subsequent sites. Confirm
another player fighting a training NPC is never displaced.
