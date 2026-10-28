# Sea charting

Sailing's charting tasks: 358 spots around the seas, each charted once into the Captain's log for
Sailing XP, with a bonus for every sea or group fully charted and one per ocean, paid by Chartin'
Charles McAtless. Six kinds: **generic** spots (a loc with Chart), **spyglass** views, **current
ducks**, **drink crates**, **weather trolls** and **mermaid guides**.

Plugin: `server/plugins/skills/sailing/Charting.plugin.js`, with its units in `charting/` and its
data in `data/charting.json`. Tests: `server/tests/sea-charting.test.cjs`.

## Sources

- rsprox captures from https://rsprox.net/database (rev 235). Generic spots: recordings 944, 948,
  1009, 3455 and 3467 (every one of the 94 generic tasks is charted in at least one recording).
  XP: recordings from 2025-11-26 on (907, 938-948, 1009, 3461, 3837, 4290); the launch-day ones
  (3450, 3455, 3467, 2025-11-19) paid less for every kind of spot.
- The cache:
  - DB table 154 (`sailing_charting_core`): each task's unique id, hint (the task text), sea,
    secondary sea, kind (the kind's table, 155-160) and whether a current duck pays XP again.
    The kinds' tables only link back to it; their other columns are empty in our cache.
  - DB table 201 (`sailing_sea`): seas, oceans and the bonus groups, with their level and
    whether a fully charted sea opens rapids.
  - Varps 5016-5027 (`sailing_charting_completion_0..11`): task n is bit `n & 31` of varp
    `5016 + (n >> 5)`, as script 9004 reads it. Varps 5028-5033: each sea's (bit = its unique id)
    completion and ever-completed bits. Varp 5034: the oceans' owed bonuses (bit = ocean id).
    Varp 5037: the number of tasks charted. Varp 5035 bits 0, 1 and 7: everything charted.
- The OSRS Wiki's [Sea charting](https://oldschool.runescape.wiki/w/Sea_charting) task list (each
  task's location, a current duck's end, a weather station's spot, a mermaid's riddle answer) and
  [Sea charting/By oceans](https://oldschool.runescape.wiki/w/Sea_charting/By_oceans) (the sea and
  ocean bonuses).

## Units

| Unit | Does |
|---|---|
| `Common` | Tasks and seas from the cache joined with `data/charting.json`; the saved `charting:progress` attribute; `complete`, the one way every kind of task is charted; letting go of the helm first. |
| `Progress` | The charts sent to the client at login. |
| `Generic` | The 92 Chart locs, the Port Sarim task board and salvaging station, the crab statue's Medallion fragment. |
| `Dev` | `::chart go <task>`, `::chart done <task>`, `::chart reset [task]`, `::chart find <text>` (developers). |

## Core changes

- `api.setUsableFromDeck` takes loc ids as well as names. A loc used from a deck but out of
  reach no longer lets go of the helm: live answers "I can't reach that!" and nothing else
  (rsprox 3455).
- `Helm.plugin.js` listens to `sailing:leave-helm` (`{ player }`, answered with `left`) so
  other plugins can let go of the helm the way the helm's own option does.

## Behaviour (rsprox)

Every task, on success (rsprox 1009, 944):

1. The task's own line(s), when it has one.
2. Its varbit (`sailing_charting_<task>_complete`, sent here as its varp word).
3. `Charting complete: <col=0090bc>{hint}</col>`.
4. `{Sea} charting completion: <col=0090bc>n/N</col>`, then the same for its ocean
   (`Miscellaneous` for the bonus groups).
5. A sea or group fully charted: `You have completed charting a sea: {sea}` (or `a group`),
   `Fully charting this sea has unlocked the use of some <col=0090bc>rapids</col> within it.` when
   the sea has rapids, `You are awarded an additional <col=0090bc>{xp}</col> Sailing XP.` and the
   sea's completion varbit.
6. An ocean fully charted: `You have completed charting an ocean: {ocean}`, its ever-completed
   and XP-owed varbits, `For fully charting this ocean, Chartin' Charles McAtless on the
   Pandemonium will provide you with some training when you next speak to him.`, its completion
   varbit.
7. The popup (`notification_display`, "Charting Complete!" with the hint), sound 11166 and the
   XP: the task's and the sea's bonus in one drop.

| Kind | XP |
|---|---|
| Generic | 35 |
| Spyglass | 50 |
| Drink crate | 75 |
| Current duck | 125 |
| Mermaid guide | 175 |
| Weather troll | 250 |

The sea and group bonuses go by the sea's XP level (`xp_level`, else `required_level`): 190 (up
to 5), 270 (12), 510 (22), 590 (24), 1,710 (38), 1,990 (40), 2,880 (45), 4,430 (51), 6,710 (57),
8,750 (61), 12,030 (66), 17,230 (72), 23,910 (78).

**Generic spots** (rsprox 1009, 3455, 3467): Chart is used from the deck. From the helm, the
click lets go of it (`facility_lockedin` 3->0, `player_at_helm` 1->0, `helm_status` 2->1, sound
10793) and the rest comes a tick later; off the helm, all on the click. The writing animation
(13302) plays with the messages.
- Too far: `I can't reach that!`, and the player stays at the helm.
- Charted already: `You have already charted this and can get no further information from it.`
- An item used on it: `Nothing interesting happens.` (core).
- The Port Sarim task board (Inspect) and salvaging station (Sort-salvage) chart their task
  before doing what they do.
- The crab statue on Wintumber Island also adds a Medallion fragment, with its collection log
  line and an object box.

## Ours (not captured)

- Reach from the deck is the deck's usual 12 tiles from the tile under the player. The captures
  have clicks answered from 2 to 12 tiles and refused from 8.5 on, measured from the boat's
  centre, so the real rule is likely measured from somewhere else on the boat.
- The player doesn't turn towards the spot (live sends a face angle; the deck's frame would need
  the boat's heading worked in).

## Not done (captured)

- Spyglass, current duck, drink crate, weather troll and mermaid guide tasks, and Chartin'
  Charles's ocean bonuses (later phases of this PR).
