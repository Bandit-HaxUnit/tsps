# NPC spawns

`server/data/definitions/npc-spawns.json` holds every NPC spawned with the world, one per line: `id` (or `key`, an `NpcIdentifiers` constant), `name`, `x`, `y`, `level` (the plane), and optionally `wanderRadius` (default 5) and `direction`. `NpcSpawns.plugin.js` registers it; plugins can veto a spawn (`canSpawnNpc`).

The client cache has no spawns: OSRS keeps them on the server. The file came from a one-time import, then captures and plugins added to it by hand. Areas released since then had none, until this script.

## Adding an area from the Wiki

`yarn sync:npc-spawns` (`server/scripts/sync-npc-spawns.ts`) adds the spawns an area is missing, from the OSRS Wiki:

```sh
cd server
yarn sync:npc-spawns --box 2520,2170,2660,2310 --box 2560,8560,2640,8660 --tag Wyrmscraig            # dry run
yarn sync:npc-spawns --box 2520,2170,2660,2310 --box 2560,8560,2640,8660 --tag Wyrmscraig --write    # add them
```

| Option | Meaning |
| --- | --- |
| `--box minX,minY,maxX,maxY[,plane]` | The area, inclusive; repeatable. Every plane unless one is given. |
| `--tag <word>` | Prefer Wiki versions whose label has it ("Wyrmling#Idle (Wyrmscraig)"). |
| `--id <Name>=<id>` | Use this NPC id for a page's spawns. |
| `--skip <Name>` | Leave a page's spawns out (Leagues, events, quest states). |
| `--radius <tiles>` | How far an existing spawn may be from the Wiki's and still match (default 4). |
| `--report <file>` | Write every map square's gaps as JSON instead: area name, spawn counts, missing NPCs with their labels. Nothing is written to the spawn file; without `--box`, the whole map. |
| `--wiki <file> [--save]` | Read a saved copy of the Wiki data, or (with `--save`) fetch and write one. A full fetch is about 90 requests. |

**Where the Wiki keeps spawns:**
- **Monsters:** `{{LocLine}}` coordinates, one per spawn (bucket `locline`), with ids per page version from bucket `infobox_monster`.
- **Single NPCs:** the infobox's `{{Map}}` in the page's wikitext, with ids from bucket `infobox_npc`. A polygon, rectangle or line outlines an area: it becomes one spawn at its centre.
- **Not counted:** pages without an NPC infobox (LocLine also places scenery and items), and historical or event pages without real ids.

**Choosing the id:** a LocLine row has no version, so the script picks: a version whose label has a `--tag`, else the id existing spawns of that NPC already use most, else the first. The dry run prints each choice.

**Add-only.** Per NPC name and plane, a Wiki spawn with an existing one of that name within `--radius` is already there, and leftover existing spawns **in the same 64×64 map square** still count, so only the difference in number is added there (the Wiki spawns furthest from any existing one). A spawn elsewhere on the map doesn't stand in for one missing here, so a whole-map run counts correctly. Nothing is moved or removed, so a second run adds nothing. In an area that already has its spawns, only real gaps show up: Lumbridge has 85 Wiki spawns and 84 existing, and the script would add 7. Added spawns carry `"source": "wiki"`, so they can be found and replaced by captured positions later.

**Wander radius:**
1. What existing spawns of that NPC mostly use (by id, else by name): 0 for fishing spots and bankers, as the old data set by hand.
2. Otherwise 0 for an NPC without a walk animation in the cache.
3. Otherwise the loader's default (5).

The Wiki map's `r` only sizes its marker, so it isn't used: Mortimer's map has `r=4`, and he stands still.

**Wiki map layers.** The Wiki draws many dungeons on their own map layers (`mapID`), whose coordinates or plane can differ from the game's: the God Wars Dungeon is on plane 0 there and 2 in the game, and the Stronghold of Security's floors are each shifted (the Sepulchre of Death by +352, +288). Before comparing, each Wiki map square on a layer votes, through its spawns, for the shift that puts them on existing spawns of the same NPC:
- **A square is aligned** when at least 2 spawns, and half of those with a same-name spawn anywhere, agree on one shift.
- **A layer whose aligned squares all agree** takes that shift everywhere, its empty squares too.
- **A layer holding places shifted differently** uses each aligned square's own shift. Its other squares stay unaligned, are labelled "Wiki map layer not aligned", and are left out.

The surface (`mapID` 0, or none) is in game coordinates already.

**Decisions** live in `server/data/definitions/npc-spawn-sync.json`, so every run respects them. Each has a `label`, `skip` (leave the spawns out) and `why`:
- `categories`: cache NPC categories (opcode 18). Category 2353 holds the Sailing sea creatures (sharks, rays, krakens, seabirds): labelled, not skipped.
- `names`: cache NPC names. The Stronghold of Security doors are skipped, since tsps opens them as scenery.
- `pagePatterns`: Wiki page titles. Leagues, Deadman and holiday-event pages are skipped.
- `boxes`: areas such as instance templates a plugin spawns itself (none yet).
- `unalignedLayers`: how unaligned Wiki map layers are treated (skipped).

**Checks it prints:**
- NPCs on the Wiki with ids newer than this cache.
- Spawned NPCs with a combat level but no drop table or stats. Drops come from the Wiki drop dumper in osrsreboxed-db (`plugins/npcs/NpcDrops.plugin.js`); rerun it for an area newer than the last dump.

## Wyrmscraig

Added with the command above: 84 spawns on the island and in the Wyrmscraig Cavern.
- **The villagers:** Cormac, Ffion, Muriel, the Auchrie residents (Rian, Catriona, Baldwin, Angus), Oisin, Declan, Mr Supplies Jnr, Geoff, and Mortimer (the post-quest version with Assignment and Trade, 16175). Keenan has no NPC infobox on the Wiki, so he isn't placed.
- **Monsters:** wyrmlings (16297, the Wyrmscraig idle version), wyrms, lava strykewyrms, mountain trolls, bats.
- **Animals:** goats, chickens, bunnies, a yak, seagulls, and great white sharks in the sea around it (a Sailing encounter; they can't be reached without a boat).
- **Other:** golems and fishing spots.

The existing Mad Angel matched and wasn't doubled. All of them that fight have drop tables and stats.

- **Standing still:** the fishing spots (as existing ones), Mortimer and the broken golem (no walk animation). Mortimer 16175, the post-quest version, has no animations at all in the cache: no `readyanim` or `walkanim` opcode, only conditional menu options (opcode 252). The other id, 16294, has `mortimer_idle`.
- **Mountain trolls:** the Wiki lists 936–942 and 16330–16332 under one version, identical in the cache; the script used 936, which existing spawns use.
- **Not covered by spawns:** dialogue, the two shops, Mortimer's Slayer assignments, goat hunting and golem crafting.

## Varlamore (surface)

```sh
yarn sync:npc-spawns --box 1024,2752,1919,3455 --write
```

2,391 spawns across 47 areas, which had 186 before. The largest are Civitas illa Fortis (374), the Tlati Rainforest (254), the Avium Savannah (221), Aldarin (198), Auburnvale (93) and Laguna Aurorae (89).
- **Kept:** 270 Sailing sea creatures along the coast, and 94 spawns of NPCs without drops yet (Strangled, giant mosquitoes, carnivorous chinchompas, Sunlight antelopes, a few guards); their tables come with the next monster and drop dump.
- **Left out:** the Leagues Navigator; the Gemstone Crab and Sol Heredit, which plugins spawn themselves.
- **Not covered:** Varlamore's underground (Cam Torum, the Ruins of Tapoyauik, the Stalker Den), for a dungeon batch.

## Sailing islands and seas

1. **Every empty surface map square outside Varlamore** (190 squares, from the gap report, `--box` per square): 1,932 spawns. That's The Great Conch, Isle of Serpents, Cape Conch, Dognose Island, The Summer Shore, The Onyx Crest, Anglers' Retreat, The Crown Jewel, Charred Island, Sunbleak Island and the rest, with the sea around them.
2. **Sea creatures off coasts tsps already covers:** `--box 0,0,16383,16383,0 --only "Sailing sea creature"`, 280 spawns. Narwhals, bull sharks, albatrosses, terns, vampyre krakens and orcas off Morytania, the Fremennik isles, Kourend and Karamja. Nothing else is added there.

- **Left out by the decisions:** Tempoross and its props (ammunition crates, spirit pools), the Soul Wars Avatar of Creation, the Wiki's Void Knight and squire on Pest Control's island (the plugin spawns its own), and The Node, the Group Ironman starting island.
- **Left for later:** Lucien's camp (its skeletons and undead mages look quest-related) and the "Meaty Aura Logist" rows.

## Varlamore's underground

```sh
yarn sync:npc-spawns --box 1216,9344,1727,9855 --tag Neypotzli --write
```

454 spawns: Cam Torum's city (guards, citizens, children, bankers, the bar and smithy, on plane 1), the Stalker Den's custodian stalkers, the Ruins of Tapoyauik (icefiends, ice giants, blue dragons, Frost Nagua, chilled jellies), the Tonali Cavern (Earthen Nagua, grimy lizards, giant rock crabs), and Neypotzli's gaps. `--tag Neypotzli` picks Neypotzli's own wyrmlings (13031) over Wyrmscraig's.

- **Left out:** the Perilous Moons bosses (Blood, Blue and Eclipse Moon) and Amoxliatl, since no plugin gives them their fights yet. Araxxor is in the same decision ahead of the dungeon batch.
- **Not yet:** the Frost Nagua have no stats until the monster database update.

## Open monster dungeons

1,163 spawns in 80 map squares of open monster dungeons, from an allowlist of areas in the gap report rather than everything below ground: the Black Knight Catacombs, Underground Pass, Morytania Spider Cave (araxytes), Charred Dungeon, the Sophanem and Scabaras dungeons, Tarn's Lair, Zemouregal's Base and Fort, the God Wars Dungeon's spirituals and blood reavers, the Gryphons' cave, Ynysdail Cavern, Deepfin Mine, the Buccaneers' Laboratory, Grimstone Dungeon (frost dragons), Waterbirth, Pandemonium Cave, Brimhaven Dungeon, the Ancient Guthixian Temple (tormented demons), the Stronghold of Security's minotaurs, the Vampyrium and its realm, and smaller slayer caves.

- **New decisions, left out:**
  - `namePatterns` `^<col=`: coloured names are always props of a minigame, raid or quest (Theatre of Blood pillars, Nightmare totems, Inferno glyphs);
  - the *Defender of Varrock* zombies invading Varrock Palace (quest only).
- **Removed by the new rule:** `<col=00ffff>Forebearer Janus</col>`, which the Varlamore batch had added in Civitas before the rule existed.
- **Left out of the allowlist, for a later look:** raid and boss areas their plugins spawn (Tombs of Amascut, Theatre of Blood, the Nightmare, the Inferno, the Abyssal Nexus); bosses without a plugin yet (Skotizo, Yama, Scurrius, Phantom Muspah, the Headless Beast, the Jormungand); minigames (Barbarian Assault, Nightmare Zone, the Motherlode Mine); and single quest NPCs.

