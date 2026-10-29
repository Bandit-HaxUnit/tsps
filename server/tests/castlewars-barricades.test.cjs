// Run after `yarn build`: node --test tests/castlewars-barricades.test.cjs
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { World } = require('../dist/game/World');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PathFinder } = require('../dist/game/model/movement/path/PathFinder');
const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
const core = PluginManager.getCoreApi();
const Game = require('../plugins/minigames/castlewars/Game.CastleWars');
const Barricades = require('../plugins/minigames/castlewars/Barricades.CastleWars');
const Tunnels = require('../plugins/minigames/castlewars/Tunnels.CastleWars');
const Mining = require('../plugins/skills/Mining.plugin');
const data = require('../plugins/minigames/castlewars/Data.CastleWars')(core);
let game;
let setup;
let itemOnNpc;
let burn;
let mine;
let collapse;
let blastWall;
const swaps = [];

before(() => {
  CachePipeline.initialize();
  RegionManager.init();
  RegionManager.loadMapFiles(2426, 3080);
  RegionManager.loadMapFiles(2391, 9501);
  const api = {
    core,
    getAreaManager: () => ({}),
    getBonusManager: () => ({}),
    getObjectManager: () => ({ register() {}, deregister() {} }),
    getRegionManager: () => RegionManager,
    getTaskManager: () => ({ submit() {} }),
    getWorld: () => World,
    onItemAction(name, actions) { setup = actions['Set-up']; },
    onNpcDeath() {},
    onNpcInteraction(name, actions) { burn = actions.Burn; },
    onItemOnNpc(fn) { itemOnNpc = fn; },
    onObjectInteraction(name, actions) { if (name === 'Rocks') mine = actions.Mine; else collapse = actions.Collapse; },
    onItemOnObject(item, name, fn) { if (name === 'Cave wall') blastWall = fn; },
    emitCustomEvent(name, request) { if (name === 'mining:best-pickaxe') request.pickaxe = Mining.findBestPickaxe(request.player); },
  };
  game = Game(api);
  game.isPlaying = () => true;
  game.requirePlaying = () => true;
  game.getTeamId = () => data.TEAM.SARADOMIN;
  game.swapObject = (...args) => swaps.push(args);
  game.gameArea = { getPlayers: () => [] };
  Barricades(api, game);
  Tunnels(api, game);
});

function playerAt(t, x, y, z = 1) {
  const p = new Player(null, new core.Location(x, y, z));
  const messages = [];
  const graphics = [];
  t.mock.method(p, 'getSession', () => ({ sendClientPacket() {}, write() {} }));
  t.mock.method(p, 'sendMessage', (message) => messages.push(message));
  t.mock.method(p.getPacketSender(), 'sendGlobalGraphic', (graphic, location) => graphics.push({ graphic, location }));
  p.messages = messages;
  p.graphics = graphics;
  p.getInventory().add(new core.Item(core.ItemIdentifiers.BARRICADE, 3));
  return p;
}

function deployed(t, p) {
  const before = new Set([...World.getNpcs()]);
  setup({ player: p, slot: 2 });
  const npc = [...World.getNpcs()].find((entry) => !before.has(entry));
  assert.ok(npc, p.messages.join('\n'));
  t.after(() => {
    game.releaseBarricade(npc);
    World.getRemoveNPCQueue().splice(0);
    World.getNpcs().remove(npc);
  });
  return npc;
}

test('the energy-barrier exit and nonblocking map objects allow immediate barricades', (t) => {
  for (const [x, y] of [[2426, 3081], [2426, 3080], [2423, 3076]]) {
    const p = playerAt(t, x, y);
    const inventory = p.getInventory();
    const npc = deployed(t, p);
    assert.equal(npc.isRegistered(), true, 'registered before the next world queue pass');
    assert.equal(World.getAddNPCQueue().includes(npc), false);
    assert.equal(inventory.getItems()[0].getId(), -1, 'the first barricade was consumed');
    assert.equal(inventory.getItems()[2].getId(), core.ItemIdentifiers.BARRICADE, 'the clicked last barricade stays put');
  }
});

test('a barricade stops walking without making the pathfinder walk around it', (t) => {
  const p = playerAt(t, 2405, 3110, 0);
  const npc = deployed(t, p);
  const walker = playerAt(t, 2406, 3110, 0);
  assert.equal(RegionManager.blocked(npc.getLocation(), null), false, 'NPC collision is outside map collision');
  PathFinder.calculateWalkRoute(walker, 2404, 3110);
  assert.ok(walker.getMovementQueue().pointsReturn().every((point) => point.position.getY() === 3110), "the route stays straight through the barricade");
  assert.equal(walker.getMovementQueue().canWalkTo(new core.Location(2405, 3110, 0), walker.getLocation()), false);
  assert.equal(walker.getMovementQueue().canWalkTo(new core.Location(2406, 3111, 0), walker.getLocation()), true);
  game.releaseBarricade(npc);
  assert.equal(walker.getMovementQueue().canWalkTo(new core.Location(2405, 3110, 0), walker.getLocation()), true);
});

test('solid tunnel rocks and stepping stones refuse barricades', (t) => {
  for (const [x, y, z] of [[2391, 9501, 0], [2418, 3123, 0]]) {
    const p = playerAt(t, x, y, z);
    const amount = p.getInventory().getAmount(core.ItemIdentifiers.BARRICADE);
    setup({ player: p, slot: 0 });
    assert.match(p.messages.at(-1), /can't set up a barricade here/);
    assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.BARRICADE), amount);
  }
});

test('lighting your own tile steps sideways; right-click Burn never consumes supplies', (t) => {
  const p = playerAt(t, 2426, 3078);
  const npc = deployed(t, p);
  p.getInventory().add(new core.Item(core.ItemIdentifiers.TINDERBOX));
  p.getInventory().add(new core.Item(core.ItemIdentifiers.EXPLOSIVE_POTION));
  const moves = [];
  t.mock.method(p.getMovementQueue(), 'walkStep', (dx, dy) => moves.push([dx, dy]));
  assert.equal(burn({ player: p, npc }), true);
  assert.equal(npc.getNpcTransformationId(), -1);
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.EXPLOSIVE_POTION), 1);
  const event = { player: p, target: npc, itemId: core.ItemIdentifiers.TINDERBOX, slot: 0 };
  itemOnNpc(event);
  assert.equal(event.handled, true);
  assert.deepEqual(moves, [[-1, 0]]);
  assert.equal(npc.getNpcTransformationId(), core.NpcIdentifiers.BARRICADE_2);
});

test('lighting steps right if the left tile is blocked and refuses when both sides are blocked', (t) => {
  const p = playerAt(t, 2428, 3078);
  const npc = deployed(t, p);
  p.getInventory().add(new core.Item(core.ItemIdentifiers.TINDERBOX));
  const moves = [];
  t.mock.method(p.getMovementQueue(), 'canWalk', (dx) => dx === 1);
  t.mock.method(p.getMovementQueue(), 'walkStep', (dx, dy) => moves.push([dx, dy]));
  itemOnNpc({ player: p, target: npc, itemId: core.ItemIdentifiers.TINDERBOX });
  assert.deepEqual(moves, [[1, 0]]);
  npc.setNpcTransformationId(-1);
  t.mock.method(p.getMovementQueue(), 'canWalk', () => false);
  itemOnNpc({ player: p, target: npc, itemId: core.ItemIdentifiers.TINDERBOX });
  assert.equal(npc.getNpcTransformationId(), -1, 'no fire without a free sideways tile');
});

test('extinguishing and relighting starts a fresh burn duration', (t) => {
  const p = playerAt(t, 2425, 3078);
  const npc = deployed(t, p);
  p.getInventory().add(new core.Item(core.ItemIdentifiers.TINDERBOX));
  p.getInventory().add(new core.Item(core.ItemIdentifiers.BUCKET_OF_WATER));
  const callbacks = [];
  t.mock.method(game, 'later', (ticks, complete) => callbacks.push(complete));
  itemOnNpc({ player: p, target: npc, itemId: core.ItemIdentifiers.TINDERBOX });
  itemOnNpc({ player: p, target: npc, itemId: core.ItemIdentifiers.BUCKET_OF_WATER });
  callbacks[0]();
  assert.equal(game.isBarricade(npc), true, 'a doused barricade survives its old burn timer');
  itemOnNpc({ player: p, target: npc, itemId: core.ItemIdentifiers.TINDERBOX });
  callbacks[0]();
  assert.equal(game.isBarricade(npc), true, 'the previous timer cannot end the new fire');
  callbacks[1]();
  assert.equal(game.isBarricade(npc), false, 'the new burn timer removes the barricade');
});

test('the match barricade limit controls placement', (t) => {
  const p = playerAt(t, 2427, 3079);
  t.mock.method(game, 'teamBarricadeCount', () => 10);
  game.getBarricadeLimit = () => 10;
  t.after(() => { delete game.getBarricadeLimit; });
  setup({ player: p });
  assert.match(p.messages.at(-1), /already has 10/);
  game.getBarricadeLimit = () => 20;
  deployed(t, p);
});

test('explicit explosive use sends a tile explosion and removes the barricade', (t) => {
  const p = playerAt(t, 2427, 3078);
  const npc = deployed(t, p);
  p.getInventory().add(new core.Item(core.ItemIdentifiers.EXPLOSIVE_POTION));
  const event = { player: p, target: npc, itemId: core.ItemIdentifiers.EXPLOSIVE_POTION,
    slot: p.getInventory().getSlotForItemId(core.ItemIdentifiers.EXPLOSIVE_POTION) };
  itemOnNpc(event);
  assert.equal(event.handled, true);
  assert.equal(p.getInventory().contains(core.ItemIdentifiers.EXPLOSIVE_POTION), false);
  assert.equal(game.isBarricade(npc), false);
  assert.equal(p.graphics[0].graphic.id, core.CacheDefinitions.getSpotanimId('regicide_barrelflight_exploding'));
  assert.ok(p.graphics[0].location.equals(npc.getLocation()));
});

test('all barricade tools step out of an overlapping tile, but adjacent use stays in place', (t) => {
  for (const itemId of [core.ItemIdentifiers.TINDERBOX, core.ItemIdentifiers.EXPLOSIVE_POTION, core.ItemIdentifiers.BUCKET_OF_WATER]) {
    for (const overlapping of [true, false]) {
      const p = playerAt(t, 2426, 3078);
      const npc = deployed(t, p);
      p.getInventory().add(new core.Item(itemId));
      if (itemId === core.ItemIdentifiers.BUCKET_OF_WATER) npc.setNpcTransformationId(npc.getId() + 1);
      if (!overlapping) p.moveTo(p.getLocation().transform(-1, 0));
      const moves = [];
      t.mock.method(p.getMovementQueue(), 'walkStep', (dx, dy) => moves.push([dx, dy]));
      itemOnNpc({ player: p, target: npc, itemId, slot: p.getInventory().getSlotForItemId(itemId) });
      assert.deepEqual(moves, overlapping ? [[-1, 0]] : [], `tool ${itemId}, overlapping=${overlapping}`);
      game.releaseBarricade(npc);
      World.getNpcs().remove(npc);
    }
  }
});

test('a free north or south tile remains usable when the horizontal sides are blocked', (t) => {
  const p = playerAt(t, 2426, 3078);
  const npc = deployed(t, p);
  p.getInventory().add(new core.Item(core.ItemIdentifiers.TINDERBOX));
  const moves = [];
  t.mock.method(p.getMovementQueue(), 'canWalk', (dx, dy) => dx === 0 && dy === 1);
  t.mock.method(p.getMovementQueue(), 'walkStep', (dx, dy) => moves.push([dx, dy]));
  itemOnNpc({ player: p, target: npc, itemId: core.ItemIdentifiers.TINDERBOX });
  assert.deepEqual(moves, [[0, 1]]);
});

test('unavailable or invalid tool interactions neither move nor consume supplies', (t) => {
  for (const itemId of [core.ItemIdentifiers.TINDERBOX, core.ItemIdentifiers.EXPLOSIVE_POTION, core.ItemIdentifiers.BUCKET_OF_WATER]) {
    const p = playerAt(t, 2426, 3078);
    const npc = deployed(t, p);
    p.getInventory().add(new core.Item(itemId));
    if (itemId === core.ItemIdentifiers.BUCKET_OF_WATER) npc.setNpcTransformationId(npc.getId() + 1);
    t.mock.method(p.getMovementQueue(), 'canWalk', () => false);
    const moves = [];
    t.mock.method(p.getMovementQueue(), 'walkStep', (dx, dy) => moves.push([dx, dy]));
    const before = npc.getNpcTransformationId();
    itemOnNpc({ player: p, target: npc, itemId, slot: p.getInventory().getSlotForItemId(itemId) });
    assert.deepEqual(moves, []);
    assert.equal(npc.getNpcTransformationId(), before);
    assert.equal(game.isBarricade(npc), true);
    assert.equal(p.getInventory().contains(itemId), true);
    assert.equal(p.graphics.length, 0);
    game.releaseBarricade(npc);
    World.getNpcs().remove(npc);
  }
  const p = playerAt(t, 2426, 3078);
  const npc = deployed(t, p);
  p.getInventory().add(new core.Item(core.ItemIdentifiers.EXPLOSIVE_POTION));
  npc.setNpcTransformationId(npc.getId() + 1);
  const moves = [];
  t.mock.method(p.getMovementQueue(), 'walkStep', (dx, dy) => moves.push([dx, dy]));
  itemOnNpc({ player: p, target: npc, itemId: core.ItemIdentifiers.EXPLOSIVE_POTION,
    slot: p.getInventory().getSlotForItemId(core.ItemIdentifiers.EXPLOSIVE_POTION) });
  assert.deepEqual(moves, [], 'a burning barricade rejects explosives before an escape step');
  assert.equal(p.getInventory().contains(core.ItemIdentifiers.EXPLOSIVE_POTION), true);
  assert.equal(game.isBarricade(npc), true);
});

test('a level-one player with a bronze pickaxe clears both tunnel rock layers', (t) => {
  const p = playerAt(t, 2390, 9501, 0);
  p.getInventory().add(new core.Item(core.ItemIdentifiers.BRONZE_PICKAXE));
  p.getSkillManager().setCurrentLevel(core.Skill.MINING, 1);
  swaps.length = 0;
  const rocks = MapObjects.get(core.ObjectIdentifiers.ROCKS_21, new core.Location(2391, 9501, 0), null);
  assert.equal(p.getMovementQueue().reachesObject(rocks, p.getMovementQueue().buildObjectRouteSpec(rocks)), true, "the actual cache rock is reachable from the side");
  for (const id of [core.ObjectIdentifiers.ROCKS_21, core.ObjectIdentifiers.ROCKS_22]) {
    const object = new core.GameObject(id, new core.Location(2391, 9501, 0), 10, 1, null);
    assert.equal(mine({ player: p, object }), true);
  }
  assert.equal(swaps[0][1].getId(), core.ObjectIdentifiers.ROCKS_22);
  assert.equal(swaps[1][1], null);
  assert.equal(game.getTeamVar(data.TEAM.ZAMORAK, data.TEAM_VARBIT.TUNNEL_EW_CLEAR), 1);
});

test('Collapse requires explicit potion-on-wall use', (t) => {
  const p = playerAt(t, 2390, 9501, 0);
  p.getInventory().add(new core.Item(core.ItemIdentifiers.EXPLOSIVE_POTION));
  const object = MapObjects.get(core.ObjectIdentifiers.CAVE_WALL, new core.Location(2390, 9500, 0), null);
  assert.ok(object, 'the cache wall is present');
  swaps.length = 0;
  collapse({ player: p, object });
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.EXPLOSIVE_POTION), 1);
  assert.equal(swaps.length, 0);
  assert.match(p.messages.at(-1), /Use an explosive potion/);
  t.mock.method(core.MapObjects, 'get', () => null);
  blastWall({ player: p, object, itemSlot: p.getInventory().getSlotForItemId(core.ItemIdentifiers.EXPLOSIVE_POTION) });
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.EXPLOSIVE_POTION), 0);
  assert.equal(swaps[0][1].getId(), core.ObjectIdentifiers.ROCKS_21);
});
