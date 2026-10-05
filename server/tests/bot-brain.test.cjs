// Run after `yarn build`: node --test tests/bot-brain.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { BotBrain } = require('../plugins/bots/brain/BotBrain');
const {
  buildPvpSeekIndex,
  nearby,
  activeTargetCount,
  hotspotFightCount,
  trackEngagement,
} = require('../plugins/bots/brain/pvp/PvpSeekIndex');

const fakePlayer = (name = 'bot', x = 3100, y = 3600) => ({
  getUsername: () => name,
  getForceMovement: () => null,
  getMovementQueue: () => ({ size: () => 0 }),
  getLocation: () => ({ getX: () => x, getY: () => y, getZ: () => 0 }),
});

/** Registry stub that counts capacity slots and records cooldown blocks. */
function fakeRegistry(next = []) {
  const slots = new Map();
  const blocked = [];
  return {
    slots,
    blocked,
    occupy: (a) => slots.set(a.id, (slots.get(a.id) ?? 0) + 1),
    release: (a) => slots.set(a.id, (slots.get(a.id) ?? 0) - 1),
    blockActivity: (_, id) => blocked.push(id),
    pickActivity: () => next.shift() ?? null,
    resolversFor: (req) => req.resolvers ?? [],
  };
}

const action = (id, results) => ({ id, update: () => results.shift() ?? 'running' });
const tickN = (brain, n) => { for (let i = 0; i < n; i++) brain.tick(i); };

test('unmet setup pushes a resolver; the parent resumes once it succeeds', () => {
  let hasAxe = false;
  const resolver = {
    id: 'withdraw_axe', resolver: true,
    actions: [{ id: 'bank', update: () => { hasAxe = true; return 'success'; } }],
  };
  const chop = action('chop', []);
  const activity = {
    id: 'woodcutting', mode: 'woodcutting', repeat: true,
    setup: [{ id: 'axe', check: () => hasAxe, resolvers: [resolver] }],
    actions: [chop],
  };
  const registry = fakeRegistry();
  const state = { mode: 'roaming' };
  const brain = new BotBrain({ player: fakePlayer(), state, registry, activity });
  brain.tick(0);
  assert.equal(brain.frames.at(-1).behaviour.id, 'withdraw_axe');
  tickN(brain, 4);
  assert.equal(brain.frames.length, 1);
  assert.equal(brain.frames[0].action().id, 'chop');
  assert.equal(state.mode, 'woodcutting');
  assert.equal(registry.slots.get('woodcutting'), 1, 'resolvers take no capacity slot');
});

test('a failed activity is blocked, releases its slot and the brain picks the next one', () => {
  const roam = { id: 'roam', mode: 'roaming', actions: [action('wander', [])] };
  const registry = fakeRegistry([roam]);
  const activity = { id: 'mining', mode: 'mining', actions: [action('mine', ['failed'])] };
  const brain = new BotBrain({ player: fakePlayer(), state: {}, registry, activity });
  tickN(brain, 3);
  assert.deepEqual(registry.blocked, ['mining']);
  assert.equal(registry.slots.get('mining'), 0);
  assert.equal(brain.frames[0].behaviour.id, 'roam');
});

test('an ended action takes its pending walk with it', () => {
  const { requestMovement, peekMovementRequest } = require('../plugins/bots/behaviours/navigation/BotNavigation');
  // A busy queue keeps the brain from dispatching the walk for real.
  const player = { ...fakePlayer('walker'), getMovementQueue: () => ({ size: () => 1 }) };
  let pendingAtMine = 'unset';
  const bank = { id: 'bank', update: () => { requestMovement(player, 3268, 3169, { reason: 'brain_bank_approach' }); return 'success'; } };
  const mine = { id: 'mine', update: () => { pendingAtMine = peekMovementRequest(player); return 'running'; } };
  const brain = new BotBrain({ player, state: {}, registry: fakeRegistry(), activity: { id: 'mining', repeat: true, actions: [bank, mine] } });
  tickN(brain, 3);
  assert.equal(pendingAtMine, null, 'a booth walk that never completes must not hold up the next action');
});

test('an ended action closes the interface it left open (bank screen after a deposit)', () => {
  let interfaceId = 12;
  let closed = 0;
  const player = {
    ...fakePlayer('banker'), getInterfaceId: () => interfaceId,
    getPacketSender: () => ({ sendInterfaceRemoval: () => { closed += 1; interfaceId = -1; } }),
  };
  const bank = { id: 'bank', update: () => 'success' };
  const train = { id: 'train', update: () => 'running' };
  const brain = new BotBrain({ player, state: {}, registry: fakeRegistry(), activity: { id: 'a', repeat: true, actions: [bank, train] } });
  tickN(brain, 2);
  assert.equal(closed, 1);
  assert.equal(interfaceId, -1, 'the next action starts with no interface open (not busy)');
});

for (const outcome of ['success', 'failed']) {
  test(`an overlay hands state.mode back to its parent on ${outcome}`, () => {
    const state = {};
    const registry = fakeRegistry();
    const parent = { id: 'roam', mode: 'roaming', repeat: true, actions: [action('wander', [])] };
    const brain = new BotBrain({ player: fakePlayer(), state, registry, activity: parent });
    brain.tick(0);
    brain.pushActivity({ id: 'pvp_engage', mode: 'pvp', actions: [action('fight', [outcome])] }, 1);
    assert.equal(state.mode, 'pvp');
    tickN(brain, 3);
    assert.equal(state.mode, 'roaming');
    assert.equal(brain.frames.length, 1);
    assert.equal(registry.slots.get('pvp_engage'), 0);
  });
}

test('an exhausted ephemeral brain calls onExhausted instead of picking work', () => {
  let exhausted = 0;
  const registry = fakeRegistry([{ id: 'roam', actions: [action('wander', [])] }]);
  const brain = new BotBrain({
    player: fakePlayer(), state: {}, registry, ephemeral: true,
    onExhausted: () => exhausted++,
    activity: { id: 'bank_trip', actions: [action('bank', ['success'])] },
  });
  tickN(brain, 3);
  assert.equal(exhausted, 1);
  assert.equal(brain.frames.length, 0);
});

test('reset releases every frame slot, not just the top one', () => {
  const registry = fakeRegistry();
  const brain = new BotBrain({
    player: fakePlayer(), state: {}, registry,
    activity: { id: 'roam', actions: [action('wander', [])] },
  });
  brain.pushActivity({ id: 'pvp_engage', actions: [action('fight', [])] }, 0);
  brain.reset();
  assert.equal(registry.slots.get('roam'), 0);
  assert.equal(registry.slots.get('pvp_engage'), 0);
});

test('pvp seek index buckets nearby bots and tracks target caps within a tick', () => {
  const a = fakePlayer('a', 3100, 3600);
  const b = fakePlayer('b', 3105, 3600);
  const far = fakePlayer('far', 3300, 3900);
  const entries = [
    { player: a, state: { mode: 'pvp', pvp: {} } },
    { player: b, state: { mode: 'pvp', pvp: { targetUsername: 'victim', hotspotId: 'edge', phase: 'combat' } } },
    { player: far, state: { mode: 'pvp', pvp: {} } },
  ];
  const index = buildPvpSeekIndex({
    entries,
    world: { getPlayers: () => [] },
    pvpMode: 'pvp',
    isInCombat: () => true,
  });
  const near = nearby(index.botBuckets, a, 16).map((entry) => entry.player.getUsername());
  assert.deepEqual(near.sort(), ['a', 'b']);
  assert.equal(index.entryByPlayer.get(a), entries[0]);
  assert.equal(activeTargetCount(index, 'victim'), 1);
  assert.equal(activeTargetCount(index, 'victim', 'b'), 0, 'a bot does not count against itself');
  trackEngagement(index, a, { pvp: { hotspotId: 'edge' } }, 'victim');
  assert.equal(activeTargetCount(index, 'victim'), 2);
  assert.equal(hotspotFightCount(index, 'edge'), 1);
});

test('with nothing in live range a gatherer walks to the nearest indexed object, else searches home', () => {
  const { createInteractObjectAction } = require('../plugins/bots/brain/actions/InteractObject');
  const { peekMovementRequest: peek, clearMovementRequest: clear } =
    require('../plugins/bots/behaviours/navigation/BotNavigation');
  const { Location: Loc } = require('../dist/game/model/Location');
  // Swamp copper sits 70 tiles from the Lumbridge spawn: outside the live 3x3 search.
  // The nearer indexed rock has no route (the planner says so), the next one does.
  const indexed = [{ id: 7, x: 3200, y: 3150 }, { id: 7, x: 3229, y: 3148 }];
  const asked = [];
  const world = {
    objectSearch: {
      findCandidatesByIds: () => [],
      findNearestIndexedLocation: (_, ids, { accept }) => {
        asked.push(ids);
        const hit = indexed.find((entry) => accept(entry.id, entry.x, entry.y, 0));
        return hit ? { x: hit.x, y: hit.y, z: 0 } : null;
      },
    },
    routes: { canReachSpot: (_player, spot) => spot.x !== 3200 },
  };
  const run = () => {
    const a = createInteractObjectAction({ catalog: 'rock', tier: 'copper', option: 'Mine' }, world);
    const player = {
      ...fakePlayer('miner'), getLocation: () => new Loc(3222, 3218, 0), getPrivateArea: () => null,
      getInventory: () => ({ isFull: () => false }), getUpdateFlag: () => ({ flag() {} }),
    };
    assert.equal(a.update({ player, state: { home: { x: 3222, y: 3218 } }, nowMs: 0, frame: { lastProgressAt: 0 } }), 'wait');
    const request = peek(player);
    clear(player);
    return request;
  };
  const toMine = run();
  assert.ok(Math.abs(toMine.x - 3229) <= 10 && Math.abs(toMine.y - 3148) <= 10,
    `walks to the nearest reachable indexed rock, got ${toMine.x},${toMine.y}`);
  indexed.length = 0;
  const home = run();
  assert.ok(Math.abs(home.x - 3222) <= 10 && Math.abs(home.y - 3218) <= 10, 'nothing indexed: searches around home');
  assert.ok(asked.length >= 2 && asked[0].length > 0, 'asks the index with the catalog ids');
});

test('re-mining a respawned rock from the same tile is not mistaken for an unreachable rock', () => {
  const { createInteractObjectAction, CLAIMS } = require('../plugins/bots/brain/actions/InteractObject');
  const { Location: Loc } = require('../dist/game/model/Location');
  const rock = { getId: () => 11161, getLocation: () => new Loc(3230, 3145, 0) };
  CLAIMS.clear();
  let clicks = 0;
  const world = {
    objectSearch: { findCandidatesByIds: () => [rock] },
    emitObjectInteraction: () => { clicks += 1; },
  };
  const a = createInteractObjectAction({ catalog: 'rock', tier: 'copper', option: 'Mine' }, world);
  const player = {
    ...fakePlayer('miner'), getLocation: () => new Loc(3230, 3146, 0),
    // The instance branch of MapObjects.get resolves the rock without loading map files.
    getPrivateArea: () => ({ getObjects: () => [rock] }),
    getInventory: () => ({ isFull: () => false }),
    getMovementQueue: () => ({ size: () => 0, walkToObject: (_, { execute }) => execute() }),
  };
  const frame = { lastProgressAt: 0 };
  const tick = (nowMs) => a.update({ player, state: {}, nowMs, frame });
  for (let nowMs = 2000; nowMs <= 10000; nowMs += 2000) {
    tick(nowMs);
    frame.lastProgressAt = nowMs + 500; // mining:success - an ore landed, the rock respawned
  }
  assert.equal(clicks, 5);
  assert.match(a.describe({ player, nowMs: 10000 }), /target=11161@3230,3145/, 'a productive rock is kept');
  for (let nowMs = 12000; nowMs <= 26000; nowMs += 2000) tick(nowMs); // >= 10 s of clicks doing nothing
  assert.match(a.describe({ player, nowMs: 26000 }), /target=none/, 'clicks that do nothing: this bot moves on');
  CLAIMS.clear();
  const other = { ...player, getUsername: () => 'other' };
  a.update({ player: other, state: {}, nowMs: 27000, frame: { lastProgressAt: 0 } });
  assert.match(a.describe({ player: other, nowMs: 27000 }), /target=11161@3230,3145/, 'other bots still use the rock');
});

test('an object behind a fence is walked at with brain movement, not clicked blindly', () => {
  const { createInteractObjectAction } = require('../plugins/bots/brain/actions/InteractObject');
  const { peekMovementRequest: peek, clearMovementRequest: clear } =
    require('../plugins/bots/behaviours/navigation/BotNavigation');
  const { Location: Loc } = require('../dist/game/model/Location');
  const rock = { getId: () => 11361, getLocation: () => new Loc(3172, 3366, 0), getType: () => 10, getFace: () => 0 };
  let clicks = 0;
  const world = {
    core: { RsmodRouteFinding: class { findRoute() { return { success: false }; } } },
    objectSearch: { findCandidatesByIds: () => [rock] },
    emitObjectInteraction: () => { clicks += 1; },
  };
  const a = createInteractObjectAction({ catalog: 'rock', tier: 'tin', option: 'Mine' }, world);
  const player = {
    ...fakePlayer('miner'), getLocation: () => new Loc(3161, 3347, 0),
    getPrivateArea: () => ({ getObjects: () => [rock] }),
    getInventory: () => ({ isFull: () => false }), getUpdateFlag: () => ({ flag() {} }),
    getMovementQueue: () => ({ size: () => 0, walkToObject: (_, { execute }) => execute() }),
  };
  const frame = { lastProgressAt: 0 };
  a.update({ player, state: {}, nowMs: 2000, frame });
  assert.equal(clicks, 0, 'no click that cannot arrive');
  assert.deepEqual([peek(player)?.x, peek(player)?.y, peek(player)?.reason], [3172, 3366, 'brain_target_approach']);
  for (let nowMs = 4000; nowMs <= 16000; nowMs += 2000) a.update({ player, state: {}, nowMs, frame });
  assert.match(a.describe({ player, nowMs: 16000 }), /target=none/, 'this bot gives the rock up');
  clear(player);
});

test('a far spot the route planner cannot reach (an island) is never picked', () => {
  const { createInteractObjectAction } = require('../plugins/bots/brain/actions/InteractObject');
  const { clearMovementRequest: clear } = require('../plugins/bots/behaviours/navigation/BotNavigation');
  const { Location: Loc } = require('../dist/game/model/Location');
  const spots = [{ x: 3100, y: 3100, z: 0 }, { x: 3150, y: 3230, z: 0 }]; // Tutorial Island, then the mainland
  const world = {
    objectSearch: {
      findCandidatesByIds: () => [],
      findNearestIndexedLocation: (_player, _ids, { accept }) => spots.find((spot) => accept(1276, spot.x, spot.y, 0)) ?? null,
    },
    routes: { canReachSpot: (_player, spot) => spot.x !== 3100 },
  };
  const a = createInteractObjectAction({ catalog: 'tree', tier: 'normal', option: 'Chop down' }, world);
  const player = {
    ...fakePlayer('chopper'), getLocation: () => new Loc(3155, 3147, 0), getPrivateArea: () => null,
    getInventory: () => ({ isFull: () => false }), getUpdateFlag: () => ({ flag() {} }),
    getMovementQueue: () => ({ size: () => 0 }),
  };
  a.update({ player, state: {}, nowMs: 1000, frame: { lastProgressAt: 1000 } });
  assert.match(a.describe({ player, nowMs: 1000 }), /far=3150,3230/, 'the island is skipped for the next reachable spot');
  clear(player);
});

test('gatherers claim their rock; a crowd moves on to the next spot instead of queueing', () => {
  const { createInteractObjectAction, CLAIMS } = require('../plugins/bots/brain/actions/InteractObject');
  const { peekMovementRequest: peek, clearMovementRequest: clear } =
    require('../plugins/bots/behaviours/navigation/BotNavigation');
  const { Location: Loc } = require('../dist/game/model/Location');
  CLAIMS.clear();
  const rock = { getId: () => 11161, getLocation: () => new Loc(3230, 3145, 0) };
  const asked = [];
  const world = {
    objectSearch: {
      findCandidatesByIds: () => [rock],
      // Another copper mine 150 tiles away, plus the crowded rock itself.
      findNearestIndexedLocation: (player, _ids, { accept }) => {
        const hit = [[3230, 3145], [3300, 3290]].find(([x, y]) => accept(11161, x, y, 0));
        asked.push(hit);
        return hit ? { x: hit[0], y: hit[1], z: 0 } : null;
      },
    },
    emitObjectInteraction: () => {},
  };
  const miner = (name) => ({
    ...fakePlayer(name), getLocation: () => new Loc(3230, 3146, 0), isRegistered: () => true,
    getPrivateArea: () => ({ getObjects: () => [rock] }),
    getInventory: () => ({ isFull: () => false }), getUpdateFlag: () => ({ flag() {} }),
    getMovementQueue: () => ({ size: () => 0, walkToObject: (_, { execute }) => execute() }),
  });
  const a = createInteractObjectAction({ catalog: 'rock', tier: 'copper', option: 'Mine' }, world);
  const first = miner('first');
  const second = miner('second');
  const { requestMovement } = require('../plugins/bots/behaviours/navigation/BotNavigation');
  requestMovement(first, 3308, 3015, { reason: 'brain_search_walk' }); // leftover far search walk
  a.update({ player: first, state: {}, nowMs: 1000, frame: { lastProgressAt: 0 } });
  assert.equal(CLAIMS.get('11161:3230:3145:0')?.player, first, 'the first miner claims the rock');
  assert.equal(peek(first), null, 'the leftover search walk is dropped, so it cannot drag the miner away');
  assert.equal(a.update({ player: second, state: {}, nowMs: 1000, frame: { lastProgressAt: 0 } }), 'wait');
  assert.equal(asked.length, 0, 'a short crowd is waited out: the rock respawns in seconds');
  assert.equal(peek(second), null);
  CLAIMS.get('11161:3230:3145:0').until = 90000; // the first miner is still on it a minute later
  a.update({ player: second, state: {}, nowMs: 62000, frame: { lastProgressAt: 0 } });
  assert.deepEqual(asked.at(-1), [3300, 3290], 'a lasting crowd: the second looks past the crowded spot');
  assert.deepEqual([peek(second)?.x >= 3290, peek(second)?.y >= 3280], [true, true], 'and heads for the next mine');
  clear(first); clear(second); CLAIMS.clear();
});

test('a far walk that stalls makes only that bot try another spot', () => {
  const { createInteractObjectAction } = require('../plugins/bots/brain/actions/InteractObject');
  const { clearMovementRequest: clear } = require('../plugins/bots/behaviours/navigation/BotNavigation');
  const { Location: Loc } = require('../dist/game/model/Location');
  const spots = [{ x: 3285, y: 3361, z: 0 }, { x: 3300, y: 3290, z: 0 }];
  const world = {
    objectSearch: {
      findCandidatesByIds: () => [],
      findNearestIndexedLocation: (_player, _ids, { accept }) => spots.find((spot) => accept(11161, spot.x, spot.y, 0)) ?? null,
    },
    routes: { canReachSpot: () => true },
  };
  const a = createInteractObjectAction({ catalog: 'rock', tier: 'copper', option: 'Mine' }, world);
  const bot = (name, x, y) => ({
    ...fakePlayer(name), getLocation: () => new Loc(x, y, 0), getPrivateArea: () => null,
    getInventory: () => ({ isFull: () => false }), getUpdateFlag: () => ({ flag() {} }),
    getMovementQueue: () => ({ size: () => 0 }),
  });
  const stuck = bot('stuck', 3230, 3146);
  const far = (player) => a.describe({ player, nowMs: 0 }).match(/far=(\S+)/)[1];
  const tick = (player, nowMs) => { a.update({ player, state: {}, nowMs, frame: { lastProgressAt: nowMs - 1000 } }); clear(player); };
  tick(stuck, 1000);
  assert.equal(far(stuck), '3285,3361');
  tick(stuck, 40000);
  assert.equal(far(stuck), '3285,3361', 'not yet: 60 s without getting closer');
  tick(stuck, 62000);
  assert.equal(far(stuck), '3300,3290', 'no closer for a minute: this bot tries another spot');
  const other = bot('other', 3240, 3300);
  tick(other, 63000);
  assert.equal(far(other), '3285,3361', 'other bots still go there: ores never run out');
});

test('choose re-rolls a weighted option each time and runs its actions in order', () => {
  const { createChooseAction } = require('../plugins/bots/brain/actions/Choose');
  const ran = [];
  const step = (name) => ({ id: name, update: () => { ran.push(name); return 'success'; } });
  const a = createChooseAction({
    options: [
      { weight: 3, actions: ['drop'] },
      { weight: 1, actions: ['smelt', 'sell'] },
    ],
  }, step);
  const realRandom = Math.random;
  const ctx = { player: fakePlayer('bot') };
  try {
    Math.random = () => 0.1; // 0.4 of 4 -> first option
    assert.equal(a.update(ctx), 'success');
    Math.random = () => 0.9; // 3.6 of 4 -> second option, two steps
    assert.equal(a.update(ctx), 'running');
    assert.equal(a.update(ctx), 'success');
  } finally {
    Math.random = realRandom;
  }
  assert.deepEqual(ran, ['drop', 'smelt', 'sell']);
});

test('sellItems walks to the nearest general store keeper and sells through the shop', () => {
  const { createSellItemsAction } = require('../plugins/bots/brain/actions/SellItems');
  const { peekMovementRequest: peek, clearMovementRequest: clear } =
    require('../plugins/bots/behaviours/navigation/BotNavigation');
  const { Location: Loc } = require('../dist/game/model/Location');
  const keeper = {
    ...fakeNpc('Shop keeper', 3212, 3246),
    getDefinition: () => ({ getId: () => 2813, getName: () => 'Shop keeper' }),
  };
  const sold = [];
  let opened = null;
  let stand = new Loc(3230, 3146, 0);
  const inventory = new Map([[436, 3], [438, 2], [333, 16]]);
  const world = {
    core: {
      World: { getNpcs: () => [keeper], getNearbyNpcsForUpdate: () => [keeper] },
      ShopManager: {
        INVENTORY_INTERFACE_ID: 3823,
        open: (_p, shopId) => { opened = shopId; return true; },
        close: () => {},
        handleItemContainerAction: (_p, act) => { sold.push([act.itemId, act.amount]); inventory.delete(act.itemId); },
      },
    },
  };
  const player = {
    ...fakePlayer('miner'), getLocation: () => stand, getPrivateArea: () => null,
    getMovementQueue: () => ({ size: () => 0 }),
    getInventory: () => ({
      getAmount: (id) => inventory.get(id) ?? 0,
      getItems: () => [...inventory.keys()].map((id) => ({ getId: () => id })),
    }),
  };
  const a = createSellItemsAction({ itemIds: [436, 438] }, world, new Map([[2813, 1222]]));
  assert.equal(a.update({ player, nowMs: 1000 }), 'running');
  assert.deepEqual([peek(player).x, peek(player).y], [3212, 3246], 'walks to the store found in the NPC index');
  clear(player);
  stand = new Loc(3213, 3247, 0);
  assert.equal(a.update({ player, nowMs: 60000 }), 'success');
  assert.equal(opened, 1222, 'opens the keeper\'s general store');
  assert.deepEqual(sold, [[436, 3], [438, 2]], 'sells only the listed resources');
  assert.equal(inventory.get(333), 16, 'the rest of the inventory is kept');
});

test('a bank one bot cannot walk to is skipped by that bot only', () => {
  const { createBankAction } = require('../plugins/bots/brain/actions/Bank');
  const { ObjectDefinition } = require('../dist/game/definition/ObjectDefinition');
  const { peekMovementRequest: peek, clearMovementRequest: clear } =
    require('../plugins/bots/behaviours/navigation/BotNavigation');
  const { Location: Loc } = require('../dist/game/model/Location');
  const boothId = 6083; // a bank booth id; no cache in tests, so give it its Bank option
  const realForId = ObjectDefinition.forId;
  ObjectDefinition.forId = (id) => (id === boothId ? { getInteractions: () => ['Bank'] } : realForId.call(ObjectDefinition, id));
  const booth = (x, y) => ({ getId: () => boothId, getLocation: () => new Loc(x, y, 0) });
  const alKharid = booth(3269, 3167);
  const draynor = booth(3092, 3243);
  const world = { objectSearch: { findCandidatesByIds: () => [alKharid, draynor] } };
  const a = createBankAction({}, world);
  const player = {
    ...fakePlayer('miner'), getLocation: () => new Loc(3240, 3180, 0), getPrivateArea: () => null,
    getInventory: () => ({ isFull: () => true }), getUpdateFlag: () => ({ flag() {} }),
    getMovementQueue: () => ({ size: () => 0 }), getCombat: () => ({ getTarget: () => null }),
  };
  a.update({ player, state: {}, nowMs: 1000 });
  assert.equal(peek(player)?.x, 3269, 'heads for the nearest bank first');
  clear(player);
  a.update({ player, state: {}, nowMs: 22000 }); // stood at the toll gate the whole time
  a.update({ player, state: {}, nowMs: 23000 });
  assert.equal(peek(player)?.x, 3092, 'this bot uses the next-nearest bank');
  clear(player);
  const other = { ...player, getUsername: () => 'other' };
  a.update({ player: other, state: {}, nowMs: 24000 });
  assert.equal(peek(other)?.x, 3269, 'other bots still use the nearest one');
  clear(other);
  ObjectDefinition.forId = realForId;
});

test('a bank upstairs: the bot walks back down to its floor before the step ends', () => {
  const { createBankAction } = require('../plugins/bots/brain/actions/Bank');
  const { ObjectDefinition } = require('../dist/game/definition/ObjectDefinition');
  const { peekMovementRequest: peek, clearMovementRequest: clear } =
    require('../plugins/bots/behaviours/navigation/BotNavigation');
  const { Location: Loc } = require('../dist/game/model/Location');
  const boothId = 18491;
  const realForId = ObjectDefinition.forId;
  ObjectDefinition.forId = (id) => (id === boothId ? { getInteractions: () => [null, 'Bank'] } : realForId.call(ObjectDefinition, id));
  const castleBooth = { getId: () => boothId, getLocation: () => new Loc(3208, 3221, 2) };
  const world = { objectSearch: { findCandidatesByIds: (_, __, { z }) => (z === 2 ? [castleBooth] : []) } };
  const a = createBankAction({}, world);
  let at = new Loc(3215, 3218, 0);
  let full = true;
  const player = {
    ...fakePlayer('banker'), getLocation: () => at, getPrivateArea: () => null,
    getInventory: () => ({ isFull: () => full }), getUpdateFlag: () => ({ flag() {} }),
    getMovementQueue: () => ({ size: () => 0 }), getCombat: () => ({ getTarget: () => null }),
  };
  a.update({ player, state: {}, nowMs: 1000 });
  assert.equal(peek(player)?.z, 2, 'walks to the booth on the top floor');
  clear(player);
  at = new Loc(3208, 3220, 2);
  full = false; // deposited
  assert.equal(a.update({ player, state: {}, nowMs: 2000 }), 'running', 'not done while upstairs');
  assert.deepEqual([peek(player)?.x, peek(player)?.y, peek(player)?.z], [3215, 3218, 0], 'heads back down to where it came from');
  clear(player);
  at = new Loc(3206, 3229, 0);
  assert.equal(a.update({ player, state: {}, nowMs: 3000 }), 'success', 'done once back on its floor');
  ObjectDefinition.forId = realForId;
});

test('a firemaker on a tile that refuses fires (a bank floor) moves off it, and gives up if nowhere works', () => {
  const Firemaking = require('../plugins/skills/Firemaking.plugin');
  const { createLightFireAction } = require('../plugins/bots/brain/actions/LightFire');
  const { peekMovementRequest: peek, clearMovementRequest: clear } =
    require('../plugins/bots/behaviours/navigation/BotNavigation');
  const { Location: Loc } = require('../dist/game/model/Location');
  const real = { ...Firemaking };
  // The bank tile the bot stands on refuses fires; the street outside does not.
  let blockedTiles = (loc) => loc.getX() === 3208 && loc.getY() === 3220;
  let started = 0;
  Object.assign(Firemaking, {
    isFiremakingActive: () => false,
    isWoodcuttingLog: () => true,
    canPlayerBurnLog: () => true,
    isFireTileBlocked: (loc) => blockedTiles(loc),
    startBotInventoryFiremaking: () => { started += 1; return true; },
  });
  try {
    const a = createLightFireAction({}, {});
    const player = {
      ...fakePlayer('firemaker', 3208, 3220), getPrivateArea: () => null,
      getInventory: () => ({ getItems: () => [{ getId: () => 1511 }] }),
      getMovementQueue: () => ({ size: () => 0 }),
    };
    assert.equal(a.update({ player }), 'running');
    assert.ok(peek(player), 'walks to a clear tile instead of retrying the refused one');
    assert.equal(started, 0, 'never lights on a refused tile');
    clear(player);
    blockedTiles = () => true; // nowhere clear around
    a.update({ player }); clear(player);
    a.update({ player }); clear(player);
    assert.equal(a.update({ player }), 'failed', 'nowhere clear: the step gives up so the activity moves on');
    blockedTiles = () => false;
    assert.equal(a.update({ player }), 'running');
    assert.equal(started, 1, 'lights on a clear tile');
  } finally {
    Object.assign(Firemaking, real);
  }
});

test('a gatherer commits to its far spot: no turning back halfway, and it waits on arrival', () => {
  const { createInteractObjectAction } = require('../plugins/bots/brain/actions/InteractObject');
  const { peekMovementRequest: peek, clearMovementRequest: clear } =
    require('../plugins/bots/behaviours/navigation/BotNavigation');
  const { Location: Loc } = require('../dist/game/model/Location');
  let at = new Loc(3230, 3150, 0);
  const asked = [];
  const world = {
    objectSearch: {
      findCandidatesByIds: () => [],
      // Nearest spot from wherever the bot stands: the swamp mine behind it, or Varrock ahead.
      findNearestIndexedLocation: (player) => {
        const here = player.getLocation();
        const spot = here.getY() < 3260 ? { x: 3230, y: 3146, z: 0 } : { x: 3285, y: 3361, z: 0 };
        asked.push(spot);
        return spot;
      },
    },
    routes: { canReachSpot: () => true },
  };
  const a = createInteractObjectAction({ catalog: 'rock', tier: 'copper', option: 'Mine' }, world);
  const player = {
    ...fakePlayer('miner'), getLocation: () => at, getPrivateArea: () => null,
    getInventory: () => ({ isFull: () => false }), getUpdateFlag: () => ({ flag() {} }),
    getMovementQueue: () => ({ size: () => 0 }),
  };
  const far = () => a.describe({ player, nowMs: 0 }).match(/far=(\S+)/)[1];
  const frame = { lastProgressAt: 0 };
  at = new Loc(3260, 3300, 0); // heading for Varrock
  a.update({ player, state: {}, nowMs: 1000, frame });
  assert.equal(far(), '3285,3361');
  clear(player);
  at = new Loc(3270, 3330, 0); // halfway, the swamp mine no longer in reach either way
  a.update({ player, state: {}, nowMs: 5000, frame });
  assert.equal(far(), '3285,3361', 'keeps its spot instead of re-picking from here');
  clear(player);
  at = new Loc(3283, 3358, 0); // arrived, rocks all depleted
  a.update({ player, state: {}, nowMs: 9000, frame });
  a.update({ player, state: {}, nowMs: 60000, frame });
  assert.equal(far(), '3285,3361', 'waits on arrival rather than turning back');
  clear(player);
});

test('a long walk toward a far spot counts as progress for the brain', () => {
  const { createInteractObjectAction } = require('../plugins/bots/brain/actions/InteractObject');
  const { clearMovementRequest: clear } = require('../plugins/bots/behaviours/navigation/BotNavigation');
  const { Location: Loc } = require('../dist/game/model/Location');
  let at = new Loc(3150, 3307, 0);
  const world = { objectSearch: { findCandidatesByIds: () => [], findNearestIndexedLocation: () => ({ x: 3285, y: 3361, z: 0 }) } };
  const a = createInteractObjectAction({ catalog: 'rock', tier: 'copper', option: 'Mine' }, world);
  const player = {
    ...fakePlayer('miner'), getLocation: () => at, getPrivateArea: () => null,
    getInventory: () => ({ isFull: () => false }), getUpdateFlag: () => ({ flag() {} }),
    getMovementQueue: () => ({ size: () => 0 }),
  };
  const ctx = (nowMs) => ({ player, state: {}, nowMs, frame: { lastProgressAt: nowMs - 1000 } });
  a.update(ctx(1000));
  assert.equal(a.madeProgress(ctx(1000)), false, 'just picked the spot');
  at = new Loc(3200, 3320, 0);
  clear(player);
  a.update(ctx(30000));
  assert.equal(a.madeProgress(ctx(30000)), true, 'closer: progress');
  assert.equal(a.madeProgress(ctx(30000)), false, 'reported once');
  clear(player);
});

test('a tier list gathers from every listed rock kind', () => {
  const { resolveCatalogObjectIds } = require('../plugins/bots/brain/BotObjectCatalog');
  const copper = resolveCatalogObjectIds({ catalog: 'rock', tier: 'copper' });
  const tin = resolveCatalogObjectIds({ catalog: 'rock', tier: 'tin' });
  const both = resolveCatalogObjectIds({ catalog: 'rock', tier: ['copper', 'tin'] });
  assert.ok(copper.length > 0 && tin.length > 0);
  assert.deepEqual([...both].sort(), [...new Set([...copper, ...tin])].sort());
});

const { createPvpCombatAction } = require('../plugins/bots/brain/actions/PvpCombat');
const { PvpController } = require('../plugins/bots/brain/pvp/PvpController');
const { Location } = require('../dist/game/model/Location');
const { peekMovementRequest, clearMovementRequest } = require('../plugins/bots/behaviours/navigation/BotNavigation');
const { __testing: loadoutTesting } = require('../plugins/bots/behaviours/policies/PvpLoadoutPolicy');
const { getWildernessHotspot } = require('../plugins/bots/behaviours/pvp/WildernessHotspotRegistry');
const { SkillManager } = require('../dist/game/content/skill/SkillManager');

test('unmatched pvp bots walk between seek retries; overlays return to their activity', () => {
  const calls = [];
  const controller = {
    tick: () => calls.push('fight'), ensureLoadout() {},
    seek: () => calls.push('seek'), wanderWhileSeeking: () => calls.push('walk'),
  };
  const ctx = { nowMs: 10, player: { getHitpoints: () => 99 }, state: { pvp: { nextActionAt: 100 } } };
  createPvpCombatAction({}, controller).update(ctx);
  assert.deepEqual(calls, ['walk']);
  calls.length = 0;
  assert.equal(createPvpCombatAction({ exitWhenIdle: true }, controller).update(ctx), 'success');
  assert.deepEqual(calls, []);
  ctx.player.getCombat = () => ({ getTarget: () => ({ getHitpoints: () => 99 }) });
  createPvpCombatAction({}, controller).update(ctx);
  assert.deepEqual(calls, ['fight']);
});

test('idle pvp walking stays inside its hotspot and pauses for movement or combat', () => {
  const player = { ...fakePlayer('wander', 3085, 3528), getLocation: () => new Location(3085, 3528, 0) };
  const state = { autonomy: { allowedAutonomousModes: ['pvp'] }, pvp: { hotspotId: 'edge_ditch' },
    roaming: { nextWalkAt: 0, roamBounds: getWildernessHotspot('edge_ditch').area } };
  const controller = Object.create(PvpController.prototype);
  controller.api = { getRegionManager: () => ({ blocked: () => false, isWater: () => false }) };
  controller.getEntries = () => [];
  controller.wanderWhileSeeking({ player, state, nowMs: 100 });
  const request = peekMovementRequest(player);
  assert.ok(request);
  assert.ok(request.x >= 3078 && request.x <= 3091 && request.y >= 3525 && request.y <= 3535);
  assert.notDeepEqual([request.x, request.y], [3085, 3528]);
  assert.ok(state.roaming.nextWalkAt >= 3600);
  clearMovementRequest(player);
  assert.equal(controller.wanderWhileSeeking({ player, state, nowMs: 101 }), false);
  player.getCombat = () => ({ getAttacker: () => ({}) });
  assert.equal(controller.wanderWhileSeeking({ player, state, nowMs: 20000 }), false);
  assert.equal(peekMovementRequest(player), null);
});

test('Edgeville generated and global presets remain within narrow combat bands', () => {
  for (const hotspotId of ['edge_ditch', 'edge_south']) {
    const hotspot = getWildernessHotspot(hotspotId);
    const band = hotspot.combatLevelRange;
    for (const profileId of hotspot.allowedProfiles) {
      for (const loadoutId of hotspot.allowedLoadouts) {
        for (let i = 0; i < 5; i++) {
          const state = { pvp: { hotspotId, loadoutId, profileId, presetPoolEnabled: true } };
          const generated = loadoutTesting.buildGeneratedPreset(null, state);
          assert.ok(generated, `${hotspotId}/${profileId}/${loadoutId}`);
          const stats = generated.preset.getStats();
          const level = SkillManager.prototype.getCombatLevel.call({ skills: { maxLevel: stats } });
          assert.ok(level >= band.min && level <= band.max, `${generated.archetypeId}: ${level}`);
        }
      }
    }
  }
});

const fs = require('node:fs');
const { createTrainCombatAction } = require('../plugins/bots/brain/actions/TrainCombat');
const { Skill } = require('../dist/game/model/Skill');
const { Equipment } = require('../dist/game/model/container/impl/Equipment');
const { ItemIdentifiers } = require('../dist/util/ItemIdentifiers');
const { FightStyle } = require('../dist/game/content/combat/FightStyle');
const { Flag } = require('../dist/game/model/Flag');
const trainingSpec = JSON.parse(fs.readFileSync('data/definitions/bot-activities.json', 'utf8'))
  .activities.find((a) => a.id === 'combat_training').actions[0];

const chickenSpec = trainingSpec;
const NPC_LEVELS = { Chicken: 1, Duck: 1, Goblin: 2, Cow: 2, Frog: 5, Barbarian: 10, 'Big frog': 10, Guard: 21 };

/** A fake NPC spawned at x,y; indexed by World.getNpcs and found by the live search. */
function fakeNpc(name, x, y, extra = {}) {
  const definition = { isAttackable: () => true, getName: () => name, getCombatLevel: () => NPC_LEVELS[name] ?? 1 };
  return {
    isNpc: () => true, isRegistered: () => true, isDyingFunction: () => false,
    getHitpoints: () => 3, getPrivateArea: () => null,
    getLocation: () => new Location(x, y, 0), getSpawnPosition: () => new Location(x, y, 0),
    getDefinition: () => definition,
    getCurrentDefinition: () => definition,
    getCombat: () => ({ getTarget: () => null, getAttacker: () => null }),
    ...extra,
  };
}

/** A walk that never moves the bot: three brain ticks over 9 s. Returns the last result. */
function freeze(s, a) {
  let result;
  for (let i = 0; i < 3; i += 1) { s.ctx.nowMs += 3000; result = a.update(s.ctx); }
  return result;
}

function trainingScene(level = 1) {
  let target = null, owner = null, hp = 10, npcHp = 3, registered = true;
  let location = new Location(3230, 3298, 0), permission = true;
  const levels = Array(24).fill(level), items = [], inventory = new Map();
  const attacks = [], changes = [], logs = [], xp = [];
  const styles = [FightStyle.ACCURATE, FightStyle.AGGRESSIVE, FightStyle.DEFENSIVE]
    .map((style, index) => ({ getStyle: () => style, getChildId: () => index }));
  class TrainingItem {
    constructor(id, amount = 1) { this.id = id; this.amount = amount; }
    getId() { return this.id; }
    getAmount() { return this.amount; }
    getDefinition() { return { getRequirements: () => [], isDoubleHanded: () => true }; }
  }
  const npc = {
    isNpc: () => true, isRegistered: () => registered, isDyingFunction: () => false,
    getHitpoints: () => npcHp, getPrivateArea: () => null,
    getLocation: () => new Location(3230, 3298, 0), getSpawnPosition: () => new Location(3230, 3298, 0),
    getDefinition: () => ({ isAttackable: () => true, getName: () => 'Chicken', getCombatLevel: () => 1 }),
    getCurrentDefinition: () => ({ isAttackable: () => true, getName: () => 'Chicken', getCombatLevel: () => 1 }),
    getCombat: () => ({ getTarget: () => owner, getAttacker: () => owner }),
  };
  const player = {
    ...fakePlayer('trainee'), getLocation: () => location, getPrivateArea: () => null,
    isRegistered: () => true, getHitpoints: () => hp, isDyingReturn: () => false,
    getCombat: () => ({ getTarget: () => target, getAttacker: () => null,
      attack: (n) => { target = n; attacks.push(n); }, reset: () => { target = null; } }),
    getSkillManager: () => ({ getMaxLevel: (s) => levels[s.getIndex()],
      getCurrentLevel: (s) => levels[s.getIndex()], addExperience: (...args) => xp.push(args) }),
    getEquipment: () => ({ getItems: () => items, set: (slot, item) => { items[slot] = item; }, refreshItems() {} }),
    getInventory: () => ({ getAmount: (id) => inventory.get(id) ?? 0,
      adds: (id, amount) => inventory.set(id, (inventory.get(id) ?? 0) + amount),
      deleteNumber: (id, amount) => inventory.set(id, Math.max(0, (inventory.get(id) ?? 0) - amount)) }),
    getWeapon: () => ({ getFightType: () => styles }), getUpdateFlag: () => ({ flag() {} }),
    setCombatFollowing() {},
  };
  const world = {
    core: { Skill, Equipment, Item: TrainingItem, ItemIdentifiers, Flag, FightStyle,
      World: { getNearbyNpcsForUpdate: () => [npc], getNpcs: () => [npc] },
      WorldDefinition: { isMembersArea: () => false },
      RsmodRouteFinding: class { findRoute({ destX, destY }) { return { success: true, endX: destX, endY: destY }; } },
      CombatSpells: new Proxy({}, { get: () => ({ levelRequired: () => 1, itemsRequired: () => [] }) }),
      Autocasting: { setAutocast() {} },
      CombatFactory: { getMethod: () => ({}), canAttackPermission: () => permission ? 'yes' : 'no' },
      CanAttackResponse: { CAN_ATTACK: 'yes' },
      WeaponInterfaceManager: { assign() {}, changeCombatStyle: (_, slot) => changes.push(slot) },
    },
    refreshEquipment() {}, regionManager: { loadMapFiles() {} }, log: (_, d) => logs.push(d),
  };
  const ctx = { player, state: { combatStyle: 'melee' }, nowMs: 1000 };
  return { player, npc, world, ctx, attacks, changes, items, levels, logs, inventory, xp, TrainingItem,
    kill: () => { npcHp = 0; }, die: () => { hp = 0; }, revive: () => { hp = 10; },
    occupy: () => { owner = {}; }, deny: () => { permission = false; },
    unregister: () => { registered = false; },
    move: (x, y) => { location = new Location(x, y, 0); },
  };
}

test('combat trainers start on chickens, provision tier-one gear and use normal NPC attacks', () => {
  const s = trainingScene(), a = createTrainCombatAction(chickenSpec, s.world);
  a.update(s.ctx);
  const tierOne = trainingSpec.gearTiers.find((tier) => tier.minLevel === 1);
  assert.equal(s.logs[0].stage, 'beginner');
  assert.deepEqual(s.attacks, [s.npc]);
  assert.ok(tierOne.weapons.map((key) => ItemIdentifiers[key])
    .includes(s.items[Equipment.WEAPON_SLOT].getId()), 'weapon comes from the tier pool');
  assert.ok(tierOne.armour.BODY_SLOT.filter(Boolean).map((key) => ItemIdentifiers[key])
    .includes(s.items[Equipment.BODY_SLOT].getId()), 'body comes from the tier pool');
  assert.equal(s.inventory.get(ItemIdentifiers.TROUT), 16);
  assert.equal(s.changes[0], 0);
  s.ctx.nowMs += 600; a.update(s.ctx);
  assert.equal(s.attacks.length, 1, 'do not restart a fight every tick');
  assert.deepEqual(s.xp, [], 'no artificial XP');
  a.stop(s.ctx);
});

test('training balances melee skills and upgrades weapons and armour independently', () => {
  const s = trainingScene(5);
  s.levels[Skill.ATTACK.getIndex()] = 20;
  s.levels[Skill.DEFENCE.getIndex()] = 10;
  const a = createTrainCombatAction(trainingSpec, s.world); a.update(s.ctx);
  const weaponTier = trainingSpec.gearTiers.find((tier) => tier.minLevel === 20);
  const armourTier = trainingSpec.gearTiers.find((tier) => tier.minLevel === 10);
  assert.ok(weaponTier.weapons.map((key) => ItemIdentifiers[key])
    .includes(s.items[Equipment.WEAPON_SLOT].getId()), 'weapon tier follows Attack');
  assert.ok(armourTier.armour.BODY_SLOT.filter(Boolean).map((key) => ItemIdentifiers[key])
    .includes(s.items[Equipment.BODY_SLOT].getId()), 'armour tier follows Defence');
  assert.equal(s.changes[0], 1, 'train lowest skill: Strength');
  assert.equal(s.logs[0].stage, 'beginner', 'high Attack alone does not promote fragile bots');
  a.stop(s.ctx);
});

test('trainers finish fights before level promotion or ending a timed session', () => {
  const s = trainingScene();
  s.world.core.World.getNpcs = () => [s.npc, fakeNpc('Goblin', 3250, 3246)];
  const a = createTrainCombatAction({ ...chickenSpec, durationSeconds: { min: 1, max: 1 } }, s.world);
  a.update(s.ctx); s.levels.fill(10); s.ctx.nowMs = 5000;
  assert.equal(a.update(s.ctx), 'running');
  s.kill(); assert.equal(a.update(s.ctx), 'success'); a.stop(s.ctx);
  s.ctx.nowMs = 6000; a.update(s.ctx);
  assert.equal(s.logs.at(-1).stage, 'novice');
  a.stop(s.ctx);
});

test('higher training tiers select monks/barbarians and guards and walk from home', () => {
  for (const [level, stage] of [[20, 'intermediate'], [40, 'advanced']]) {
    const s = trainingScene(level); s.move(3089, 3524);
    s.world.core.World.getNpcs = () => [s.npc, fakeNpc('Barbarian', 3080, 3420), fakeNpc('Guard', 3211, 3430)];
    const a = createTrainCombatAction(trainingSpec, s.world); a.update(s.ctx);
    assert.equal(s.logs[0].stage, stage);
    assert.equal(s.attacks.length, 0);
    assert.equal(peekMovementRequest(s.player).reason, 'brain_combat_training');
    a.stop(s.ctx);
  }
});

test('NPC training skips occupied, forbidden, dead and unregistered targets', () => {
  for (const setup of ['occupy', 'deny', 'kill', 'unregister']) {
    const s = trainingScene(); s[setup]();
    const a = createTrainCombatAction(chickenSpec, s.world); a.update(s.ctx);
    assert.equal(s.attacks.length, 0, setup); a.stop(s.ctx);
  }
});

test('NPC reservations prevent simultaneous claims, and stop releases them', () => {
  const first = trainingScene(), second = trainingScene();
  second.world.core.World.getNearbyNpcsForUpdate = () => [first.npc];
  const a = createTrainCombatAction(chickenSpec, first.world);
  const b = createTrainCombatAction(chickenSpec, second.world);
  a.update(first.ctx); b.update(second.ctx);
  assert.equal(second.attacks.length, 0);
  a.stop(first.ctx); second.ctx.nowMs += 2000; b.update(second.ctx);
  assert.deepEqual(second.attacks, [first.npc]); b.stop(second.ctx);
});

test('stalled targets are abandoned and death resets the training destination', () => {
  const s = trainingScene(), a = createTrainCombatAction(chickenSpec, s.world); a.update(s.ctx);
  s.ctx.nowMs += 46000; a.update(s.ctx);
  assert.equal(s.player.getCombat().getTarget(), null);
  assert.equal(s.attacks.length, 1);
  s.die(); a.update(s.ctx); s.revive(); s.ctx.nowMs += 2000; a.update(s.ctx);
  assert.equal(s.logs.length, 2); a.stop(s.ctx);
});

test('trainers skip a cluster the route planner cannot reach (jail, desert pass)', () => {
  const s = trainingScene();
  s.world.core.World.getNpcs = () => [fakeNpc('Chicken', 3330, 3298), fakeNpc('Chicken', 3130, 3298)];
  s.world.core.World.getNearbyNpcsForUpdate = () => [];
  s.world.routes = { canReachSpot: (_player, cluster) => cluster.x < 3300 };
  const a = createTrainCombatAction(chickenSpec, s.world);
  a.update(s.ctx);
  assert.equal(s.logs[0].site, `${3130 >> 5},${3298 >> 5},0`, 'the unreachable one is passed over');
  a.stop(s.ctx);
});

test('beginners train on any NPC in their combat-level band, not on named ones', () => {
  const s = trainingScene();
  const frog = fakeNpc('Frog', 3218, 3185);
  const bigFrog = fakeNpc('Big frog', 3219, 3185);
  const duck = fakeNpc('Duck', 3217, 3185);
  s.move(3218, 3190);
  s.world.core.World.getNpcs = () => [duck, bigFrog, frog];
  s.world.core.World.getNearbyNpcsForUpdate = () => [duck, bigFrog, frog];
  const a = createTrainCombatAction(trainingSpec, s.world);
  a.update(s.ctx);
  assert.equal(s.logs[0].site, `${3218 >> 5},${3185 >> 5},0`, 'the swamp frogs are found by level');
  assert.deepEqual(s.attacks, [frog], 'level 5 frog: in band; level 10 big frog: not yet; duck: excluded');
  a.stop(s.ctx);
});

test('a frozen movement request is dropped and the site rotates', () => {
  const realRandom = Math.random;
  Math.random = () => 0;
  try {
    const s = trainingScene();
    s.move(3170, 3240);
    s.world.core.World.getNpcs = () => [s.npc, fakeNpc('Chicken', 3330, 3298)];
    s.world.core.World.getNearbyNpcsForUpdate = () => []; // nothing in view: walk to the cluster
    const a = createTrainCombatAction(trainingSpec, s.world);
    a.update(s.ctx);
    const firstSite = s.logs[0].site;
    assert.equal(firstSite, `${3230 >> 5},${3298 >> 5},0`, 'the nearest chicken cluster');
    assert.ok(peekMovementRequest(s.player), 'walking to the cluster');
    freeze(s, a);
    const visits = s.logs.filter((entry) => entry.stage);
    assert.equal(visits.length, 2, 'site is re-selected after the frozen walk');
    assert.notEqual(visits.at(-1).site, firstSite);
    assert.ok(peekMovementRequest(s.player), 'movement is re-requested');
    a.stop(s.ctx);
  } finally {
    Math.random = realRandom;
  }
});

test('a slow-ticking far bot does not call its fresh walk frozen after one late tick', () => {
  const s = trainingScene();
  s.move(3170, 3240);
  s.world.core.World.getNearbyNpcsForUpdate = () => [];
  const a = createTrainCombatAction(trainingSpec, s.world);
  a.update(s.ctx);
  s.ctx.nowMs += 15000; // LOD + task budget: the next brain tick comes 15 s later
  a.update(s.ctx);
  assert.equal(s.logs.filter((entry) => entry.stage).length, 1, 'keeps its cluster');
  assert.ok(peekMovementRequest(s.player), 'still walking');
  a.stop(s.ctx);
});

test('a trainer at its cluster with nothing to fight waits there instead of blacklisting it', () => {
  const s = trainingScene();
  s.move(3229, 3297);
  s.world.core.World.getNearbyNpcsForUpdate = () => []; // every chicken busy with someone else
  const a = createTrainCombatAction(trainingSpec, s.world);
  for (let i = 0; i < 6; i += 1) { a.update(s.ctx); s.ctx.nowMs += 3000; }
  assert.equal(peekMovementRequest(s.player), null, 'no walk onto the tile it already stands on');
  assert.equal(s.logs.filter((entry) => entry.stage).length, 1, 'stays on its cluster');
  a.stop(s.ctx);
});

test('a centre on water: a stalled walk within the cluster radius trains from where it stopped', () => {
  const s = trainingScene();
  s.move(3218, 3298); // 12 tiles from the centre, can get no closer
  s.world.core.World.getNearbyNpcsForUpdate = () => [];
  const a = createTrainCombatAction(trainingSpec, s.world);
  a.update(s.ctx);
  assert.ok(peekMovementRequest(s.player), 'walks toward the centre');
  freeze(s, a);
  assert.equal(s.logs.filter((entry) => entry.stage).length, 1, 'keeps its cluster');
  s.ctx.nowMs += 2000; a.update(s.ctx);
  assert.equal(peekMovementRequest(s.player), null, 'settled: no more centre walks');
  a.stop(s.ctx);
});

test('a walk frozen on the way to one fenced NPC skips that NPC, not the cluster', () => {
  const s = trainingScene();
  s.move(3230, 3290);
  s.world.core.World.getNpcs = () => [s.npc, fakeNpc('Chicken', 3226, 3310)];
  s.world.core.RsmodRouteFinding = class {
    findRoute({ destX, destY, moveNear }) { return { success: moveNear === true, endX: destX, endY: destY - 1 }; }
  };
  const a = createTrainCombatAction(trainingSpec, s.world);
  a.update(s.ctx);
  assert.ok(peekMovementRequest(s.player), 'walking at the fenced chicken');
  freeze(s, a);
  assert.equal(s.logs.filter((entry) => entry.stage).length, 1, 'and for this bot');
  a.stop(s.ctx);
});

test('maxFailedTargets targets in a row that never take damage fail the training site', () => {
  const realRandom = Math.random;
  Math.random = () => 0;
  try {
    const s = trainingScene();
    const second = { ...s.npc, getLocation: () => new Location(3232, 3298, 0) };
    const third = { ...s.npc, getLocation: () => new Location(3234, 3298, 0) };
    s.world.core.World.getNearbyNpcsForUpdate = () => [s.npc, second, third];
    const a = createTrainCombatAction({ ...chickenSpec, maxFailedTargets: 3 }, s.world);
    a.update(s.ctx);
    assert.equal(s.attacks.length, 1);
    s.move(3231, 3298); s.ctx.nowMs = 47000;
    assert.equal(a.update(s.ctx), 'running');
    s.move(3232, 3298); s.ctx.nowMs = 93000;
    assert.equal(a.update(s.ctx), 'running');
    s.move(3233, 3298); s.ctx.nowMs = 139000;
    assert.equal(a.update(s.ctx), 'failed', 'the site is abandoned after three stalled targets');
    assert.equal(s.attacks.length, 3, 'every stalled target was replaced');
    a.stop(s.ctx);
  } finally {
    Math.random = realRandom;
  }
});

test('repeated frozen movement requests fail the site instead of hopping forever', () => {
  const s = trainingScene();
  s.move(3170, 3240);
  s.world.core.World.getNpcs = () => [s.npc, fakeNpc('Chicken', 3330, 3298), fakeNpc('Chicken', 3400, 3298)];
  const a = createTrainCombatAction({ ...chickenSpec, maxFailedTargets: 3 }, s.world);
  a.update(s.ctx);
  for (let i = 0; i < 2; i += 1) assert.equal(freeze(s, a), 'running');
  assert.equal(freeze(s, a), 'failed', 'three stalls fail the activity');
  assert.ok(s.logs.some((entry) => entry.failures === 3), 'the stall is logged');
  a.stop(s.ctx);
});

test('a held fight that lands no hit walks the target so gates can open', () => {
  const s = trainingScene();
  const a = createTrainCombatAction(chickenSpec, s.world);
  a.update(s.ctx);
  assert.equal(s.player.getCombat().getTarget(), s.npc);
  s.ctx.nowMs += 7000;
  a.update(s.ctx);
  const request = peekMovementRequest(s.player);
  assert.equal(request?.reason, 'brain_combat_training');
  assert.equal(request?.x, 3230);
  assert.equal(request?.y, 3298);
  a.stop(s.ctx);
});

test('a two-handed weapon clears the shield slot', () => {
  const s = trainingScene();
  s.ctx.state.combatStyle = 'ranged';
  s.items[Equipment.SHIELD_SLOT] = new s.TrainingItem(ItemIdentifiers.WOODEN_SHIELD, 1);
  const a = createTrainCombatAction(chickenSpec, s.world);
  a.update(s.ctx);
  assert.equal(s.items[Equipment.SHIELD_SLOT].getId(), -1, 'shield removed for a two-handed bow');
  a.stop(s.ctx);
});

test('a frame with no progress for three minutes fails and logs a stall', () => {
  const logs = [];
  const stalled = { id: 'stalled', update: () => 'running' };
  const activity = { id: 'stall_activity', actions: [stalled], repeat: true };
  const brain = new BotBrain({
    player: fakePlayer(), state: {},
    world: { log: (message, details) => logs.push({ message, details }) },
    registry: fakeRegistry(), activity,
  });
  brain.tick(1000);
  brain.tick(181000);
  brain.tick(181001);
  assert.equal(brain.frames.length, 0, 'the stalled frame was dropped');
  assert.ok(logs.some((entry) => entry.message === 'bot_brain_frame_stalled'));
  assert.ok(brain.registry.blocked.includes('stall_activity'), 'the activity is cooled down');
});

test('a door is opened when it unblocks the current segment of a longer route', () => {
  const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
  const { maybeOpenDoor } = require('../plugins/bots/brain/DoorOpening');
  const gate = {
    getId: () => 7,
    getLocation: () => ({ getX: () => 104, getY: () => 102, getZ: () => 0 }),
    getDefinition: () => ({ name: 'Gate', getInteractions: () => ['Open'] }),
  };
  MapObjects.mapObjects.set(MapObjects.getHash(104, 102, 0), [gate]);
  let open = false;
  const world = {
    core: {
      RegionManager: {
        getClipping: () => 0,
        removeObjectClipping: () => { open = true; },
        addObjectClipping: () => { open = false; },
      },
      RsmodRouteFinding: class {
        findRoute({ destX, destY, locShape, moveNear }) {
          if (locShape === -2 && !moveNear) return { success: open };
          if (destX === 200 && destY === 200) {
            return { success: false, endX: 100, endY: 100 };
          }
          return open
            ? { success: true, endX: 110, endY: 110 }
            : { success: true, endX: 100, endY: 100 };
        }
      },
      PathFinder: { calculateWalkRoute: () => 1 },
    },
    emitObjectInteraction: () => true,
  };
  const player = { ...fakePlayer('bot', 100, 100), getMovementQueue: () => ({ size: () => 0 }) };
  const request = { x: 200, y: 200, z: 0, lastSegmentX: 110, lastSegmentY: 110 };
  assert.equal(maybeOpenDoor({ player, state: {}, world, request, select: true }), true,
    'final target is unroutable, but the segment behind the gate is reachable');
  MapObjects.mapObjects.delete(MapObjects.getHash(104, 102, 0));
});

test('training stages pick opponents by overlapping NPC combat-level bands', () => {
  const stages = [...trainingSpec.stages].sort((a, b) => a.minLevel - b.minLevel);
  assert.equal(stages[0].minLevel, 1);
  for (const [index, stage] of stages.entries()) {
    assert.ok(stage.npcLevels.min >= 1 && stage.npcLevels.max >= stage.npcLevels.min, stage.id);
    const next = stages[index + 1];
    if (next) assert.ok(next.npcLevels.min <= stage.npcLevels.max, `${stage.id} -> ${next.id} leaves no gap`);
  }
  assert.ok(stages.every((stage) => !stage.names && !stage.sites), 'no hard-coded NPC names or areas');
});

test('the NPC cluster index never places a cluster in the Wilderness', () => {
  const { buildNpcClusters, nearestClusters } = require('../plugins/bots/brain/NpcClusterIndex');
  const spawns = JSON.parse(fs.readFileSync('data/definitions/npc-spawns.json', 'utf8'));
  const index = buildNpcClusters(spawns.map((n) => ({ key: n.name, x: n.x, y: n.y, z: n.level })));
  assert.ok(nearestClusters(index, ['Goblin'], { x: 3222, y: 3218, z: 0 })[0].distance < 100);
  assert.equal(nearestClusters(index, ['Goblin'], { x: 3100, y: 3700, z: 0 })
    .some((cluster) => cluster.y >= 3520 && cluster.y <= 3967 && cluster.x >= 2944 && cluster.x <= 3392), false);
});

test('replacing a training brain stops its NPC fight and releases its claim', () => {
  const s = trainingScene();
  const a = createTrainCombatAction(chickenSpec, s.world);
  const activity = { id: 'train', actions: [a], repeat: true };
  const brain = new BotBrain({ player: s.player, state: s.ctx.state, world: s.world,
    registry: fakeRegistry(), activity });
  brain.tick(1000); brain.tick(1600);
  assert.equal(s.player.getCombat().getTarget(), s.npc);
  brain.reset();
  assert.equal(s.player.getCombat().getTarget(), null);
  assert.equal(peekMovementRequest(s.player), null);
});

test('far bots visited round-robin under the task budget still think every stride', () => {
  const { BotBehaviorTask } = require('../plugins/bots/behaviours/task/BotBehaviorTask');
  const task = { _cycleCounter: 0 };
  const state = {};
  const ran = [];
  // The budget lets the round-robin reach this bot only every 8th cycle; LOD stride 12.
  // `(cycle + shard) % 12 === 0` never holds on cycles 3, 11, 19, ... (shard 3): starved.
  for (let cycle = 3; cycle < 400; cycle += 8) {
    task._cycleCounter = cycle;
    if (BotBehaviorTask.prototype.isDue.call(task, state, 12, 3)) ran.push(cycle);
  }
  const gaps = ran.slice(1).map((cycle, index) => cycle - ran[index]);
  assert.ok(ran.length > 20, `ran ${ran.length} times`);
  assert.ok(Math.max(...gaps) <= 16, 'never more than one visit past its stride');
});

test('the long route planner finds detours past walls and through gates, and gives up on islands', () => {
  const { planRoute } = require('../plugins/bots/behaviours/navigation/LongRoutePlanner');
  const WALL_EAST = 0x8, WALL_WEST = 0x80, BLOCK_WALK = 0x200000;
  // A north-south wall at x=100|101 from y=0..399; its only gap is 150 tiles north of the bot.
  const wall = (x, y) => (y < 400 && y !== 350 ? (x === 100 ? WALL_EAST : x === 101 ? WALL_WEST : 0) : 0);
  const detour = planRoute({ from: { x: 90, y: 200, z: 0 }, to: { x: 110, y: 200 }, getFlag: wall });
  assert.ok(detour, 'a way round exists');
  assert.ok(detour.waypoints.some((point) => point.y >= 340), 'the route goes up to the gap, past the 128-tile window');
  // The same wall with a gate at y=200: through the gate, the far side marked as a door.
  const gated = planRoute({ from: { x: 90, y: 200, z: 0 }, to: { x: 110, y: 200 }, getFlag: wall,
    isDoor: (x, y) => (x === 100 || x === 101) && y === 200 });
  assert.ok(gated.tiles < 40, 'straight through the gate');
  assert.deepEqual(gated.waypoints.find((point) => point.door), { x: 101, y: 200, z: 0, door: true });
  // An island ringed by water: no route.
  const island = (x, y) => (Math.max(Math.abs(x - 300), Math.abs(y - 300)) <= 3 ? 0 : Math.max(Math.abs(x - 300), Math.abs(y - 300)) <= 12 ? BLOCK_WALK : 0);
  assert.equal(planRoute({ from: { x: 250, y: 300, z: 0 }, to: { x: 300, y: 300 }, getFlag: island }), null);
});

test('a planned walk never skips the far side of a gate it has not crossed', () => {
  const { nextWaypoint } = require('../plugins/bots/behaviours/navigation/BotLongRoutes');
  const { Location: Loc } = require('../dist/game/model/Location');
  let at = new Loc(3254, 3268, 0);
  const player = { getLocation: () => at, getPrivateArea: () => null };
  const request = {
    x: 3285, y: 3361, z: 0,
    route: { index: 0, waypoints: [
      { x: 3254, y: 3267, z: 0 }, { x: 3253, y: 3267, z: 0, door: true }, { x: 3247, y: 3274, z: 0 },
    ] },
  };
  assert.deepEqual(nextWaypoint(player, request), { x: 3253, y: 3267, z: 0, door: true },
    'a tile away but inside the fence: still walk (and open the gate) to the far side');
  at = new Loc(3253, 3267, 0);
  assert.deepEqual(nextWaypoint(player, request), { x: 3247, y: 3274, z: 0 }, 'crossed: on to the next');
});

test('bots are given tools, never resources: inputs come from gathering or the bank', () => {
  const raw = JSON.parse(fs.readFileSync('data/definitions/bot-activities.json', 'utf8'));
  const TOOLS = new Set(['tinderbox']);
  const conjured = [];
  const walk = (node, where) => {
    if (Array.isArray(node)) return node.forEach((child) => walk(child, where));
    if (!node || typeof node !== 'object') return;
    if (node.type === 'ensureItem') conjured.push(`${where}: ${node.item}`);
    for (const [key, child] of Object.entries(node)) walk(child, `${where}.${key}`);
  };
  walk(raw.templates, 'templates');
  walk(raw.activities, 'activities');
  assert.deepEqual(conjured.filter((entry) => !TOOLS.has(entry.split(': ')[1])), [], 'ensureItem only for tools');
  const smelt = raw.templates.smelt_bar.actions[0];
  assert.equal(smelt.type, 'bank', 'smelting withdraws its ores');
  assert.equal(raw.templates.burn_logs.actions[1].type, 'bank', 'firemaking withdraws its logs');
});

test('combat-training activity compiles against the real plugin core API', () => {
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const { createBotActivityRegistry } = require('../plugins/bots/brain/BotActivityRegistry');
  const registry = createBotActivityRegistry({ world: { core: PluginManager.getCoreApi() } });
  assert.equal(registry.byId.get('combat_training').actions[0].id, 'trainCombat');
});

test('a rotation switches activity after its time, never mid-fight or under an overlay', () => {
  const chop = { id: 'chop', repeat: true, actions: [action('c', [])] };
  const mine = { id: 'mine', repeat: true, actions: [action('m', [])] };
  const picks = [];
  const registry = {
    ...fakeRegistry(),
    pickActivity: (_, __, options) => { picks.push(options); return options.avoid === 'chop' ? mine : chop; },
  };
  let target = null;
  const player = { ...fakePlayer(), getCombat: () => ({ getTarget: () => target, getAttacker: () => null }) };
  const logs = [];
  const brain = new BotBrain({
    player, state: {}, registry, world: { log: (message) => logs.push(message) }, activity: chop, nowMs: 0,
    rotation: { activityIds: ['chop', 'mine'], switchAfterMs: { min: 1000, max: 1000 } },
  });
  brain.tick(500);
  assert.equal(brain.frames[0].behaviour.id, 'chop', 'not due yet');
  target = {};
  brain.tick(1500);
  assert.equal(brain.frames[0].behaviour.id, 'chop', 'waits for the fight to end');
  target = null;
  brain.pushActivity({ id: 'bank_trip', actions: [action('bank', ['success'])] }, 1500);
  brain.tick(1600);
  brain.tick(1650);
  assert.equal(brain.frames[0].behaviour.id, 'chop', 'waits for the overlay to finish');
  brain.tick(1700);
  assert.equal(brain.frames.length, 1);
  assert.equal(brain.frames[0].behaviour.id, 'mine');
  assert.deepEqual(picks.at(-1), { allowed: ['chop', 'mine'], avoid: 'chop' });
  assert.equal(registry.slots.get('chop'), 0, 'the old activity gave its slot back');
  assert.ok(logs.includes('bot_brain_activity_switch'));
});

test('sites compile their rotation and the registry only assigns their activities', () => {
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const { createBotActivityRegistry } = require('../plugins/bots/brain/BotActivityRegistry');
  const registry = createBotActivityRegistry({ world: { core: PluginManager.getCoreApi() } });
  const bySite = new Map(registry.sites.map((site) => [site.id, site]));
  assert.deepEqual(registry.sites.map((site) => [site.id, site.levels]),
    [['lumbridge_novices', 1], ['lumbridge_intermediates', 20], ['lumbridge_advanced', 40], ['lumbridge_experts', 60]]);
  assert.equal(registry.sites.reduce((sum, site) => sum + site.count, 0), 500);
  const raw = JSON.parse(fs.readFileSync('data/definitions/bot-activities.json', 'utf8'));
  for (const site of registry.sites) {
    assert.deepEqual(site.rotation.switchAfterMs, { min: 900000, max: 1500000 }, site.id);
    for (const id of site.rotation.activityIds) {
      const level = raw.activities.find((activity) => activity.id === id)?.fields?.level ?? 1;
      assert.ok(level <= site.levels, `${site.id} can do ${id} (needs ${level})`);
    }
  }
  assert.ok(bySite.get('lumbridge_experts').rotation.activityIds.includes('mithril_rocks'), 'higher tiers gather higher resources');
  const player = fakePlayer();
  assert.equal(registry.pickActivity(player, 0, { allowed: ['combat_training'] })?.id, 'combat_training');
  assert.equal(registry.pickActivity(player, 0, { allowed: ['combat_training'], avoid: 'combat_training' }), null);
});

test('a site\'s levels are applied to every skill of a spawned bot (hitpoints at least 10)', () => {
  const { applyLevels } = require('../plugins/bots/brain/BotSiteSpawner');
  const set = new Map();
  const manager = {
    setCurrentLevel(skill, level) { set.set(skill.getName(), level); return this; },
    setMaxLevels() { return this; },
    setExperience() { return this; },
  };
  const bot = { getSkillManager: () => manager, getUpdateFlag: () => ({ flag() {} }) };
  applyLevels(bot, 1);
  assert.equal(set.get(Skill.ATTACK.getName()), 1);
  assert.equal(set.get(Skill.HITPOINTS.getName()), 10, 'hitpoints never below 10');
  applyLevels(bot, { all: 40, mining: 60 });
  assert.equal(set.get(Skill.ATTACK.getName()), 40);
  assert.equal(set.get(Skill.MINING.getName()), 60, 'per-skill override');
});

test('timed visits rotate between sites without requiring a level-up', () => {
  const s = trainingScene(10);
  s.world.core.World.getNpcs = () => [fakeNpc('Cow', 3253, 3284), fakeNpc('Goblin', 3250, 3246)];
  const a = createTrainCombatAction({ ...trainingSpec, durationSeconds: { min: 1, max: 1 } }, s.world);
  a.update(s.ctx);
  const firstSite = s.logs[0].site;
  s.ctx.nowMs += 1500;
  assert.equal(a.update(s.ctx), 'success');
  a.stop(s.ctx); a.update(s.ctx);
  assert.notEqual(s.logs.at(-1).site, firstSite);
  a.stop(s.ctx);
});

test('trainers spread over NPC clusters by size and distance', () => {
  // Bots stand at 3230,3298. West and east clusters are equally far; the big near one is closest.
  const npcs = [
    fakeNpc('Chicken', 3130, 3298), fakeNpc('Chicken', 3130, 3299),
    fakeNpc('Chicken', 3330, 3298), fakeNpc('Chicken', 3330, 3299),
    ...Array.from({ length: 4 }, (_, i) => fakeNpc('Chicken', 3232 + i, 3298)),
  ];
  const trainers = Array.from({ length: 16 }, () => {
    const s = trainingScene();
    s.world.core.World.getNpcs = () => npcs;
    const a = createTrainCombatAction(chickenSpec, s.world);
    a.update(s.ctx);
    return { s, a };
  });
  const counts = new Map();
  for (const { s } of trainers) counts.set(s.logs[0].site, (counts.get(s.logs[0].site) ?? 0) + 1);
  const at = (x, y) => counts.get(`${x >> 5},${y >> 5},0`) ?? 0;
  assert.equal(counts.size, 3, `every cluster is used: ${JSON.stringify([...counts])}`);
  assert.ok(Math.abs(at(3130, 3298) - at(3330, 3298)) <= 1, 'equal clusters share equally');
  assert.ok(at(3232, 3298) > at(3130, 3298) * 2, 'the bigger, nearer cluster takes the most');
  for (const { s, a } of trainers) a.stop(s.ctx);
});

test('NPC trainers do not cross private areas or attack a non-attackable NPC', () => {
  for (const kind of ['instance', 'noncombat']) {
    const s = trainingScene();
    if (kind === 'instance') s.npc.getPrivateArea = () => ({});
    else s.npc.getCurrentDefinition = () => ({ isAttackable: () => false, getName: () => 'Chicken' });
    const a = createTrainCombatAction(trainingSpec, s.world); a.update(s.ctx);
    assert.equal(s.attacks.length, 0);
    a.stop(s.ctx);
  }
});

test('a path-blocked movement request walks to and opens the door that unblocks the route', () => {
  const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
  const { maybeOpenDoor } = require('../plugins/bots/brain/DoorOpening');
  const gate = (id, x, y, action = 'Open') => ({
    getId: () => id,
    getLocation: () => ({ getX: () => x, getY: () => y, getZ: () => 0 }),
    getDefinition: () => ({ name: 'Gate', getInteractions: () => [action] }),
  });
  const wrongDoor = gate(1, 104, 102);
  const rightDoor = gate(2, 109, 108);
  const behind = gate(3, 95, 95);
  const openGate = gate(4, 106, 104, 'Close');
  const objects = [wrongDoor, rightDoor, behind, openGate];
  for (const object of objects) {
    const loc = object.getLocation();
    MapObjects.mapObjects.set(MapObjects.getHash(loc.getX(), loc.getY(), 0), [object]);
  }
  const openClips = new Set();
  let routeImproves = false;
  const world = {
    core: {
      RegionManager: {
        getClipping: () => 0,
        removeObjectClipping: (object) => { openClips.add(object.getId()); routeImproves = openClips.has(2); },
        addObjectClipping: (object) => { openClips.delete(object.getId()); routeImproves = openClips.has(2); },
      },
      RsmodRouteFinding: class {
        findRoute({ locShape, moveNear }) {
          if (locShape === -2 && !moveNear) return { success: routeImproves };
          if (!moveNear) return { success: true, endX: 0, endY: 0 };
          return routeImproves
            ? { success: true, endX: 110, endY: 110 }
            : { success: true, endX: 100, endY: 100 };
        }
      },
      PathFinder: { calculateWalkRoute: (_player, x, y) => { world.walked.push(`${x},${y}`); return 1; } },
    },
    emitObjectInteraction: (payload) => { world.emitted.push(payload); return true; },
    emitted: [],
    walked: [],
  };
  let location = { getX: () => 100, getY: () => 100, getZ: () => 0 };
  const player = {
    ...fakePlayer('bot', 100, 100),
    getLocation: () => location,
    getMovementQueue: () => ({ size: () => 0 }),
  };
  const state = {};
  assert.equal(maybeOpenDoor({ player, state, world, request: { x: 110, y: 110, z: 0 }, select: true }), true);
  assert.equal(world.walked[0], '108,107', 'routes to the nearest stand tile of the door that helps');
  assert.equal(world.emitted.length, 0, 'does not click before arriving');
  assert.equal(openClips.size, 0, 'simulated clipping is restored');
  location = { getX: () => 108, getY: () => 107, getZ: () => 0 };
  assert.equal(maybeOpenDoor({ player, state, world, request: { x: 110, y: 110, z: 0 } }), true);
  assert.equal(world.emitted[0].objectId, 2, 'clicks Open through the normal interaction hook');
  assert.equal(state.doorAttempt, null);
  for (const object of objects) {
    const loc = object.getLocation();
    MapObjects.mapObjects.delete(MapObjects.getHash(loc.getX(), loc.getY(), 0));
  }
});

test('a gate behind the bot is opened when it unblocks the route', () => {
  // A moveNear walk parks the bot on the fence tile nearest the target, past the
  // pen's gate (Lumbridge cow fields); a "toward the target" filter hid that gate.
  const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
  const { maybeOpenDoor } = require('../plugins/bots/brain/DoorOpening');
  const gate = {
    getId: () => 6,
    getLocation: () => ({ getX: () => 96, getY: () => 97, getZ: () => 0 }),
    getDefinition: () => ({ name: 'Gate', getInteractions: () => ['Open'] }),
  };
  MapObjects.mapObjects.set(MapObjects.getHash(96, 97, 0), [gate]);
  let open = false;
  const walked = [];
  const world = {
    core: {
      RegionManager: {
        getClipping: () => 0,
        removeObjectClipping: () => { open = true; },
        addObjectClipping: () => { open = false; },
      },
      RsmodRouteFinding: class {
        findRoute({ locShape, moveNear }) {
          if (locShape === -2 && !moveNear) return { success: open };
          if (!moveNear) return { success: true, endX: 0, endY: 0, waypoints: [] };
          return open ? { success: true, endX: 110, endY: 110 } : { success: true, endX: 100, endY: 100 };
        }
      },
      PathFinder: { calculateWalkRoute: (_player, x, y) => { walked.push(`${x},${y}`); return 1; } },
    },
    emitObjectInteraction: () => true,
  };
  const player = { ...fakePlayer('bot', 100, 100), getMovementQueue: () => ({ size: () => 0 }) };
  const state = {};
  assert.equal(maybeOpenDoor({ player, state, world, request: { x: 110, y: 110, z: 0 }, select: true }), true);
  assert.equal(state.doorAttempt?.object, gate);
  assert.equal(walked.length, 1, 'walks back to the gate');
  MapObjects.mapObjects.delete(MapObjects.getHash(96, 97, 0));
});

test('a gate is opened even when the walk already ends touching the target across the fence', () => {
  const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
  const { maybeOpenDoor } = require('../plugins/bots/brain/DoorOpening');
  const gate = {
    getId: () => 7,
    getLocation: () => ({ getX: () => 103, getY: () => 101, getZ: () => 0 }),
    getDefinition: () => ({ name: 'Gate', getInteractions: () => ['Open'] }),
  };
  MapObjects.mapObjects.set(MapObjects.getHash(103, 101, 0), [gate]);
  let open = false;
  const world = {
    core: {
      RegionManager: { getClipping: () => 0, removeObjectClipping: () => { open = true; }, addObjectClipping: () => { open = false; } },
      RsmodRouteFinding: class {
        findRoute({ locShape, moveNear }) {
          if (locShape === -2 && !moveNear) return { success: open };
          // moveNear parks the bot on the tile touching the cow: 1 tile, wrong side.
          return moveNear ? { success: true, endX: 100, endY: 101 } : { success: true, endX: 0, endY: 0, waypoints: [] };
        }
      },
      PathFinder: { calculateWalkRoute: () => 1 },
    },
    emitObjectInteraction: () => true,
  };
  const player = { ...fakePlayer('bot', 100, 101), getMovementQueue: () => ({ size: () => 0 }) };
  const state = {};
  assert.equal(maybeOpenDoor({ player, state, world, request: { x: 100, y: 102, z: 0 }, select: true }), true);
  assert.equal(state.doorAttempt?.object, gate, 'the fence gate is opened, not treated as already reached');
  MapObjects.mapObjects.delete(MapObjects.getHash(103, 101, 0));
});

test('a toll gate is passed with its Pay-toll option, the toll provisioned so bots need no money', () => {
  const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
  const { maybeOpenDoor } = require('../plugins/bots/brain/DoorOpening');
  const tollGate = {
    getId: () => 44598,
    getLocation: () => ({ getX: () => 101, getY: () => 100, getZ: () => 0 }),
    getDefinition: () => ({ name: 'Gate', getName: () => 'Gate', getInteractions: () => ['Open', null, null, 'Pay-toll(10gp)', null] }),
  };
  MapObjects.mapObjects.set(MapObjects.getHash(101, 100, 0), [tollGate]);
  let open = false;
  const clicks = [];
  const world = {
    core: {
      RegionManager: { getClipping: () => 0, removeObjectClipping: () => { open = true; }, addObjectClipping: () => { open = false; } },
      RsmodRouteFinding: class {
        findRoute({ locShape, moveNear }) {
          if (locShape === -2 && !moveNear) return { success: open };
          return moveNear ? { success: true, endX: 100, endY: 100 } : { success: true, endX: 0, endY: 0, waypoints: [] };
        }
      },
      PathFinder: { calculateWalkRoute: () => 1 },
    },
    emitObjectInteraction: (event) => { clicks.push(event.clickType); return true; },
  };
  let coins = 0;
  const player = {
    ...fakePlayer('bot', 100, 100), getMovementQueue: () => ({ size: () => 0 }),
    getInventory: () => ({ getAmount: (id) => (id === 995 ? coins : 0), adds: (id, n) => { if (id === 995) coins += n; } }),
  };
  assert.equal(maybeOpenDoor({ player, state: {}, world, request: { x: 110, y: 100, z: 0 }, select: true }), true,
    'a broke bot still treats the toll gate as a way through');
  assert.deepEqual(clicks, [4], 'adjacent: clicks Pay-toll(10gp), not Open (the guard dialogue)');
  assert.equal(coins, 10, 'the toll is provisioned just before paying');
  MapObjects.mapObjects.delete(MapObjects.getHash(101, 100, 0));
});

test('a door that does not improve the route is left closed', () => {
  const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
  const { maybeOpenDoor } = require('../plugins/bots/brain/DoorOpening');
  const useless = {
    getId: () => 5,
    getLocation: () => ({ getX: () => 104, getY: () => 102, getZ: () => 0 }),
    getDefinition: () => ({ name: 'Gate', getInteractions: () => ['Open'] }),
  };
  MapObjects.mapObjects.set(MapObjects.getHash(104, 102, 0), [useless]);
  const walked = [];
  const world = {
    core: {
      RegionManager: { getClipping: () => 0, removeObjectClipping() {}, addObjectClipping() {} },
      RsmodRouteFinding: class {
        findRoute({ locShape, moveNear }) {
          return locShape === -2 && !moveNear ? { success: false } : { success: true, endX: 100, endY: 100 };
        }
      },
      PathFinder: { calculateWalkRoute: () => { walked.push(1); return 1; } },
    },
    emitObjectInteraction: () => true,
  };
  const player = { ...fakePlayer('bot', 100, 100), getMovementQueue: () => ({ size: () => 0 }) };
  assert.equal(maybeOpenDoor({ player, state: {}, world, request: { x: 110, y: 110, z: 0 }, select: true }), false);
  assert.equal(walked.length, 0);
  MapObjects.mapObjects.delete(MapObjects.getHash(104, 102, 0));
});

test('trainers do not attack a target their combat route cannot reach', () => {
  const s = trainingScene();
  s.move(3230, 3290);
  // A second chicken moves the cluster centre off the fenced one's tile.
  s.world.core.World.getNpcs = () => [s.npc, fakeNpc('Chicken', 3226, 3310)];
  // Fenced off: the route ends on a tile touching the chicken, but strict reach fails.
  s.world.core.RsmodRouteFinding = class {
    findRoute({ destX, destY, moveNear }) { return { success: moveNear === true, endX: destX, endY: destY - 1 }; }
  };
  const a = createTrainCombatAction(trainingSpec, s.world);
  a.update(s.ctx);
  assert.equal(s.attacks.length, 0, 'blocked target is not pursued');
  const request = peekMovementRequest(s.player);
  assert.equal(request.reason, 'brain_combat_training');
  assert.deepEqual([request.x, request.y], [3230, 3298], 'walks at the fenced NPC so the gate gets opened');
  a.stop(s.ctx);
});

test('stopping training (switching to skilling) takes back the food and runes it provisioned', () => {
  const s = trainingScene();
  s.ctx.state.combatStyle = 'magic';
  s.inventory.set(ItemIdentifiers.COPPER_ORE, 4); // the bot's own items stay
  const a = createTrainCombatAction(chickenSpec, s.world);
  a.update(s.ctx);
  assert.equal(s.inventory.get(ItemIdentifiers.TROUT), 16, 'provisioned for the fight');
  a.stop(s.ctx);
  assert.equal(s.inventory.get(ItemIdentifiers.TROUT), 0, 'food taken back');
  assert.equal(s.inventory.get(ItemIdentifiers.COPPER_ORE), 4, 'its own items are kept');
});

test('ranged trainers equip a tier bow and a stack of arrows', () => {
  const s = trainingScene();
  s.ctx.state.combatStyle = 'ranged';
  const a = createTrainCombatAction(chickenSpec, s.world);
  a.update(s.ctx);
  const tier = trainingSpec.rangedTiers.find((entry) => entry.minLevel === 1);
  assert.ok(tier.weapons.map((key) => ItemIdentifiers[key])
    .includes(s.items[Equipment.WEAPON_SLOT].getId()), 'bow comes from the ranged tier');
  const ammo = s.items[Equipment.AMMUNITION_SLOT];
  assert.ok(ammo && tier.ammo.map((key) => ItemIdentifiers[key]).includes(ammo.getId()), 'arrows from the tier pool');
  assert.ok(ammo.getAmount() >= 1000, 'arrows are stocked');
  assert.deepEqual(s.attacks, [s.npc], 'ranged bots use the normal attack handoff');
  a.stop(s.ctx);
});

test('magic trainers equip a staff, set autocast and carry runes', () => {
  const s = trainingScene();
  const cast = [];
  s.world.core.Autocasting = { setAutocast: (_player, spell) => cast.push(spell) };
  s.world.core.CombatSpells = new Proxy({}, {
    get: () => ({
      levelRequired: () => 1,
      itemsRequired: () => [{ getId: () => ItemIdentifiers.AIR_RUNE }],
    }),
  });
  s.ctx.state.combatStyle = 'magic';
  const a = createTrainCombatAction(chickenSpec, s.world);
  a.update(s.ctx);
  const tier = trainingSpec.magicTiers.find((entry) => entry.minLevel === 1);
  assert.ok(tier.weapons.map((key) => ItemIdentifiers[key])
    .includes(s.items[Equipment.WEAPON_SLOT].getId()), 'staff comes from the magic tier');
  assert.equal(cast.length, 1, 'autocast set for the picked spell');
  assert.ok(s.inventory.get(ItemIdentifiers.AIR_RUNE) >= 3000, 'runes stocked for the spell');
  assert.deepEqual(s.attacks, [s.npc], 'magic bots attack through the normal engine');
  a.stop(s.ctx);
});
