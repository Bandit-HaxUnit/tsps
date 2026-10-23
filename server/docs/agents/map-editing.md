# Map editing over MCP

The agent MCP can read the object/NPC cache, place and remove things in the live world, and
repaint or re-level terrain — all from tool calls, all persisted, all visible in the `?edit`
map editor. This is how an agent builds a structure (or a city) without a human clicking tiles.

Everything here is development-only: the tools register on the agent MCP server
(`AGENT_MCP=1`), which already only listens on `127.0.0.1`.

## The mental model

Three separate stores, and it matters which one you are touching:

| What | Where it lives | Who sees it |
| --- | --- | --- |
| Live objects/NPCs | the running world (`ObjectManager`, `World`) | players connected now |
| Persisted spawns | `data/definitions/object-spawns.json`, `npc-spawns.json` | everyone, after a server restart |
| Terrain | `data/regions/<id>.terrain.dat` or `<id>.pack` | players on scene rebuild; editor after sync |

A placement tool does the first two together: it registers the object immediately *and*
appends it to the spawn file. Terrain tools register a region replacement and write the pack.
Nothing needs a manual restart.

## Tools

### Objects

| Tool | Purpose |
| --- | --- |
| `search_objects` | Find cache locs by name fragment or id prefix |
| `describe_object` | Footprint, solid, blocks projectiles, options |
| `place_object` | Place one object (live + persisted) |
| `place_objects` | Place a batch in one call, one file write |
| `remove_object` | Remove object(s) on a tile, persisted |
| `clear_area` | Clear a rectangle on all planes: spawn-file objects (+ NPCs); `includeCache` razes cache scenery too, `dryRun` only reports |
| `restore_area` | Undo cache-object removals in a rectangle: drop the markers, put the objects back live |
| `list_placed_objects` | What the spawn file holds, filterable by `source` |

### Building at a higher level

Element-by-element placement is fine for a door and wrong for a city. These tools take a
*shape* or a *preset* and expand it internally:

| Tool | Purpose |
| --- | --- |
| `build_shape` | One material, one shape: `line`, `ring`, `box`, `tower`, `repeated`, `avenue`, `column` |
| `build_preset` | A named structure from `plugins/agent/data/edit-presets.json` |
| `plan_build` | Dry run: counts, bounds, object mix — changes nothing |
| `list_presets` | Presets, their parameters, and the material names |

Shape semantics, so the coordinates are never a guess:

- `line`, `avenue`, `repeated` — `(x, y)` is the start, `(x2, y2)` the end.
- `ring` — `(x, y)` is the centre, plus `radius`, `thickness`, `gapDegrees`, `gapAngle`
  (`gapAngle` 0 = east, 90 = north).
- `box` — `(x, y)` is the low corner plus `width`, `height`, `doorSide`, `doorWidth`.
- `tower` — `(x, y)` low corner plus `width`, `height`; filled footprint.

Presets ship with `house`, `tower`, `gatehouse`, `plaza` and `tiered_city` (the ringed hill
city: four concentric walls, each with an east gate and towers on its east and west sides). Example:

```jsonc
// one call: a 7x7 house shell with a south door
build_preset { "preset": "house", "x": 3090, "y": 3485, "params": { "width": 7, "height": 7 } }

// a whole ringed city, then check it before spending time
plan_build   { "preset": "tiered_city", "x": 3090, "y": 3485 }
build_preset { "preset": "tiered_city", "x": 3090, "y": 3485 }
```

#### Adding a preset or a material

Presets and materials are data, not code — edit `plugins/agent/data/edit-presets.json`. A
material is `{ "name": { "id": <cache id>, "about": "..." } }`; a preset is a list of parts:

```json
"gatehouse": {
  "about": "Gate flanked by battlement piers",
  "params": { "wall": "battlement", "gate": "gate" },
  "parts": [
    { "shape": "column", "material": "$wall", "dx": 0, "dy": -2 },
    { "shape": "column", "material": "$gate", "dx": 0, "dy": 0, "face": 1 }
  ]
}
```

`"$name"` reads a call parameter, `"-$name"` reads it negated. A preset with
`"repeat": { "radius": "$radii" }` runs its parts once per value of that parameter —
that is how `tiered_city` builds four rings. Keep material ids verified (`search_objects` /
`yarn dump:loc`); never hard-code ids in tool code.

### Templates: copying real buildings

The game's own buildings already get corners, door frames, roofs and floors right. Copy one
and paste it anywhere instead of designing from scratch:

| Tool | Purpose |
| --- | --- |
| `find_buildings` | Roofed buildings in an area (up to 256×256), each with a capture rectangle |
| `capture_template` | Save every loc (all planes) and the terrain in a rectangle as a template |
| `list_templates` | Templates in `plugins/agent/data/templates/` |
| `paste_template` | Place one at a tile, rotated 0/90/180/270; `dryRun` reports first |

```jsonc
find_buildings   { "x1": 3180, "y1": 3380, "x2": 3290, "y2": 3480 }   // Varrock
capture_template { "name": "varrock-house-west", "x1": 3190, "y1": 3400, "x2": 3200, "y2": 3408 }
paste_template   { "name": "varrock-house-west", "x": 3416, "y": 2956, "rotation": 180 }
```

- Capture with the one-tile margin `find_buildings` suggests: walls often sit on the tile
  just outside the roof. A building that shares a wall (with a neighbour, or a city wall)
  loses it in a tight capture and gains that neighbour's piece in a wide one; check the
  paste with a screenshot.
- Rotation turns every loc's position, footprint and facing, and floor overlays with them.
- Interactive locs (doors, ladders, stairs, furniture with options) are skipped by default
  (`interactive: "keep"` keeps them): their handlers belong to the place they came from.
- Terrain: `floors` (default) copies floor overlays and indoor/roof tile flags; `all` also
  underlays and heights, shifted so the template's corner sits at `baseHeight`; `none` skips
  it. The blocked and bridge flags are never copied.
- Templates are one file each, one loc per line. Commit the good ones: they are the catalog.

### Styles and walls in a style

A style is the set of wall pieces one real building uses, by role, so new structures can be
drawn in its look:

| Tool | Purpose |
| --- | --- |
| `capture_style` | Read a building's pieces into `plugins/agent/data/edit-styles.json`: wall, corner, post, diagonal, door, gate, floor (most common wins; `roles` overrides) |
| `list_styles` | Captured styles, with the variants (windows, decorated walls) left to assign by hand |
| `build_wall` | A wall in a style along a path of tile corners: city walls, palisades, enclosures |

```jsonc
// A Falador-stone fort: closed square, a gateway on the south side, 3x3 towers every 6 tiles.
build_wall { "style": "falador-white", "closed": true, "facing": "out",
             "points": [[3400,2992],[3412,2992],[3412,3004],[3400,3004]],
             "gates": [[3406,2992]], "towerEvery": 6, "towerSize": 3 }
```

- Points are tile **corners**: (x, y) is the south-west corner of tile x, y. Straight runs
  become wall pieces on tile edges, 45-degree runs diagonal pieces.
- Many walls have a finished face on one side only. `facing` (`out`/`in`) picks it for a
  closed wall, `side` (`left`/`right` of the walking direction) for an open one. A wall that
  renders black in a screenshot is showing its back: flip it.
- `gates` are corners whose next edge stays open; the style's gate or door hangs there unless
  `gateDoors: false`.

Shipped styles: `falador-white`, `varrock-city-wall`, `lumbridge-castle`, `emir-sandstone`
(low wall), `lumbridge-fence`.

### Clearing a site

`clear_area` removes what the spawn file placed and leaves the cache map's own scenery
(fences, ground decoration, unnamed walls `observe` does not list) standing. Pass
`includeCache: true` to raze those too; that persists a removal marker per object, which
`restore_area` undoes for a rectangle. Run it with `dryRun: true` first to see the counts.
It also drops spawn-file placements in the rectangle that no longer stand live.

A tile holds one object per type, so a placement replaces whatever stood in that slot. The
build tools collapse parts that land on the same tile and type (the later one wins, as it does
live) and report `overlapped`; a placement that replaces an earlier one drops its entry and
reports `replaced`, so the file only holds what stands.

### NPCs

`search_npcs`, `describe_npc`, `spawn_npc`, `remove_npc`, `list_spawned_npcs` — same pattern
as objects, persisted to `npc-spawns.json` with `level` (plane) and `wanderRadius`.
`remove_npc` takes the spawn tile from `list_spawned_npcs` and finds the NPC wherever it has
wandered.

### Terrain

| Tool | Purpose |
| --- | --- |
| `describe_tile` | Overlay, underlay, height and flag for one tile |
| `paint_ground` | Overlay (paths/floors) and/or underlay over a rectangle |
| `set_height` | Raise/lower/flatten heights, one plane or all |
| `clear_terrain` | Restore a rectangle to the cache's own terrain |
| `list_region_packs` | Regions with active replacements; `matchesCache` marks one cleared back to the cache |

A region cleared back to the cache's own bytes (and holding no replaced objects) has its file
deleted, so it no longer loads as a replacement after a restart. It stays registered for the
rest of the session, so clients still holding the edited terrain get the cache's on their next
scene rebuild.

Terrain is **visual only**: collision still comes from objects and the base map. If you level
a hill, build the floor you want to walk on with objects, or accept that movement follows the
cache.

## The 65 KB packet budget

This is the constraint that shapes larger builds, so it is worth understanding.

A region replacement is not a delta — the server sends the whole encoded 64×64×4-plane
terrain blob in one `REGION_REPLACEMENT` packet, and the client stores it wholesale. Packet
payload ceiling: `MapRegionReplacementManager.MAX_PACKET_PAYLOAD = 0xfffd` (65,533 bytes).

Cost per edited tile, on top of the cache's own encoding:

| Edit | Approx. cost |
| --- | --- |
| height | 3 bytes |
| overlay | 4 bytes |
| underlay | 4 bytes |

Dense regions start close to the cap from the cache alone: Lumbridge (region 12850) is about
60 KB before any edit, leaving roughly 5 KB, about 1,300 overlay edits — nowhere near enough to
repaint and terrace a 90×71 site. Every terrain result reports `terrainBytes` per region; read
it after the first small edit before planning a big one.

What actually works:

1. **Terrain-only replacements** — the tools never send object bytes for terrain edits, and the
   client falls back to the cache's objects. Keeps regions ~8 KB smaller.
2. **Clear first** — `clear_terrain` restores the cache encoding, the smallest form, freeing
   everything the previous edits added.
3. **Edit a smaller footprint** — paint the plateau and terraces, not every tile of a rectangle.
4. **Use more regions** — each region has its own budget and its own packet. Spreading a city
   across regions buys space linearly.

When a region overflows, the tool fails with
`region replacement is too large: region=<id> bytes=<n> max=65533`; nothing is half-applied.
Clean up with `clear_terrain` and try a smaller footprint. Removing the cap entirely would need
a chunked replacement protocol (split the terrain stream, reassemble client-side) — not
implemented here.

## Persistence format rules

`object-spawns.json` and `npc-spawns.json` are large, hand-maintained files. Writes preserve
them: one compact entry per line, the file's own line endings, untouched entries byte-identical.
Adding one spawn shows a one-line diff, not a 30,000-line reformat. Do not "tidy" these files
from a tool.

Object entry: `{ id, position: { x, y, z }, type?, face?, remove?, source? }`.
`remove: true` means "this cache object is gone" and is applied before placements on load.

## Editor integration

The standalone editor (`/?edit`, `/?editor`) is a logged-out scene preview. It pulls server
state on open and on **Refresh map**:

- `GET /regions` → active replacement ids
- `GET /regions/<id>.pack` or `/regions/<id>.terrain` → terrain bytes
- `GET /api/world/object-spawns` → persisted placements (rendered as spawn edits)

So an agent build appears in the editor without a login, and the same edits appear in-game to
logged-in players on scene rebuild (walk, teleport, relog).

## What looks right

Read [map-building-notes.md](map-building-notes.md) before building anything bigger than a test
piece: which objects render well and which don't, how to place walls so they join, how terrain
height reads in game, screenshot workflow, sites and their budgets. Before you report a build
done, add anything it taught you to that file: a build isn't finished until its findings are
written down.

## A worked build

```js
// 1. Site: flatten, then pave a plateau that fits the budget.
clear_area      { x1, y1, x2, y2, dryRun: true }   // see what would go first
clear_area      { x1, y1, x2, y2, includeCache: true } // raze cache scenery too; keeps terrain
clear_terrain   { x1, y1, x2, y2 }                 // back to cache encoding (frees bytes)
paint_ground    { x1, y1, x2, y2, overlay: 1 }     // dirt
set_height      { x1, y1, x2, y2, height: 57 }     // outer terrace
set_height      { x1, y1, x2, y2, height: 59 }     // inner terrace (nested)

// 2. Structure: presets and shapes, not single tiles.
build_preset    { preset: "tiered_city", x: 3090, y: 3485 }
build_shape     { shape: "avenue", material: "brazier", x: 3100, y: 3485, x2: 3120, y2: 3485, offset: 3 }
build_preset    { preset: "house", x: 3104, y: 3498, params: { width: 5, height: 5 } }

// 3. Life.
spawn_npc       { id: 3254, x: 3092, y: 3485, wanderRadius: 3 }
```

## Testing

```bash
node --test server/tests/edit-mcp.test.cjs          # objects
node --test server/tests/edit-world-mcp.test.cjs    # NPCs + terrain
node --test server/tests/edit-build-mcp.test.cjs    # geometry + presets + batches
```

The tests use fake cores and temp files, so they need no server. For a live check, start the
server with `AGENT_MCP=1` and drive the tools over HTTP; `observe` on a logged-in player
confirms a placement reached the world, and `describe_tile` confirms terrain.

## Conventions for new tools

- One file per area (`Edit*.AgentMcp.js`), registered in `AgentMcp.plugin.js`, helpers in
  `EditGeometry`/`EditSpawnStore` rather than copy-pasted.
- Validate in the handler, not only in the zod schema: the schema is not applied when a
  handler is called directly.
- Read paths from `process.env.AGENT_MCP_*` with the server's real path as the default, so
  tests never touch repo data.
- Never write a definition file per item; batch, then write once.
- Report counts and bounds, not thousands of entries.
