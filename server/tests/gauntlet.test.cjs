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

// ------------------------------------------------------------------ runs

const { TaskManager } = require('../dist/game/task/TaskManager');
const Run = require('../plugins/minigames/gauntlet/GauntletRun');
const Lobby = require('../plugins/minigames/gauntlet/Lobby.Gauntlet');
const RunHooks = require('../plugins/minigames/gauntlet/Run.Gauntlet');
const { ItemIdentifiers: I } = require('../dist/util/ItemIdentifiers');

const hooks = { objects: {}, items: {}, death: [], drops: [], teleports: [], login: [], variants: [], prompts: [] };
function bindHooks() {
  const api = {
    core: PluginManager.getCoreApi(),
    persistAttribute() {},
    onObjectInteraction: (name, actions) => { hooks.objects[name] = { ...(hooks.objects[name] ?? {}), ...actions }; },
    onItemAction: (name, actions) => { hooks.items[name] = actions; },
    onShouldDropItemsOnDeath: (handler) => hooks.drops.push(handler),
    onPlayerDeath: (handler) => hooks.death.push(handler),
    onCanTeleport: (handler) => hooks.teleports.push(handler),
    onPlayerLogin: (handler) => hooks.login.push(handler),
    onNpcDialogueVariant: (handler) => hooks.variants.push(handler),
    sendMultiChatboxPrompt: (player, title, ...args) => hooks.prompts.push({ player, title, args }),
    emitCustomEvent() {},
  };
  Lobby(api);
  RunHooks(api);
}

/** A container that holds item ids by slot. */
function container(size) {
  const slots = new Array(size).fill(null);
  const self = {
    slots,
    getValidItems: () => slots.filter(Boolean).map((id) => ({ getId: () => id })),
    resetItems() { slots.fill(null); return self; },
    refreshItems() { return self; },
    adds(id) { slots[slots.indexOf(null)] = id; return self; },
    setItem(slot, item) { slots[slot] = item?.getId?.() ?? null; return self; },
    contains: (id) => slots.includes(id),
    deleteAtSlot(slot) { slots[slot] = null; return self; },
  };
  return self;
}

function fakePlayer(name = 'Tester') {
  const varbits = new Map();
  const attributes = new Map();
  const p = {
    messages: [], statements: [], scripts: [], interfaces: [], area: null, location: new Location(3032, 6127, 1),
    inventory: container(28), equipment: container(14), resets: 0,
    getUsername: () => name,
    getIndex: () => 1,
    isPlayer: () => true,
    isNpc: () => false,
    getAsPlayer: () => p,
    getLocation: () => p.location,
    moveTo(location) { p.location = location; },
    getArea: () => p.area,
    setArea(area) { p.area = area; },
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getInventory: () => p.inventory,
    getEquipment: () => p.equipment,
    getCurrentPet: () => null,
    resetAttributes() { p.resets++; },
    sendMessage: (message) => p.messages.push(message),
    getCombat: () => ({ reset() {} }),
    getMovementQueue: () => ({ reset() {} }),
    getDialogueManager: () => ({ startDialogues: (chain) => p.statements.push(chain) }),
    getPacketSender() {
      const sender = {
        sendVarbit: (id, value) => { varbits.set(id, value); return sender; },
        getVarbit: (id) => varbits.get(id) ?? 0,
        sendConfig: (id, value) => { varbits.set(`varp${id}`, value); return sender; },
        sendSubInterface: (uid, id) => { p.interfaces.push(id); return sender; },
        closeSubInterface: (uid) => { p.interfaces.push(-uid); return sender; },
        sendClientScript: (id, ...args) => { p.scripts.push([id, ...args]); return sender; },
      };
      return sender;
    },
    varbits,
  };
  return p;
}

function ticks(count) {
  for (let i = 0; i < count; i++) TaskManager.process();
}

function objectAt(map, room, id) {
  for (let x = 0; x < 16; x++) {
    for (let y = 0; y < 16; y++) {
      const object = map.getTemplateObjects(map.roomTile(room, x, y)).find((o) => o.getId() === id);
      if (object) return object;
    }
  }
  return null;
}

function interact(name, option, player, object) {
  return hooks.objects[name][option]({ player, object, objectId: object?.getId?.(), definition: object?.getDefinition?.() });
}

test('the entrance turns players away until they have spoken to Bryn, and with items on them', () => {
  bindHooks();
  const player = fakePlayer('Entrant');
  interact('The Gauntlet', 'Enter', player, null);
  assert.equal(Run.runOf(player), null, "Bryn hasn't been spoken to");
  assert.equal(hooks.variants[0]({ player, npcId: 9020 }), 'first-time-talking-to-him');
  assert.equal(hooks.variants[0]({ player, npcId: 9020 }), null, 'only the first time');
  player.inventory.adds(995);
  interact('The Gauntlet', 'Enter', player, null);
  assert.equal(Run.runOf(player), null, 'nothing may be taken in');
  player.inventory.resetItems();
  interact('The Gauntlet', 'Enter-corrupted', player, null);
  assert.equal(Run.runOf(player), null, 'Corrupted needs a completion first');
  interact('The Gauntlet', 'Enter', player, null);
  const run = Run.runOf(player);
  assert.ok(run);
  run.end('exit', { fade: false });
});

test('a run starts with the Wiki kit and the timer, and lighting a node opens the next room', () => {
  bindHooks();
  const player = fakePlayer('Runner');
  const run = Run.startRun(player, { random: seeded(11) });
  try {
    ticks(3);
    assert.equal(player.getArea(), run.map);
    assert.equal(run.map.roomAt(player.getLocation()), run.map.room(run.map.start.x, run.map.start.y));
    assert.ok(player.equipment.contains(I.CRYSTAL_SCEPTRE), 'the sceptre is wielded');
    for (const id of [I.CRYSTAL_AXE_3, I.CRYSTAL_PICKAXE_3, I.CRYSTAL_HARPOON_3, I.PESTLE_AND_MORTAR_3, I.TELEPORT_CRYSTAL]) {
      assert.ok(player.inventory.contains(id), `starts with ${id}`);
    }
    assert.ok(player.interfaces.includes(637), 'the timer overlay');
    assert.deepEqual(player.scripts.find(([id]) => id === 2914), [2914, 1000], '10 minutes');
    assert.equal(player.varbits.get(9178), 1, 'the maze map');

    const start = run.map.room(run.map.start.x, run.map.start.y);
    const away = GauntletMap.SIDES.find((side) => !run.map.room(start.gridX + side.dx, start.gridY + side.dy)?.special
      && run.map.room(start.gridX + side.dx, start.gridY + side.dy));
    const node = [36101, 36102].map((id) => {
      for (let i = 0; i < 16; i++) {
        const x = away.dx > 0 ? 14 : away.dx < 0 ? 0 : i;
        const y = away.dy > 0 ? 14 : away.dy < 0 ? 0 : i;
        const found = run.map.getTemplateObjects(run.map.roomTile(start, x, y)).find((o) => o.getId() === id);
        if (found) return found;
      }
      return null;
    }).find(Boolean);
    assert.ok(node, `a node on the ${away.name} side`);
    interact('Node', 'Light', player, node);
    const next = run.map.room(start.gridX + away.dx, start.gridY + away.dy);
    assert.ok(next.lit, 'the room past the node is lit');
    assert.equal(player.varbits.get(9240 + next.gridY * 7 + next.gridX), 1);
  } finally {
    run.end('exit', { fade: false });
  }
});

test('running out of time takes you to the Hunllef; the barrier then offers Escape, which ends the run', () => {
  bindHooks();
  const player = fakePlayer('Slowpoke');
  const run = Run.startRun(player, { corrupted: true, random: seeded(2) });
  ticks(3);
  assert.equal(run.prepLeft, 750 - 1, 'Corrupted: 7 minutes 30');
  run.prepLeft = 2;
  ticks(2);
  assert.equal(run.stage, 'boss');
  assert.ok(run.inArena(player.getLocation()), 'dragged into the boss room');
  assert.equal(player.varbits.get(9177), 1, 'the barrier turns to Escape');
  const barrier = objectAt(run.map, run.map.room(3, 3), 37337);
  assert.ok(barrier, 'the corrupted barrier');
  interact('Barrier', 'Escape', player, barrier);
  ticks(3);
  assert.equal(Run.runOf(player), null);
  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY(), player.getLocation().getZ()], [3032, 6127, 1]);
  assert.equal(player.inventory.getValidItems().length + player.equipment.getValidItems().length, 0, 'nothing leaves');
  assert.equal(player.varbits.get(9177), 0);
  assert.ok(run.map.isDestroyed(), 'the maze is gone');
});

test('dying, teleporting and logging out are handled by the run', () => {
  bindHooks();
  const player = fakePlayer('Unlucky');
  const run = Run.startRun(player, { random: seeded(4) });
  ticks(3);
  const teleport = { player, allow: null };
  hooks.teleports[0](teleport);
  assert.equal(teleport.allow, false, 'teleports are blocked inside');
  const drop = { player, shouldDrop: null };
  hooks.drops[0](drop);
  assert.equal(drop.shouldDrop, false);
  const death = { player, handled: false };
  hooks.death[0](death);
  assert.ok(death.handled);
  assert.equal(Run.runOf(player), null);
  assert.equal(player.getLocation().getX(), 3032);
  assert.ok(player.messages.includes('Oh dear, you are dead!'));
  assert.equal(Run.statsOf(player).deaths.regular, 1);

  const second = Run.startRun(player, { random: seeded(5) });
  ticks(3);
  second.map.leave(player, true);
  assert.equal(Run.runOf(player), null, 'logging out ends the run');
  assert.equal(player.getLocation().getX(), 3032, 'saved in the lobby');
  assert.equal(player.inventory.getValidItems().length, 0);
});

test('passing the barrier from its corridor starts the fight and lands on the arena floor', () => {
  bindHooks();
  const player = fakePlayer('Eager');
  const run = Run.startRun(player, { random: seeded(8) });
  try {
    ticks(3);
    const boss = run.map.room(3, 3);
    // The west barrier (37339 at 1,7, two tiles tall): its corridor tile is (0, 7).
    const barrier = run.map.getTemplateObjects(run.map.roomTile(boss, 1, 7)).find((o) => o.getId() === 37339);
    assert.ok(barrier);
    player.moveTo(run.map.roomTile(boss, 0, 7));
    assert.equal(run.inArena(player.getLocation()), false);
    interact('Barrier', 'Quick-pass', player, barrier);
    assert.equal(run.stage, 'boss');
    assert.ok(run.inArena(player.getLocation()), 'two tiles in, on the floor');
    assert.equal(RegionManager.getClipping(player.getLocation().getX(), player.getLocation().getY(), 1, run.map) & 0x1280100, 0);
  } finally {
    run.end('exit', { fade: false });
  }
});
