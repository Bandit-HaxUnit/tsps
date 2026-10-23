# Map building notes

Field notes for building with the map-editing tools ([map-editing.md](map-editing.md) is the
tool reference). The tools can report a build as perfect — every object placed, every height
set — while it looks wrong in game. These notes are what earlier builds learned about the
difference, so the next one starts from what works.

**Keep this file growing.** When a build teaches you something — an object that renders badly,
one that works, a terrain trick, a tool quirk — add it to the right section below, with the ids
and how you checked it (screenshot, in-game, cache dump). Correct an entry that turns out wrong;
say what changed rather than deleting it quietly. Short rows beat paragraphs.

## Workflow that works

1. **Find a site.** `observe` lists only named objects; unnamed walls, fences and ground
   decoration are invisible to it. Count what is really there with a dry run:
   `clear_area { x1, y1, x2, y2, includeCache: true, dryRun: true }`.
2. **Check the region budget** before planning terrain: paint one tile, read `terrainBytes`,
   then `clear_terrain` it (the region drops back to the cache and its file is deleted).
3. **Build a test piece and screenshot it** before building at scale: a 4×4 box of each wall
   candidate, a few floor patches. `vision_screenshot` is the only check of the look; `observe`
   and `describe_tile` only confirm the data.
4. **Build from data you generated**, not hand-typed tiles: compute the placements in a script
   and send them in one `place_objects` call; paint terrain in row runs.
5. **Screenshot the result from several sides**, then fix and repeat.
6. Clean up test pieces with the default `clear_area` (spawn-file placements only) and
   `clear_terrain`.
7. **Add what you learned to this file** before you report the build done: new ids that render
   well or badly, tool quirks, a site's budget. Skipping this is how the next agent repeats
   your mistakes.

## Screenshots (`vision_screenshot`)

| Quirk | What to do |
| --- | --- |
| It logs the player in through a headless client with password `vision1234` (or `VISION_BOT_PASSWORD`) | Use a dedicated camera account created with that password |
| The player must be logged out first; `logout` is refused for 16 ticks after combat | Teleport, then `logout` on the same tick, before anything aggressive engages |
| After a capture the session lingers for a while | Poll `list_players` and retry `logout` before the next capture |
| Zoom is fixed and close: about 10 tiles of view | Stand within ~10 tiles of what you want to see; take several shots |
| Yaw: 0 faces north, 512 east, 1024 south, 1536 west. Pitch 512 is straight down | Pitch 250–330 shows walls and depth; 450+ for layout |
| Desert heat and aggressive NPCs (jackals) keep a camera in combat | Pick camera tiles away from them |

## Templates

| Finding | Detail |
| --- | --- |
| Most mainland houses are two storeys | Locs on planes 0-1 (rooms), roofs on planes 2-3; capture all four planes |
| A building can lean on another structure | Varrock house at 3229,3381 uses the city wall as its south wall: a tight capture left a black gap, a margin pulled in a stretch of crenellated city wall |
| `find_buildings` finds by roof | Tents and stalls with roof pieces count too: 3200,3421 is Varrock's striped tent, not a house |
| Furniture is mostly interactive | A default paste is an empty shell; `interactive: "keep"` brings chairs, beds and ladders; untested whether copied ladders and doors work, since handlers can be tied to the original tiles |
| Catalog (`plugins/agent/data/templates/`) | `varrock-house-a` (8×7), `varrock-house-west` (11×9 with margin), `varrock-tent` (7×7); all checked by screenshot, also rotated |

## Walls

- **Use real wall pieces, not scenery.** A wall loc placed as type 10 is a freestanding slab
  turned by `face`; around a curve it becomes a ring of loose panels with gaps. Place walls on
  tile edges: shape 0 (straight; rotation 0 west, 1 north, 2 east, 3 south) and shape 2 for two
  edges of one tile (L corner; 0 west+north, 1 north+east, 2 east+south, 3 south+west). A tile's
  wall slot holds one wall, so two edges need the L, not two straights.
- **Edge-walling a region**: for every tile inside the shape, put a wall on each edge facing an
  outside tile (one edge → shape 0, two → shape 2). That closes ellipses and boxes with no gaps
  and leaves openings wherever you skip an edge.
- **Castle walls in the cache are unnamed**, so `search_objects` and `yarn dump:loc <name>` will
  not find them. Read them off a real building: run a `clear_area` dry run per tile over it and
  collect the type 0/2/3/9 ids.

| Loc | Shapes seen on that building | Look (checked by screenshot) |
| --- | --- | --- |
| 24175 (Falador castle) | 0, 1, 3, 9 | White stone wall, joins cleanly; the Colosseum facade |
| 24242, 24243, 24244 (Falador) | 0 | Same plain white wall as 24175 |
| 44884 (Emir's Arena) | 0 | **Low** sandstone wall; seat risers, podiums, low enclosures |
| 3152 (Emir's Arena) | 0, 2 | Tall sandstone wall |
| 3125 (Emir's Arena) | 0, 1, 3, 9 | Wooden fence, not stone |
| 1911 (Lumbridge castle) | 0, 1, 2, 3, 9 | Dark grey stone |
| 23824 (Varrock palace) | 0, 1 | Grey stone, blocky |
| 16519 `Castle wall` | 10 only (placed twice in the map: an agility obstacle) | Freestanding slab; passes in a short straight run, breaks up on curves. Not a wall piece |
| 2832 `Battlement` | 10 only | Dark rounded block |

## Other objects

| Loc | Verdict |
| --- | --- |
| 724 `Standing torch` | Good: a lit torch on a pole |
| 562 `Statue of a warrior`, 563 `Statue of a king` | Good: grey statue on a plinth |
| 860 `Flagpole` | Good: tall pole with a blue flag |
| 29115 `Marble bench` | Placed fine; not yet checked close up |
| 2106 `Archway` | Renders as a dark flat square; avoid |
| 11017 `Brazier` | Dark spiky blob; use 724 instead |
| `Pillar` (6283, 3×3), `Column` (5228) | Huge dark monoliths; avoid at scale |
| `Marble wall` (5907) | Player-owned-house object; brown wood outside |
| `Tower` (1939) | Brown ruined wooden cone, not a stone tower |
| `Fountain` (153) | Dark spiky shape |
| `White Tree patch` (9210) | A black spiky bush, not a tree |

## Ground and height

| Finding | Detail |
| --- | --- |
| Overlay 227 (Emir's Arena floor) | Bright sand; good for arenas |
| Overlays 171 (Varrock square), 137 (Falador square), 26 (Al Kharid palace), 3 (Lumbridge courtyard) | All render as dark grey or green-grey flat paint in the open; they read as paving only next to their own buildings |
| A painted area with no texture | Reads as a flat plateau, not a floor; often leaving the ground's own underlay looks better |
| Height is smoothed across tile corners | Steps of 8+ per tier blur into one slope with a cliff edge (a "mesa"). Steps of about 4, with a low wall (44884) on each step edge, read as tiers |
| Larger height value | Higher ground |
| Tiles with no stored height | `describe_tile` reports `height: null`; the client generates them. `set_height` replaces them |

## Sites and budgets

| Place | Notes |
| --- | --- |
| Lumbridge (region 12850) | About 60 KB of terrain from the cache alone; roughly 5 KB left for edits |
| Desert east of Pollnivneach (region 13614, around 3412, 2976) | 42.8 KB from the cache; almost no objects; flat enough. Desert heat applies and jackals are aggressive. The Colosseum stands here |
| Most of the mainland (Falador fields, Varrock east, Draynor, Seers', Ardougne, wilderness) | 90–220 objects per 40×34 site; expect to clear or build around scenery |

## NPCs for set dressing

| Ids | Notes |
| --- | --- |
| 12834–12839 `Gladiator` | Combat 0, not aggressive; 12837+ are size 2 |
| 11533–11535 `Citizen`, 1223 `Spectator` | Combat 0; good crowds with `wanderRadius: 0` |
| 2481 `Minotaur` | Combat 12, not aggressive |
