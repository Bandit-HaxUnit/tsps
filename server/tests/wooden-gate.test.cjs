// Run after `yarn build`: node --test tests/wooden-gate.test.cjs
//
// Wooden gates are two locs (hinge 12986 + extension 12987) that must swing together around
// the hinge post; opening replaces both with 12988/12989 on the perpendicular tile line.
const assert = require('node:assert/strict');
const { test } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { Location } = require('../dist/game/model/Location');
const { GameObject } = require('../dist/game/entity/impl/object/GameObject');
const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
const { Sounds } = require('../dist/game/Sounds');
const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');

const tileKey = (id, x, y, z) => `${id}@${x},${y},${z}`;

function buildHarness() {
  const world = new Map();
  const ops = [];
  const sounds = [];

  const originalGet = MapObjects.get;
  const originalSound = Sounds.sendSound;
  const originalGetObject = CacheDefinitions.getObject;
  const originalGetCounts = CacheDefinitions.getCounts;
  MapObjects.get = (id, location) =>
    world.get(tileKey(id, location.getX(), location.getY(), location.getZ())) ?? null;
  Sounds.sendSound = (...args) => sounds.push(args);
  CacheDefinitions.getObject = () => ({ name: 'Gate' });
  CacheDefinitions.getCounts = () => ({ npcs: 0, items: 0, objects: 0 });

  const handlers = new Map();
  const api = {
    core: {},
    getObjectManager: () => ({
      register: (o) => ops.push(['register', o.getId(), o.getLocation().getX(), o.getLocation().getY(), o.getFace()]),
      deregister: (o) => ops.push(['deregister', o.getId(), o.getLocation().getX(), o.getLocation().getY(), o.getFace()]),
    }),
    getTaskManager: () => ({ submit: () => {}, cancelTasks: () => {} }),
    emitCustomEvent: () => {},
    onObjectInteraction: (name, actions) => handlers.set(name, actions),
    onRegionLoaded: () => {},
    onPlayerProcess: () => {},
  };
  require('../plugins/objects/Doors.plugin').register(api);

  const place = (id, x, y, face) => {
    const object = new GameObject(id, new Location(x, y, 0), 0, face, null);
    world.set(tileKey(id, x, y, 0), object);
  };

  const click = (id, x, y, face, action = 'Open') => {
    const object = new GameObject(id, new Location(x, y, 0), 0, face, null);
    const location = object.getLocation();
    const player = {
      getUsername: () => 'tester',
      isPlayerBot: () => false,
      getPrivateArea: () => null,
      getLocation: () => location,
      getAttribute: () => 0,
      setAttribute: () => {},
      isNeedsPlacement: () => false,
      isAllowRegionChangePacket: () => false,
      getPacketSender: () => ({}),
    };
    ops.length = 0;
    handlers.get('Gate')[action]({ player, object, objectId: id, location });
    return ops.splice(0);
  };

  const restore = () => {
    MapObjects.get = originalGet;
    Sounds.sendSound = originalSound;
    CacheDefinitions.getObject = originalGetObject;
    CacheDefinitions.getCounts = originalGetCounts;
  };

  return { place, click, sounds, restore };
}

test('wooden gate swings hinge + extension panels open from a closed hinge click', () => {
  const h = buildHarness();
  try {
    h.place(12986, 100, 100, 0);
    h.place(12987, 100, 101, 0);
    const ops = h.click(12986, 100, 100, 0);
    assert.deepEqual(ops, [
      ['deregister', 12986, 100, 100, 0],
      ['deregister', 12987, 100, 101, 0],
      ['register', 12988, 99, 100, 3],
      ['register', 12989, 98, 100, 3],
    ]);
    assert.equal(h.sounds.length, 1, 'gate open should play a sound');
  } finally {
    h.restore();
  }
});

test('clicking the closed extension opens the same way as the hinge', () => {
  const h = buildHarness();
  try {
    h.place(12986, 100, 100, 0);
    h.place(12987, 100, 101, 0);
    const ops = h.click(12987, 100, 101, 0);
    assert.deepEqual(ops, [
      ['deregister', 12986, 100, 100, 0],
      ['deregister', 12987, 100, 101, 0],
      ['register', 12988, 99, 100, 3],
      ['register', 12989, 98, 100, 3],
    ]);
  } finally {
    h.restore();
  }
});

test('open wooden gate closes back onto its original tiles', () => {
  const h = buildHarness();
  try {
    h.place(12988, 99, 100, 3);
    h.place(12989, 98, 100, 3);
    const ops = h.click(12988, 99, 100, 3);
    assert.deepEqual(ops, [
      ['deregister', 12988, 99, 100, 3],
      ['deregister', 12989, 98, 100, 3],
      ['register', 12986, 100, 100, 0],
      ['register', 12987, 100, 101, 0],
    ]);
  } finally {
    h.restore();
  }
});

test('wooden gate open + close round-trips for a north-facing (rotation 1) gate', () => {
  const h = buildHarness();
  try {
    h.place(12986, 200, 200, 1);
    h.place(12987, 201, 200, 1);
    const opened = h.click(12986, 200, 200, 1);
    assert.deepEqual(opened, [
      ['deregister', 12986, 200, 200, 1],
      ['deregister', 12987, 201, 200, 1],
      ['register', 12988, 200, 201, 0],
      ['register', 12989, 200, 202, 0],
    ]);
    h.place(12988, 200, 201, 0);
    h.place(12989, 200, 202, 0);
    const closed = h.click(12988, 200, 201, 0);
    assert.deepEqual(closed, [
      ['deregister', 12988, 200, 201, 0],
      ['deregister', 12989, 200, 202, 0],
      ['register', 12986, 200, 200, 1],
      ['register', 12987, 201, 200, 1],
    ]);
  } finally {
    h.restore();
  }
});

test('newly catalogued gates (47/48, 883/23917, 15514/15516) swing to their open ids', () => {
  const h = buildHarness();
  try {
    h.place(47, 300, 300, 0);
    h.place(48, 300, 301, 0);
    assert.deepEqual(h.click(47, 300, 300, 0), [
      ['deregister', 47, 300, 300, 0],
      ['deregister', 48, 300, 301, 0],
      ['register', 49, 299, 300, 3],
      ['register', 50, 298, 300, 3],
    ]);

    h.place(883, 310, 310, 0);
    h.place(23917, 310, 311, 0);
    assert.deepEqual(h.click(883, 310, 310, 0), [
      ['deregister', 883, 310, 310, 0],
      ['deregister', 23917, 310, 311, 0],
      ['register', 23918, 309, 310, 3],
      ['register', 23919, 308, 310, 3],
    ]);

    h.place(15514, 320, 320, 0);
    h.place(15516, 320, 321, 0);
    assert.deepEqual(h.click(15514, 320, 320, 0), [
      ['deregister', 15514, 320, 320, 0],
      ['deregister', 15516, 320, 321, 0],
      ['register', 15511, 319, 320, 3],
      ['register', 15513, 318, 320, 3],
    ]);
  } finally {
    h.restore();
  }
});

test('gates with a Release action swing open (60763/60760)', () => {
  const h = buildHarness();
  try {
    h.place(60763, 400, 400, 0);
    h.place(60760, 400, 401, 0);
    assert.deepEqual(h.click(60763, 400, 400, 0, 'Release'), [
      ['deregister', 60763, 400, 400, 0],
      ['deregister', 60760, 400, 401, 0],
      ['register', 60761, 399, 400, 3],
      ['register', 60762, 398, 400, 3],
    ]);
  } finally {
    h.restore();
  }
});
