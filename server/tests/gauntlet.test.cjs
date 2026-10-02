// Run after `yarn build`: node --test tests/gauntlet.test.cjs
const assert = require('node:assert/strict');
const { test, before } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Location } = require('../dist/game/model/Location');
const Shared = require('../plugins/minigames/gauntlet/GauntletShared');
const GauntletMap = require('../plugins/minigames/gauntlet/GauntletMap');

before(() => {
  CachePipeline.initialize();
  RegionManager.init();
  Shared.bind({ core: PluginManager.getCoreApi() });
});

/** A seeded random, so a failing layout can be replayed. */
function seeded(seed) {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x80000000;
  };
}

/** How many tiles along a room's side lead into the next room. */
function openings(map, room, side) {
  let open = 0;
  for (let i = 0; i < GauntletMap.ROOM_TILES; i++) {
    const last = GauntletMap.ROOM_TILES - 1;
    const [x, y] = side.dx ? [side.dx > 0 ? last : 0, i] : [i, side.dy > 0 ? last : 0];
    const from = map.roomTile(room, x, y);
    if (RegionManager.canMove(from.getX(), from.getY(), from.getX() + side.dx, from.getY() + side.dy,
      from.getZ(), 1, 1, map)) open++;
  }
  return open;
}

test('the layout follows the Wiki: boss in the centre, start beside it, six demi-boss rooms on the rim', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const { start, rooms } = GauntletMap.planLayout(seeded(seed));
    assert.equal(Math.abs(start.x - 3) + Math.abs(start.y - 3), 1, 'the start room is next to the boss room');
    assert.equal(rooms[3][3].special, 'boss');
    assert.equal(rooms[start.x][start.y].special, 'start');
    const demiBosses = rooms.flat().filter((room) => room.demiBoss);
    assert.equal(demiBosses.length, 6);
    for (const kind of ['bear', 'dragon', 'dark_beast']) {
      assert.equal(demiBosses.filter((room) => room.demiBoss === kind).length, 2, kind);
    }
    assert.ok(demiBosses.every((room) => GauntletMap.isDemiBossRoom(room.gridX, room.gridY)));
  }
});

test('every lit room opens into its neighbours and the maze is closed at its rim', () => {
  for (const corrupted of [false, true]) {
    const map = GauntletMap.createMap({ corrupted, random: seeded(7) });
    try {
      map.lightAll();
      for (const room of map.rooms.flat()) {
        for (const side of GauntletMap.SIDES) {
          const x = room.gridX + side.dx;
          const y = room.gridY + side.dy;
          const inside = x >= 0 && y >= 0 && x < GauntletMap.GRID && y < GauntletMap.GRID;
          const open = openings(map, room, side);
          assert.equal(open > 0, inside,
            `${corrupted ? 'corrupted ' : ''}${room.type} (${room.gridX}, ${room.gridY}) turned ${room.rotation}: ${side.name} has ${open} openings`);
        }
      }
    } finally {
      map.destroy();
    }
  }
});

test('only the start and boss rooms are drawn at first; lighting a room opens the way into it', () => {
  const map = GauntletMap.createMap({ random: seeded(3) });
  try {
    const start = map.room(map.start.x, map.start.y);
    assert.ok(start.lit && map.room(3, 3).lit);
    assert.equal(map.rooms.flat().filter((room) => room.lit).length, 2);
    const tile = map.startTile(seeded(1));
    assert.equal(RegionManager.getClipping(tile.getX(), tile.getY(), tile.getZ(), map) & 0x1280100, 0,
      'the start tile is open floor');

    // A side of the start room that leads away from the boss room.
    const side = GauntletMap.SIDES.find((s) => map.room(start.gridX + s.dx, start.gridY + s.dy)?.special == null);
    assert.equal(openings(map, start, side), 0, 'nothing past an unlit node');
    const version = map.getSceneVersion();
    assert.ok(map.lightRoom(start.gridX + side.dx, start.gridY + side.dy));
    assert.ok(map.getSceneVersion() > version, 'everyone inside is sent the new scene');
    assert.ok(openings(map, start, side) > 0);
    assert.equal(map.lightRoom(start.gridX + side.dx, start.gridY + side.dy), false, 'already lit');
  } finally {
    map.destroy();
  }
});

test('rooms are found from their tiles', () => {
  const map = GauntletMap.createMap({ random: seeded(5) });
  try {
    const room = map.room(2, 4);
    assert.equal(map.roomAt(map.roomTile(room, 0, 0)), room);
    assert.equal(map.roomAt(map.roomTile(room, 15, 15)), room);
    assert.equal(map.roomAt(new Location(3032, 6127, 1)), null);
  } finally {
    map.destroy();
  }
});
