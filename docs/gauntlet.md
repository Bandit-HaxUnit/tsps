# The Gauntlet

The Gauntlet and the Corrupted Gauntlet, ported from Near-Reality's implementation and checked against the OSRS Wiki and the cache. It is one plugin, `server/plugins/minigames/Gauntlet.plugin.js`, which delegates to one unit per area in `server/plugins/minigames/gauntlet/`.

Status: the maze, the lobby and the run (entry, timer, exits, death) are done. Resources, crafting, monsters, the Hunllef and rewards are still to come.

## Layout

| File | What it owns |
| --- | --- |
| `GauntletShared.js` | Ids, varbits, tiles and helpers such as fades and dialogues. |
| `GauntletMap.js` | The maze: its layout, the room templates and turns, and lighting rooms. |
| `GauntletRun.js` | One player's run: the starting kit, the preparation timer, the boss phase, ending a run, and stats. |
| `Lobby.*` | The Gauntlet Portal in Prifddinas, the lobby's teleport platform, Bryn and the entrance. |
| `Run.*` | Nodes, the exit platform, the teleport crystal, the barrier, death, teleports and login recovery. |
| `Commands.*` | Developer commands. |

## The maze

The maze is a 7x7 grid of rooms, each 2x2 chunks:
- The Hunllef's room is in the centre.
- The start room sits on a random side of it (Wiki).
- Six rim rooms hold demi-bosses: the bear, the dragon and the dark beast, twice each (Near-Reality).

It is built with the core `TemplatedInstanceArea` (`server/src/main/typescript/elvarg/game/model/areas/impl/`), which:
- copies cache template chunks, turned, into an allocated grid at tile 8192+;
- builds server collision and locs from those templates;
- streams a REBUILD_REGION palette to the players inside, from `PlayerSession`.

Tiles no chunk has been copied to are blocked.

Templates (Near-Reality's, checked against the cache):

| Room | Source chunk |
| --- | --- |
| Four exits (middle) | x 232, y 704 / 706 / 708 / 710 |
| Three exits (rim) | x 234, same four variants |
| Two exits (corner) | x 236, same four variants |
| Start room | (238, 708) |
| Hunllef room | (238, 710) |

The Corrupted Gauntlet uses the same layout 8 chunks east. Rim and corner rooms are turned so their closed sides face out; middle rooms turn at random. A test walks every doorway of a fully lit maze to check this.

**Revealing rooms:**
- The whole layout is decided when the maze is made.
- A room is only drawn once lit, from a Node on the edge of a lit room (Wiki: nodes are lit "to visit new rooms"). The node's side of its room gives the direction.
- Lighting copies the room's chunks and sends the new scene to the player.

## A run

**Entry.** The entrance (37340) is a multiloc on varp 2353: it shows "Enter", plus "Enter-corrupted" after any completion. Bryn turns players away if they:
- haven't spoken to him (his first talk sets this);
- have a pet out;
- have a reward waiting (varbit 9179).

His lines come from the Wiki transcript. You must also have an empty inventory and equipment, because nothing can be taken in or out.

**Starting kit** (Wiki): a crystal sceptre (wielded), then an axe, pickaxe, harpoon, pestle and mortar, and a teleport crystal. The Corrupted kit uses the corrupted versions. Near-Reality also gave a weapon frame and 50 shards; that isn't on the Wiki, so it's left out.

**Timer.** You get 10 minutes to prepare, or 7:30 in the Corrupted Gauntlet:
- interface 637 sits on the HUD overlay (161:8);
- script 2914(ticks) runs the countdown;
- script 2916 shows "Final Encounter".

When time runs out, you are taken into the boss room.

**Maze varbits:**

| Varbit | Meaning |
| --- | --- |
| 9178 | Maze map |
| 9292 | Corrupted |
| 9291 | Start room |
| 9289 / 9290 | Current room |
| 9240 + y * 7 + x | A lit room |
| 9177 | Boss phase |

**Barrier** (37339, corrupted 37337, a multiloc on varbit 9177):
- During preparation it offers Pass (asks first) and Quick-pass, which take you two tiles in and start the fight.
- During the fight it offers Escape.

**Leaving:**
- The start room's platform (36062 / 35965): Exit asks first, Quick-exit doesn't.
- Escape at the barrier, death, or logging out.

Every exit takes everything you carry and returns you to the lobby at (3032, 6127, 1). Dying drops nothing and counts a death. Teleports are blocked inside. A player saved inside a maze (after a server stop) is returned to the lobby on login.

**Lobby:**
- The Gauntlet Portal (36081) at (3229, 6114) in Prifddinas leads down.
- The lobby's Teleport Platform (36082) channels back up.
- `::teleports` has a Minigames entry for the lobby.

## Developer commands

| Command | Does |
| --- | --- |
| `::gauntlet` | Teleports to the lobby. |
| `::gauntletmap [corrupted] [all]` | A maze without a run, to inspect; `all` lights every room. |
| `::gauntletstart [corrupted]` | Starts a run without Bryn's checks; your hands must be empty. |
| `::gauntletboss` | Ends preparation and takes you to the Hunllef. |
| `::gauntlettime <seconds>` | Sets the preparation time left. |

## Tests

`server/tests/templated-instance.test.cjs`: turned copies collide like the cache map turned with them, and locs are found where the client draws them.

`server/tests/gauntlet.test.cjs`:
- the layout;
- doorways and the closed rim;
- lighting rooms;
- entry checks and the starting kit;
- the timer, the barrier and Escape;
- death, teleports and logout.
