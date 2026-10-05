# World map

The world map is interface 595, opened as an overlay from the minimap's world map orb (`orbs:worldmap`, 160:55). The client draws the map itself; the server tells it where the player is through clientscript `worldmap_transmitdata` (1749), whose first argument is the player's coordinate (the other two are null, sent as -1).

## The player's position

Facts from a live OSRS capture (rsprox) of a player opening the map and running around Lumbridge with it open:

- **On opening**, the server runs 1749 with the player's coordinate, then opens 595 (`if_opensub` on `toplevel_pre_eoc:floater`, 164:18) and sets the events on `worldmap:toggles` (595:21, slots 0-4, OP1).
- **While the map is open**, the server runs 1749 again **every 3 ticks**, counted from the tick the map opened on, **only if the position changed** since the last time it was sent. Opening at tick 15787, the player started running at 15790: nothing was sent at 15790, then 15793, 15796 and 15799 each sent a new position.
- **The position sent** is the player's tile at the start of that tick, one step behind where the same tick's player update moves them.
- **On closing** (`if_closesub` of 595), the updates stop.

## Implementation

- `PacketSender.toggleWorldMap` opens and closes the map; opening sends the position through `sendWorldMapPosition`, which remembers the last position sent (`getWorldMapPosition`).
- `server/plugins/interface/WorldMapPosition.plugin.js` sends the updates: on each player tick it counts the ticks since the map opened and, every 3 ticks, sends the start-of-tick position if it differs from the last one sent.
- `server/tests/world-map-position.test.cjs` replays the capture's ticks and checks the same sends.
