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
// Saves are recorded, not written.
const saves = [];
PluginManager.getCoreApi().GameConstants.PLAYER_PERSISTENCE = { save: (player) => saves.push(player.getUsername()) };

/** A plugin NPC: enough of one for the maze to hold it. */
function fakeNpc(id, x, y, z) {
  const npc = {
    id, location: new Location(x, y, z), area: null, removed: false,
    getId: () => id,
    getLocation: () => npc.location,
    setArea(area) { npc.area = area; },
    getArea: () => npc.area,
    isRegistered: () => !npc.removed,
    isPlayer: () => false,
    isNpc: () => true,
  };
  return npc;
}

const spawnedNpcs = [];

/** One fake plugin API for every unit, as the server gives them all the same one. */
function fakeApi() {
  return {
    core: PluginManager.getCoreApi(),
    persistAttribute() {},
    onObjectInteraction: (name, actions) => { hooks.objects[name] = { ...(hooks.objects[name] ?? {}), ...actions }; },
    onItemAction: (name, actions) => { hooks.items[name] = { ...(hooks.items[name] ?? {}), ...actions }; },
    onItemOnObject: (item, object, handler) => { hooks.itemOnObject = { ...(hooks.itemOnObject ?? {}), [`${item}|${object}`]: handler }; },
    onItemOnItem: (a, b, handler) => { hooks.itemOnItem = { ...(hooks.itemOnItem ?? {}), [`${a}|${b}`]: handler }; },
    onShouldDropItemsOnDeath: (handler) => hooks.drops.push(handler),
    onPlayerDeath: (handler) => hooks.death.push(handler),
    onCanTeleport: (handler) => hooks.teleports.push(handler),
    onCanAttack: (handler) => { hooks.canAttack = handler; },
    onCustomEvent: (name, handler) => { hooks.custom = { ...(hooks.custom ?? {}), [name]: handler }; },
    onPlayerLogin: (handler) => hooks.login.push(handler),
    onNpcDialogueVariant: (handler) => hooks.variants.push(handler),
    sendMultiChatboxPrompt: (player, title, ...args) => hooks.prompts.push({ player, title, args }),
    getBonusManager: () => ({ update() {} }),
    spawnNpc: ({ id, x, y, z }) => { const npc = fakeNpc(id, x, y, z); spawnedNpcs.push(npc); return npc; },
    removeNpc: (npc) => { npc.removed = true; },
    emitCustomEvent() {},
  };
}

function bindHooks() {
  const api = fakeApi();
  Lobby(api);
  RunHooks(api);
  return api;
}

// Shards and dust stack; everything else takes a slot each.
const STACKABLE = new Set([23866, 23867, 23824, 23830, 23904, 23858]);

/** A container of { id, amount } slots. */
function container(size) {
  const slots = new Array(size).fill(null);
  const self = {
    slots,
    getItems: () => slots.map((slot) => ({ getId: () => slot?.id ?? -1, getAmount: () => slot?.amount ?? 0 })),
    getValidItems: () => slots.filter(Boolean).map((slot) => ({ getId: () => slot.id })),
    resetItems() { slots.fill(null); return self; },
    refreshItems() { return self; },
    adds(id, amount = 1) {
      const stack = STACKABLE.has(id) && slots.find((slot) => slot?.id === id);
      if (stack) stack.amount += amount;
      else if (STACKABLE.has(id)) slots[slots.indexOf(null)] = { id, amount };
      else for (let i = 0; i < amount; i++) slots[slots.indexOf(null)] = { id, amount: 1 };
      return self;
    },
    setItem(slot, item) {
      const id = item?.getId?.() ?? -1;
      slots[slot] = id > 0 ? { id, amount: 1 } : null;
      return self;
    },
    contains: (id) => slots.some((slot) => slot?.id === id),
    getAmount: (id) => slots.reduce((sum, slot) => sum + (slot?.id === id ? slot.amount : 0), 0),
    getFreeSlots: () => slots.filter((slot) => !slot).length,
    delete(id, amount = 1) {
      for (let i = 0; i < slots.length && amount > 0; i++) {
        if (slots[i]?.id !== id) continue;
        const taken = Math.min(amount, slots[i].amount);
        slots[i].amount -= taken;
        amount -= taken;
        if (slots[i].amount <= 0) slots[i] = null;
      }
      return self;
    },
    deleteAtSlot(slot, amount = 1) {
      if (!slots[slot]) return self;
      slots[slot].amount -= amount;
      if (slots[slot].amount <= 0) slots[slot] = null;
      return self;
    },
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
    xp: {},
    animations: [],
    getSkillManager: () => ({
      addExperiences(skill, amount) { p.xp[skill.getName?.() ?? String(skill)] = (p.xp[skill.getName?.() ?? String(skill)] ?? 0) + amount; },
      getCurrentLevel: () => 99,
    }),
    performAnimation(animation) { p.animations.push(animation.getId?.() ?? animation.id); },
    getUpdateFlag: () => ({ flag() {} }),
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
        sendCreationMenu: (menu) => { p.menu = menu; return sender; },
        sendInterface: (id) => { p.interfaces.push(id); return sender; },
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
  assert.ok(saves.includes('Entrant'), 'saved before entering');
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

// ------------------------------------------------------------------ preparing

const Items = require('../plugins/minigames/gauntlet/GauntletItems');
const Resources = require('../plugins/minigames/gauntlet/GauntletResources');
const Prep = require('../plugins/minigames/gauntlet/Prep.Gauntlet');

function bindPrep() {
  Prep(bindHooks());
}

function startedRun(name, options = {}) {
  const player = fakePlayer(name);
  const run = Run.startRun(player, options);
  ticks(3);
  return { player, run };
}

test('lit rooms are stocked by the walls, clear of the doorways, and their nodes on both sides light up', () => {
  bindPrep();
  let stocked = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const { player, run } = startedRun(`Stocker${seed}`, { random: seeded(seed) });
    try {
      run.map.lightAll();
      for (const room of run.map.rooms.flat()) {
        if (room.special) continue;
        run.lightRoom(room.gridX, room.gridY); // already lit by lightAll: no second stocking
        const placed = Resources.stockRoom(run.map, room, seeded(seed * 100 + room.gridX * 7 + room.gridY));
        if (room.demiBoss) assert.equal(placed.length, 0, 'a demi-boss room holds only its demi-boss');
        for (const { key, object } of placed) {
          stocked++;
          const origin = run.map.roomTile(room, 0, 0);
          const x = object.getLocation().getX() - origin.getX();
          const y = object.getLocation().getY() - origin.getY();
          assert.ok(x >= 2 && y >= 2 && x + Resources.RESOURCES[key].size - 1 <= 13 && y + Resources.RESOURCES[key].size - 1 <= 13,
            `${key} on the inner floor (${x}, ${y})`);
          const clip = RegionManager.getClipping(object.getLocation().getX(), object.getLocation().getY(), 1, run.map);
          assert.notEqual(clip & 0x100, 0, `${key} blocks its tile`);
        }
      }
      // The passage between the start and boss rooms is lit on the start room's side.
      const start = run.map.room(run.map.start.x, run.map.start.y);
      const litNodes = run.map.getObjects().filter((o) => [36103, 36104].includes(o.getId())
        && run.map.roomAt(o.getLocation()) === start);
      assert.ok(litNodes.length >= 1, 'lit nodes beside the boss room');
    } finally {
      run.end('exit', { fade: false });
    }
  }
  assert.ok(stocked > 50, `rooms hold resources (${stocked})`);
});

test('gathering a deposit gives 3 ore, one every 2 ticks, then leaves it depleted', () => {
  bindPrep();
  const { player, run } = startedRun('Miner', { random: seeded(21) });
  try {
    const room = run.map.room(run.map.start.x, run.map.start.y);
    const deposit = new (PluginManager.getCoreApi().GameObject)(36064, run.map.roomTile(room, 5, 9), 10, 0, run.map);
    PluginManager.getCoreApi().ObjectManager.register(deposit, true);
    player.inventory.delete(I.CRYSTAL_PICKAXE_3, 1);
    interact('Crystal Deposit', 'Mine', player, deposit);
    assert.equal(player.inventory.getAmount(23877), 0, 'no pickaxe, no ore');
    player.inventory.adds(I.CRYSTAL_PICKAXE_3);
    interact('Crystal Deposit', 'Mine', player, deposit);
    ticks(1);
    assert.equal(player.inventory.getAmount(23877), 0);
    ticks(1);
    assert.equal(player.inventory.getAmount(23877), 1, 'the first after 2 ticks');
    ticks(10);
    assert.equal(player.inventory.getAmount(23877), 3, 'three from a deposit');
    const depleted = run.map.getObjects().find((o) => o.getLocation().equals(deposit.getLocation()));
    assert.equal(depleted?.getId(), 36065, 'the depleted deposit');
    assert.equal(player.xp.Mining ?? player.xp.MINING ?? Object.values(player.xp)[0], 3);
  } finally {
    run.end('exit', { fade: false });
  }
});

test('the singing bowl follows the Wiki costs and upgrades worn gear in place', () => {
  bindPrep();
  const { player, run } = startedRun('Singer', { random: seeded(31) });
  try {
    const items = Items.itemsFor('regular');
    // A basic set: 3 of each resource and 150 shards.
    player.inventory.adds(items.shards, 150);
    for (const id of [items.ore, items.bark, items.linum]) player.inventory.adds(id, 3);
    const bowl = run.map.getTemplateObjects(run.map.roomTile(run.map.room(run.map.start.x, run.map.start.y), 3, 12))[0];
    interact('Singing Bowl', 'Sing-crystal', player, bowl);
    const recipes = Items.bowlRecipes('regular', (id) => player.inventory.contains(id));
    for (const piece of ['helm', 'body', 'legs']) {
      assert.ok(recipes.some((recipe) => recipe.id === items[piece][0]), `${piece} (basic) offered`);
      player.menu.execute(items[piece][0], 1);
    }
    assert.equal(player.inventory.getAmount(items.shards), 0, 'a basic set is 150 shards');
    assert.equal(player.inventory.getAmount(items.ore), 0, 'and 3 ore');
    // Worn and upgraded where it is worn.
    const helmSlot = 0;
    player.inventory.delete(items.helm[0], 1);
    player.equipment.setItem(helmSlot, { getId: () => items.helm[0] });
    player.inventory.adds(items.shards, 50);
    for (const id of [items.ore, items.bark, items.linum]) player.inventory.adds(id, 1);
    interact('Singing Bowl', 'Sing-crystal', player, bowl);
    player.menu.execute(items.helm[1], 1);
    assert.equal(player.equipment.slots[helmSlot]?.id, items.helm[1], 'the worn helm is attuned in place');
    // Weapons: a frame, then 50 shards, then the component.
    player.inventory.adds(items.frame);
    interact('Singing Bowl', 'Sing-crystal', player, bowl);
    player.menu.execute(items.bow[0], 1);
    assert.ok(player.inventory.contains(items.bow[0]));
    assert.ok(!player.inventory.contains(items.frame));
    // Vials repeat for the amount chosen, 10 shards each.
    player.inventory.adds(items.shards, 25);
    interact('Singing Bowl', 'Sing-crystal', player, bowl);
    player.menu.execute(items.vial, 5);
    assert.equal(player.inventory.getAmount(items.vial), 2);
    assert.equal(player.inventory.getAmount(items.shards), 5);
  } finally {
    run.end('exit', { fade: false });
  }
});

test('an Egniol potion: water-filled vial, grym leaf, 10 shards ground to dust', () => {
  bindPrep();
  const { player, run } = startedRun('Brewer', { random: seeded(41) });
  try {
    const items = Items.itemsFor('regular');
    player.inventory.adds(items.waterVial);
    player.inventory.adds(items.grymLeaf);
    player.inventory.adds(items.shards, 12);
    const use = (a, b, ids) => hooks.itemOnItem[`${a}|${b}`]({ player, usedItemId: ids[0], usedWithItemId: ids[1] });
    use('Grym leaf', 'Water-filled vial', [items.grymLeaf, items.waterVial]);
    assert.ok(player.inventory.contains(items.grymPotion));
    use('Pestle and mortar', 'Crystal shards', [items.pestle, items.shards]);
    assert.equal(player.inventory.getAmount(items.dust), 10);
    assert.equal(player.inventory.getAmount(items.shards), 2);
    use('Crystal dust', 'Grym potion (unf)', [items.dust, items.grymPotion]);
    assert.ok(player.inventory.contains(items.egniol3), 'an Egniol potion (3)');
    assert.equal(player.inventory.getAmount(items.dust), 0);
  } finally {
    run.end('exit', { fade: false });
  }
});

test('the teleport crystal works only away from the start room and before the fight', () => {
  bindPrep();
  const { player, run } = startedRun('Teleporter', { random: seeded(51) });
  try {
    const slot = player.inventory.slots.findIndex((slot) => slot?.id === I.TELEPORT_CRYSTAL);
    const use = () => hooks.items['Teleport crystal'].Activate({ player, itemId: I.TELEPORT_CRYSTAL, slot });
    use();
    assert.ok(player.inventory.contains(I.TELEPORT_CRYSTAL), 'not used in the start room');
    const elsewhere = run.map.room(run.map.start.x === 3 ? 4 : 3, run.map.start.x === 3 ? 3 : 4);
    run.map.lightRoom(elsewhere.gridX, elsewhere.gridY);
    player.moveTo(run.map.roomTile(elsewhere, 7, 7));
    use();
    assert.ok(!player.inventory.contains(I.TELEPORT_CRYSTAL), 'used up');
    assert.ok(run.inStartRoom(player.getLocation()), 'back at the start');
  } finally {
    run.end('exit', { fade: false });
  }
});

// ------------------------------------------------------------------ monsters

const Monsters = require('../plugins/minigames/gauntlet/GauntletMonsters');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const { NpcDefinition } = require('../dist/game/definition/NpcDefinition');

test('every Gauntlet monster has its own animations, and the casters their projectiles', () => {
  new NpcDefinitionLoader().load();
  for (const monster of Object.values(Monsters.MONSTERS)) {
    for (const id of Object.values(monster.ids)) {
      const definition = NpcDefinition.forId(id);
      assert.notEqual(definition.getAttackAnim(), 422, `${id} attacks like a player`);
      assert.notEqual(definition.getDeathAnim(), 836, `${id} dies like a player`);
    }
  }
  assert.equal(NpcDefinition.forId(9033).getProjectileId(), 1701, 'the dragon breathes its own projectile');
  assert.equal(NpcDefinition.forId(9048).getProjectileId(), 1606, 'the corrupted dark beast fires its own');
});

test('lit rooms hold monsters or their demi-boss, and the maze takes them with it', () => {
  const api = bindHooks();
  Shared.bind(api);
  const { player, run } = startedRun('Hunter', { random: seeded(61) });
  let weak = 0;
  let strong = 0;
  for (const room of run.map.rooms.flat()) {
    if (room.special) continue;
    run.lightRoom(room.gridX, room.gridY);
    const npcs = run.map.getEntities?.() ?? run.map.entities.filter((entity) => entity.isNpc?.());
    const here = npcs.filter((npc) => run.map.roomAt(npc.getLocation()) === room);
    if (room.demiBoss) {
      assert.equal(here.length, 1, 'a demi-boss alone');
      assert.equal(here[0].getId(), Monsters.MONSTERS[room.demiBoss].ids.regular);
      continue;
    }
    for (const npc of here) {
      const tier = Monsters.byId.get(npc.getId()).tier;
      if (tier === 'weak') weak++;
      else strong++;
      const x = npc.getLocation().getX() - run.map.roomTile(room, 0, 0).getX();
      assert.ok(x >= 3 && x <= 12, 'on the inner floor');
    }
  }
  assert.ok(weak > 0 && strong > 0, `weak ${weak}, strong ${strong}`);
  const spawned = run.map.entities.filter((entity) => entity.isNpc?.());
  run.end('exit', { fade: false });
  ticks(1);
  assert.ok(spawned.every((npc) => npc.removed), 'the monsters go with the maze');
});

test('drops follow the Wiki: a frame from the first weak kill, demi-bosses their missing component', () => {
  bindHooks();
  const { player, run } = startedRun('Looter', { random: seeded(71) });
  try {
    const items = Items.itemsFor('regular');
    const has = (drops, id) => drops.some((drop) => drop.itemId === id);
    const first = Monsters.rollDrops(run, player, 9026, seeded(1));
    assert.ok(has(first, items.frame), 'the first weak kill drops a frame');
    const shards = first.find((drop) => drop.itemId === items.shards).amount;
    assert.ok(shards >= 20 && shards <= 30);

    // The bear drops its spike first, then a missing component, never one owned or dropped.
    assert.ok(has(Monsters.rollDrops(run, player, 9032), items.spike));
    const second = Monsters.rollDrops(run, player, 9032);
    assert.ok(!has(second, items.spike) && (has(second, items.orb) || has(second, items.bowstring)));
    assert.ok(has(second, items.frame), 'demi-bosses always drop a frame');
    Monsters.rollDrops(run, player, 9032);
    assert.ok(!COMPONENTS().some((id) => has(Monsters.rollDrops(run, player, 9033), id)), 'all three dropped: none more');

    // The second strong kill brings a frame if the first did not.
    run.strongFrame = false;
    run.kills.strong = 1;
    assert.ok(has(Monsters.rollDrops(run, player, 9031, () => 0.99), items.frame));

    // The general table is replaced for the run's monsters.
    const drops = [{ itemId: 995, amount: 1 }];
    hooks.custom['npc-drops:roll']({ player, npc: { __gauntletRun: run }, npcId: 9029, drops });
    assert.ok(!has(drops, 995) && has(drops, items.shards));
  } finally {
    run.end('exit', { fade: false });
  }

  function COMPONENTS() {
    const items = Items.itemsFor('regular');
    return [items.spike, items.orb, items.bowstring];
  }
});

test('nothing attacks into the start room', () => {
  bindHooks();
  const { player, run } = startedRun('Safe', { random: seeded(81) });
  try {
    const event = { attacker: { __gauntletRun: run }, target: player, allow: null };
    hooks.canAttack(event);
    assert.equal(event.allow, false);
    player.moveTo(run.map.roomTile(run.map.room(3, 3), 7, 7));
    const outside = { attacker: { __gauntletRun: run }, target: player, allow: null };
    hooks.canAttack(outside);
    assert.equal(outside.allow, null);
  } finally {
    run.end('exit', { fade: false });
  }
});
