# Skill client feedback audit

Audited the 20 skills carrying “Connect client feedback” on `rsps.app/progress`
against main `3c4ca14c`. Feedback is connected for the methods currently implemented.
This does not implement the separate missing-method tasks in the tracker.

## Cache and sources

The loaded target is **OSRS revision 237**, `osrs-237_2026-03-25`.
LostCity's older game revision is not an OSRS sound-ID authority.

- [RuneLite SoundEffectID](https://github.com/runelite/runelite/blob/master/runelite-api/src/main/java/net/runelite/api/SoundEffectID.java): cooking 2577, mining 3220, burying 2738, woodcutting 2734/2735, anvil 3790/3791.
- [RuneLite InterfaceID](https://github.com/runelite/runelite/blob/master/runelite-api/src/main/java/net/runelite/api/gameval/InterfaceID.java): level-up group 233, text children 1/2, Continue 3, per-skill model layers.
- [RuneLite AnimationID](https://github.com/runelite/runelite/blob/master/runelite-api/src/main/java/net/runelite/api/AnimationID.java): tool, gem-cutting and bow-stringing sequences.
- [RuneStar synth names](https://github.com/RuneStar/cs2/blob/master/src/main/resources/org/runestar/cs2/synth-names.tsv): chisel 2586, vial_mix 2611, bind_runes 2710, furnace 2725, shear_sheep 761. Retrieved directly from the primary repository; low IDs match the local reference table.
- [OpenRune runecrafting](https://github.com/OpenRune/OpenRune-Server/blob/main/content/skills/runecrafting/src/main/kotlin/org/rsmod/content/skills/runecrafting/action/RunecraftAction.kt): sound 2710 and runecrafting spot animation at height 100.
- [OpenRune burial](https://github.com/OpenRune/OpenRune-Server/blob/main/content/skills/prayer/src/main/kotlin/org/rsmod/content/skills/prayer/PrayerBuryEvents.kt): resolve after two ticks and consume the bone with its XP award.
- [Rooftop Agility Courses, OSRS Wiki copy](https://osrsindex.com/wiki/rooftop-agility-courses?site=osrs_wiki): successful rooftop obstacles restore 1–2% energy, rather than restoring every course on lap completion.

`dump-seq.ts` now reports embedded frame sounds. Revision 237 has mining sound
3220 in pickaxe frames; fishing casts/net/harpoon audio in 618/619/621/622;
fletching audio in 1248 and 6671–6689; anvil hits 3790/3791 in 898;
and tinder strikes 2597 in 733. The client renders these through
`OsrsClient.handleSeqFrameSounds` and the player renderer. Explicit sends for
those sequences duplicate the client audio and have been removed.

Gem sequences 885/2717/7185 are named dragonstone/onyx/zenyte cutting in the local
Offline_Scape revision-240 cache-name reference. Their existence is verified in
our revision-237 cache; the names for these three were not available in RuneLite's
AnimationID or the primary RuneStar table. No reference implementation was copied.

## Coverage of the flagged skills

All skills use the native level-up display with their own model. Skill deltas carry
XP/current/base levels, total level and combat level. The new current level is
published before level-up hooks and is sent once on the resolving tick. Continue
closes only the level-up chatbox. Level-up clears the interrupted animation.

| Skill | Feedback and interruption audit |
| --- | --- |
| Attack | Cancelling a target clears its animation and future attack cycle; already launched hits remain valid. Existing weapon profiles and hit masks remain authoritative. |
| Strength | Shared cancellation and level-up fix; special animation/graphic dispatch already exists. |
| Defence | Native stat refresh and existing prayer-unlock varbits at Defence 60/70 are verified. |
| Hitpoints | Existing `setHitpoints` refreshes HP via native skill deltas; pools only change HP when healing is needed. Shared level-up display fixed. |
| Ranged | Existing ammunition mutation immediately refreshes equipment, including the last arrow; projectile origin and XP split checks pass. |
| Prayer | Bury animation/sound begin the action; bone consumption and XP resolve together after two game ticks. Movement/logout/cancellation preserve an unconsumed bone. Existing altar/orb feedback remains connected. |
| Magic | Autocast indicators reflect the equipped staff on weapon assignment, including bank equipment deposits; the remembered default remains available. Existing successful impact and splash graphics are distinct. |
| Cooking | Fire 896/range 897, one sound 2577 per attempt. Removed duplicate success audio and unrelated legacy burn sound. Existing raw/output/XP updates and movement checks remain connected. |
| Woodcutting | Existing frame audio, stump replacement/respawn and nest messages remain connected; shared level-up reset clears the swing. |
| Fletching | Movement cancels a waiting batch; frame audio supplies cutting/stringing sounds. Animation precedes XP so a level-up cannot restart it. Failed batches reset animation. |
| Fishing | Tool sequences supply their own audio. Full inventory/exhausted bait stop on the catch tick; shared level-up reset clears the tool animation. |
| Firemaking | Lighting sequence 733 supplies tinder strikes. Exact fire instance removal/expiry already exists; shared level-up reset clears the interrupted action. |
| Crafting | Each gem uses its own cutting model and chisel sound 2586. Inventory and XP resolve with the action. |
| Smithing | Smelting sound 2725 once per resolved attempt; anvil sound comes from sequence 898. Animation precedes XP and failed batches reset it. Existing movement/quantity/interface checks remain connected. |
| Mining | Pickaxe frame audio replaces the legacy explicit sound; removed unrelated depletion sound. Existing depleted-rock replacement/respawn remains connected; shared level-up reset clears the swing. |
| Herblore | Mixing animation 363 uses vial_mix 2611. Cleaning already changes inventory and XP; no invented cleaning animation is added (OpenRune cleaning also has none). |
| Agility | Completion/cancellation releases force movement, render override and transient animation. Successful rooftop obstacles update the energy orb. |
| Thieving | Movement/disconnect cancels pending pickpocket resolution. Failure already faces and force-chats the NPC, plays stun sound/graphic and queues a hit; the NPC attack animation now comes from its definition. |
| Runecrafting | One bind_runes sound 2710 with sequence 791 and graphic 186 at height 100; inventory and XP resolve together. Existing pouch/altar paths remain connected. |
| Hunter | Latest main already has owned visible trap states, expiration/collapse, capture/collection feedback and cancellation. Existing integration checks cover those paths. |

Rooftop restoration currently uses the documented **1% minimum** per successful
obstacle. The Wiki does not identify which obstacles restore 2%; precise per-obstacle
amounts need live captures. Other courses and shortcuts receive no invented lap refill.

## Validation

From `server/`:

```sh
./node_modules/.bin/tsc -p tsconfig.json
node --test tests/agility.test.cjs tests/skill-max-level.test.cjs tests/ranged-ammunition.test.cjs tests/packet-sender.test.cjs
./node_modules/.bin/ts-node --transpile-only scripts/combat-xp-smoke.ts
./node_modules/.bin/ts-node --transpile-only scripts/projectile-origin-smoke.ts
./node_modules/.bin/ts-node --transpile-only scripts/dump-seq.ts 618,619,621,622,624,625,628,733,791,898,899,1248,6671,6678,6689
```

The 42 focused checks, server build, combat XP/projectile smoke checks and client
`tests/cache-streaming.test.ts` pass. The broader server suite has 381 passes and
8 existing failures, reproduced on unmodified main: seven door-harness failures
(`core.ObjectIdentifiers` missing) and one PvP test (`Wilderness.isPvpArea` missing).
The toll-gate player stub now supports the shared obstacle animation reset.

Live client review remains a manual check: enable SFX, exercise the listed actions,
move during a batch, trigger a level-up, click Continue, remove/deposit a staff,
and observe a trap's capture/expiry. No live-client playthrough is claimed.
