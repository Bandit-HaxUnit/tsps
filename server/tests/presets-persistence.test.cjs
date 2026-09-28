const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { MagicSpellbook } = require("../dist/game/model/MagicSpellbook");
const { GROUP_ID, GLOBAL_ROW_COUNT, PRESET_ROW_START, uid } = require("../plugins/modes/pvp/presetsWidget");
const presets = require("../plugins/modes/pvp/Presets");

function playerWithAttributes(attributes = new Map()) {
  const strings = [];
  const sender = {
    sendString(value) {
      strings.push(value);
      return sender;
    },
    sendItemOnInterfaces() { return sender; },
    sendInterfaceDisplayState() { return sender; },
    sendEnterInputPrompt() { return sender; },
  };
  let currentPreset = null;
  let syntaxAction = null;
  const player = {
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getInterfaceId: () => GROUP_ID,
    getPacketSender: () => sender,
    sendMessage: (message) => sender.sendMessage(message),
    getCurrentPreset: () => currentPreset,
    setCurrentPreset: (preset) => { currentPreset = preset; },
    setEnteredSyntaxAction: (action) => { syntaxAction = action; },
    getEnteredSyntaxAction: () => syntaxAction,
    getInventory: () => ({ copyValidItemsArray: () => [] }),
    getEquipment: () => ({ copyValidItemsArray: () => [] }),
    getSkillManager: () => ({ getMaxLevel: () => 99 }),
    getSpellbook: () => MagicSpellbook.NORMAL,
    getCombat: () => ({ getAutocastSpell: () => null }),
    isPlayerBot: () => false,
  };
  return { attributes, player, strings };
}

test("custom presets rehydrate from their persisted attribute", () => {
  let onButton;
  let onCanBankItem;
  const persisted = [];
  presets.register({
    getPrayerHandler: () => ({}),
    getCombatFactory: () => ({}),
    getSkillManager: () => ({}),
    persistAttribute: (key) => persisted.push(key),
    registerCustomInterface() {},
    onCanBankItem(handler) { onCanBankItem = handler; },
    onInterfaceActionButton(_buttons, handler) { onButton = handler; },
  });
  assert.deepEqual(persisted, ["pvp:customPresets"]);

  const customSlot = uid(PRESET_ROW_START + GLOBAL_ROW_COUNT);
  const source = playerWithAttributes();
  onButton({ player: source.player, buttonId: customSlot });
  source.player.getEnteredSyntaxAction().execute("saved build");

  const stored = source.attributes.get("pvp:customPresets");
  assert.equal(stored[0].name, "Saved Build");
  assert.equal(typeof stored[0].getName, "undefined");

  const restored = playerWithAttributes(new Map([
    ["pvp:customPresets", JSON.parse(JSON.stringify(stored))],
  ]));
  onButton({ player: restored.player, buttonId: customSlot });
  assert.equal(restored.player.getCurrentPreset().getName(), "Saved Build");
  assert.ok(restored.strings.includes("<col=ffffff>Saved Build</col>"));

  const messages = [];
  const event = {
    player: { sendMessage: (message) => messages.push(message) },
    item: { isUnbankable: () => true },
    allow: true,
  };
  onCanBankItem(event);
  assert.equal(event.allow, false);
  assert.deepEqual(messages, ["Preset items cannot be banked."]);
});

// Construction uses real instance, inventory and social state; only network output is stubbed.
function constructionPlayer(name, index) {
  const { Location } = require('../dist/game/model/Location');
  const { Inventory } = require('../dist/game/model/container/impl/Inventory');
  const { PlayerRelations } = require('../dist/game/model/PlayerRelations');
  let area = null, location = new Location(2954, 3224, 0), input, interfaceId = -1;
  const attributes = new Map(), messages = [], experience = [], vars = new Map(), packets = [];
  const levels = new Map();
  const sender = new Proxy({}, { get: (_, key) => (...args) => {
    packets.push([key, ...args]);
    if (key === 'sendVarbit') vars.set(args[0], args[1]);
    if (key === 'sendInterface') interfaceId = args[0];
    if (key === 'sendInterfaceRemoval') { interfaceId = -1; input = null; }
    return sender;
  } });
  const player = {
    getUsername: () => name, getLongUsername: () => BigInt(index), getIndex: () => index,
    isPlayer: () => true, isNpc: () => false, getAsPlayer: () => player,
    getArea: () => area, getPrivateArea: () => area, setArea: value => { area = value; },
    getLocation: () => location, setLocation: value => { location = value; }, moveTo: value => { location = value; },
    getPacketSender: () => sender, getSession: () => ({ sendClientPacket: () => true }),
    getAttribute: key => attributes.get(key), setAttribute: (key, value) => attributes.set(key, value),
    sendMessage: value => messages.push(value), performAnimation() {},
    getClickDelay: () => ({ elapsedTime: () => true, reset() {} }),
    getSkillManager: () => ({ getCurrentLevel: skill => levels.get(skill) ?? 99, getMaxLevel: skill => levels.get(skill) ?? 99, addExperiences: (skill, xp) => experience.push([skill, xp]) }),
    setEnteredSyntaxAction: action => { input = action; }, getEnteredSyntaxAction: () => input,
    getInterfaceId: () => interfaceId,
    getMessages: () => messages, levels, experience, vars, packets,
  };
  const inventory = new Inventory(player), relations = new PlayerRelations(player);
  player.getInventory = () => inventory;
  player.getRelations = () => relations;
  return player;
}

function constructionHooks() {
  const { ConstructionPlugin } = require('../dist/game/plugin/impl/construction/ConstructionPlugin');
  const { MultiChatboxPrompt } = require('../dist/game/model/menu/MultiChatboxPrompt');
  const hooks = new Map(), named = new Map(), prompts = [], events = new Map();
  const click = n => (ids, handler) => { for (const id of Array.isArray(ids) ? ids : [ids]) hooks.set(`${id}:${n}`, [...(hooks.get(`${id}:${n}`) ?? []), handler]); };
  let generic, process, logout, command, interfaceAction;
  ConstructionPlugin.register(new Proxy({
    onObjectFirstClick: click(1), onObjectSecondClick: click(2), onObjectThirdClick: click(3), onObjectFourthClick: click(4), onObjectFifthClick: click(5),
    onObjectInteraction(name, handler) { if (typeof name === 'function') generic = name; else named.set(name, handler); },
    onPlayerProcess(handler) { process = handler; }, onPlayerLogout(handler) { logout = handler; },
    registerCommand(name, handler) { if (name === 'house') command = handler; },
    onInterfaceActionClick(handler) { interfaceAction = handler; },
    onCustomEvent(name, handler) { events.set(name, handler); },
    sendMultiChatboxPrompt(player, title, ...options) {
      assert.equal(MultiChatboxPrompt.showPrompt('Construction', player, title, options), true, title);
      prompts.push({ player, title, options });
      return true;
    },
  }, { get: (target, key) => target[key] ?? (() => {}) }));
  return { named, prompts, events, interfaceAction, process: player => process({ player }), logout: player => logout({ player }), command: player => command({ player }),
    selectFurniture(player, action) { interfaceAction({ player, groupId: 458, childId: 2, action }); },
    boardAction(player, childId) { interfaceAction({ player, groupId: 52, childId, action: 1 }); },
    click(player, id, type, location = { x: 0, y: 0, z: 0 }, actions = []) {
      const event = { player, objectId: id, clickType: type, location, object: { getType: () => 10 }, definition: { getInteractions: () => actions }, handled: false };
      for (const handler of hooks.get(`${id}:${type}`) ?? []) if (handler(event) === true) return;
      generic(event);
    },
  };
}

test('single-choice chatbox prompts render a working Cancel option', () => {
  const { MultiChatboxPrompt } = require('../dist/game/model/menu/MultiChatboxPrompt');
  const packets = [], selections = [];
  const sender = new Proxy({}, { get: (_, method) => (...args) => { packets.push([method, ...args]); return sender; } });
  const player = { getPacketSender: () => sender };
  const pairs = ['Item', (...args) => selections.push(args)];
  const show = () => MultiChatboxPrompt.showPrompt('Construction', player, 'Withdraw an item', pairs);
  const click = slot => MultiChatboxPrompt.handleInterfaceActionClick({ player, buttonId: (219 << 16) | 1, slot });

  assert.equal(show(), true);
  assert.ok(packets.some(packet => packet[0] === 'sendChatboxInterface' && packet[1] === 219));
  assert.deepEqual(packets.find(packet => packet[0] === 'sendClientScript'), ['sendClientScript', 58, 'Withdraw an item', 'Item|Cancel']);
  assert.deepEqual(packets.find(packet => packet[0] === 'sendInterfaceFlagsRange'), ['sendInterfaceFlagsRange', (219 << 16) | 1, 1, 2, 1]);
  assert.equal(pairs.length, 2, 'the caller options are not mutated');
  assert.equal(click(3), false, 'out-of-range choices are rejected');
  assert.equal(click(2), true);
  assert.deepEqual(selections, [], 'Cancel does not select the item');
  assert.deepEqual(packets.at(-1), ['sendInterfaceRemoval']);
  assert.equal(click(1), false, 'Cancel clears the pending prompt');
  assert.equal(show(), true);
  assert.equal(click(1), true);
  assert.deepEqual(selections, [[player, 0, 'Item']]);
});

test('native house board refreshes facilities and rejects stale or unlisted host submissions', async () => {
  const { CachePipeline } = require('../dist/game/cache/CachePipeline');
  const { World } = require('../dist/game/World');
  await CachePipeline.initialize();
  const owner = constructionPlayer('Board host', 311), other = constructionPlayer('Other host', 312), guest = constructionPlayer('Board visitor', 313);
  const hooks = constructionHooks(), board = hooks.named.get('House Advertisement'), lookup = World.getPlayerByName;
  const rows = () => guest.packets.filter(packet => packet[0] === 'sendClientScript' && packet[1] === 3110);
  World.getPlayerByName = name => [owner, other].find(player => player.getUsername().toLowerCase() === name.toLowerCase());
  try {
    board['Add-House']({ player: owner });
    board['Add-House']({ player: other });
    const room = owner.getPrivateArea().save.rooms[1][4][4];
    room.furniture = { ...room.furniture, ALTAR: 'GILDED_ALTAR', POOL_SPACE: 'ORNATE_REJUVENATION_POOL', SPELLBOOK_ALTAR: 'OCCULT_ALTAR_FROM_ANCIENT', REPAIR_SPACE: 'ARMOUR_STAND', JEWELLERY_BOX: 'FANCY_JEWELLERY_BOX' };
    room.furnitureByLocation = { '3:3:10': { buildableKey: 'GILDED_PORTAL_NEXUS' } };
    board.View({ player: guest });
    assert.deepEqual(rows(), [
      ['sendClientScript', 3110, 0, 1, 'Board host|1|99|Y|2|2|5|O|Y'],
      ['sendClientScript', 3110, 1, 1, 'Other host|1|99|-|-|-|-|-|-'],
      ['sendClientScript', 3110, 200, 1, ''],
    ]);
    const closedSelection = guest.getEnteredSyntaxAction();
    guest.getPacketSender().sendInterfaceRemoval();
    closedSelection.execute('Board host');
    assert.equal(guest.getPrivateArea(), null, 'closed boards cannot enter a house');

    board.View({ player: guest });
    guest.getEnteredSyntaxAction().execute('Unlisted host');
    assert.equal(guest.getPrivateArea(), null, 'names must belong to the displayed list');
    board.View({ player: guest });
    owner.getRelations().setStatus(2, false);
    guest.getEnteredSyntaxAction().execute('Board host');
    assert.equal(guest.getPrivateArea(), null, 'privacy changes apply after the board opens');
    owner.getRelations().setStatus(0, false);

    board.View({ player: guest });
    board.View({ player: owner });
    hooks.boardAction(owner, 23);
    guest.getEnteredSyntaxAction().execute('Board host');
    assert.equal(guest.getPrivateArea(), null, 'removed advertisements cannot be visited');
    board.View({ player: guest });
    guest.packets.length = 0;
    hooks.boardAction(guest, 30);
    assert.equal(rows().length, 2, 'refresh removes the old row and retains the other host');
    assert.equal(rows()[0][4], 'Other host|1|99|-|-|-|-|-|-');
    hooks.boardAction(owner, 23);
    guest.packets.length = 0;
    hooks.boardAction(guest, 30);
    assert.equal(rows().length, 3, 'Add/Remove House can advertise again');
    guest.getEnteredSyntaxAction().execute('bOaRd HoSt');
    assert.equal(guest.getPrivateArea(), owner.getPrivateArea());
  } finally { World.getPlayerByName = lookup; hooks.logout(owner); hooks.logout(other); hooks.logout(guest); }
});

test('construction guests, private settings, locks, advertisements and owner lifecycle', async () => {
  const { CachePipeline } = require('../dist/game/cache/CachePipeline');
  const { World } = require('../dist/game/World');
  const { canVisitHouse } = require('../dist/game/plugin/impl/construction/ConstructionPlugin');
  await CachePipeline.initialize();
  const owner = constructionPlayer('Host', 301), guest = constructionPlayer('Visitor', 302);
  const hooks = constructionHooks(), lookup = World.getPlayerByName;
  World.getPlayerByName = name => name.toLowerCase() === 'host' ? owner : undefined;
  try {
    hooks.click(owner, 15478, 3);
    let house = owner.getPrivateArea();
    assert.equal(canVisitHouse(guest, house), false, 'build mode rejects guests');
    hooks.click(owner, 15478, 2);
    assert.equal(canVisitHouse(guest, house), true);
    owner.getRelations().setStatus(2, false);
    assert.equal(canVisitHouse(guest, house), false);
    owner.getRelations().setStatus(1, false);
    assert.equal(canVisitHouse(guest, house), false);
    owner.getRelations().hasFriend = () => true;
    assert.equal(canVisitHouse(guest, house), true);
    owner.getRelations().hasIgnore = () => true;
    assert.equal(canVisitHouse(guest, house), false);
    owner.getRelations().hasIgnore = () => false;
    owner.getRelations().setStatus(0, false);
    hooks.named.get('House Advertisement')['Add-House']({ player: owner });
    guest.packets.length = 0;
    hooks.named.get('House Advertisement').View({ player: guest });
    assert.equal(guest.getInterfaceId(), 52, 'View opens the native OSRS board');
    assert.equal(guest.vars.get(9449), 1);
    assert.deepEqual(guest.packets.filter(packet => packet[0] === 'sendClientScript'), [
      ['sendClientScript', 3110, 0, 1, 'Host|1|99|-|-|-|-|-|-'],
      ['sendClientScript', 3110, 200, 1, ''],
    ]);
    assert.equal(hooks.prompts.length, 0, 'the board must not use a chatbox menu');
    hooks.click(owner, 4525, 2);
    guest.getEnteredSyntaxAction().execute('Host');
    assert.equal(guest.getPrivateArea(), null, 'an already-open advertisement must recheck the lock');
    hooks.click(owner, 4525, 2);
    guest.packets.length = 0;
    hooks.named.get('House Advertisement').View({ player: guest });
    assert.deepEqual(guest.packets.filter(packet => packet[0] === 'sendClientScript'), [['sendClientScript', 3110, 200, 1, '']], 'empty lists finish loading in the native interface');
    hooks.named.get('House Advertisement')['Add-House']({ player: owner });
    hooks.boardAction(guest, 30);
    guest.getEnteredSyntaxAction().execute('Host');
    assert.equal(guest.getPrivateArea(), house);
    assert.equal(guest.vars.get(2176), 0, 'guests see no build hotspots');
    hooks.click(guest, 4525, 2);
    assert.equal(house.save.locked, false, 'guests cannot lock the host out');
    hooks.click(owner, 4525, 2);
    assert.equal(canVisitHouse(guest, house), false);
    assert.equal(guest.vars.get(2183), 1);
    hooks.click(owner, 15478, 3);
    assert.equal(house.buildingMode, false, 'cannot enable build mode with guests');
    hooks.click(owner, 4525, 1);
    assert.equal(house.isDestroyed(), false, 'owner leaving preserves guests and instance');
    assert.equal(guest.getPrivateArea(), house);
    hooks.logout(owner);
    assert.equal(guest.getPrivateArea(), null, 'logout closes the hosted house safely');
    assert.equal(house.isDestroyed(), true);
    guest.packets.length = 0;
    hooks.named.get('House Advertisement').View({ player: guest });
    assert.deepEqual(guest.packets.filter(packet => packet[0] === 'sendClientScript'), [['sendClientScript', 3110, 200, 1, '']]);
  } finally { World.getPlayerByName = lookup; hooks.logout(owner); hooks.logout(guest); }
});

test('native nexus recipes, paid destinations, upgrades and saved costume storage', async () => {
  const { CachePipeline } = require('../dist/game/cache/CachePipeline');
  const { PlayerHouseInstance, createDefaultHouseSave } = require('../dist/game/plugin/impl/construction/PlayerHouseInstance');
  const { BUILDABLE_BY_KEY, ROOM_BY_KEY } = require('../dist/game/plugin/impl/construction/ConstructionData');
  const { configureHouseDestination, houseDestinations } = require('../dist/game/plugin/impl/construction/ConstructionPortals');
  const { depositHouseItem, withdrawHouseItem, storageItems } = require('../dist/game/plugin/impl/construction/ConstructionStorage');
  const { Item } = require('../dist/game/model/Item');
  await CachePipeline.initialize();
  const owner = constructionPlayer('Storage owner', 303), guest = constructionPlayer('Storage guest', 304);
  const house = new PlayerHouseInstance(createDefaultHouseSave());
  house.owner = owner; owner.setArea(house); guest.setArea(house);
  const room = { x: 5, y: 4, plane: 1 };
  house.placeRoom(room, ROOM_BY_KEY.get('PORTAL_NEXUS'));
  const target = { position: room, hotspotKey: 'PORTAL_NEXUS', sourceObjectId: 33346, localX: 3, localY: 3, type: 10, face: 0 };
  house.setFurniture(target, BUILDABLE_BY_KEY.get('MARBLE_PORTAL_NEXUS'));
  let nexus = house.getFurnitureAtTarget(target);
  const inventory = owner.getInventory();
  try {
    assert.match(house.canPlaceRoom(ROOM_BY_KEY.get('PORTAL_NEXUS'), { x: 6, y: 4, plane: 1 }, 99), /only have one/);
    assert.equal(configureHouseDestination(owner, house, nexus, 'varrock teleport'), false);
    inventory.addItem(new Item(556, 50000)); inventory.addItem(new Item(563, 50000)); inventory.addItem(new Item(554, 50000)); inventory.addItem(new Item(557, 50000)); inventory.addItem(new Item(555, 50000));
    assert.equal(configureHouseDestination(guest, house, nexus, 'varrock teleport'), false);
    for (const name of ['varrock teleport', 'lumbridge teleport', 'falador teleport', 'camelot teleport']) assert.equal(configureHouseDestination(owner, house, nexus, name), true, name);
    const before = inventory.getAmount(563);
    assert.equal(configureHouseDestination(owner, house, nexus, 'ardougne teleport'), false, 'marble holds four');
    assert.equal(inventory.getAmount(563), before);
    house.setFurniture(target, BUILDABLE_BY_KEY.get('GILDED_PORTAL_NEXUS'));
    nexus = house.getFurnitureAtTarget(target);
    assert.equal(nexus.destinations.length, 4);
    assert.equal(configureHouseDestination(owner, house, nexus, 'ardougne teleport'), true);
    assert.equal(inventory.getAmount(563), before - 2000);
    assert.ok(houseDestinations().find(d => d.name === 'barrows teleport'));
    house.placeRoom(room, ROOM_BY_KEY.get('PORTAL_CHAMBER'));
    const portalTarget = { ...target, hotspotKey: 'PORTAL_1', sourceObjectId: 15406 };
    house.setFurniture(portalTarget, BUILDABLE_BY_KEY.get('TEAK_PORTAL_FRAME'));
    const portal = house.getFurnitureAtTarget(portalTarget);
    assert.equal(configureHouseDestination(owner, house, portal, 'varrock teleport'), false, 'a chamber requires its focus');
    house.setFurniture({ ...target, hotspotKey: 'TELEPORT_FOCUS', sourceObjectId: 15409, localX: 4 }, BUILDABLE_BY_KEY.get('TELEPORT_FOCUS'));
    const chamberRunes = inventory.getAmount(563);
    assert.equal(configureHouseDestination(owner, house, portal, 'varrock teleport'), true);
    assert.equal(inventory.getAmount(563), chamberRunes - 100, 'chambers cost 100 casts, not 1000');
    assert.equal(portal.displayObjectId, 33092, 'directed portal replaces the empty frame');
    assert.equal(configureHouseDestination(owner, house, portal, 'varrock teleport'), false);
    assert.equal(inventory.getAmount(563), chamberRunes - 100, 'duplicate configuration never charges');
    assert.ok(BUILDABLE_BY_KEY.get('RESTORATION_POOL').materials.every(m => m.itemId != null));
    assert.ok(BUILDABLE_BY_KEY.get('ORNATE_REJUVENATION_POOL').materials.some(m => m.itemId === 12905 && m.amount === 10));
    house.placeRoom(room, ROOM_BY_KEY.get('COSTUME_ROOM'));
    const storageTarget = { ...target, hotspotKey: 'MAGIC_WARDROBE', sourceObjectId: 18811 };
    house.setFurniture(storageTarget, BUILDABLE_BY_KEY.get('OAK_MAGIC_WARDROBE'));
    let wardrobe = house.getFurnitureAtTarget(storageTarget);
    assert.equal(storageItems(wardrobe).get(4091), 4089, 'all robe pieces share their native set');
    inventory.addItem(new Item(4091, 1));
    const slot = inventory.getItems().findIndex(item => item.getId() === 4091);
    assert.equal(depositHouseItem(guest, house, wardrobe, slot), false);
    assert.equal(depositHouseItem(owner, house, wardrobe, slot), true);
    assert.equal(inventory.getAmount(4091), 0);
    assert.match(house.canRemoveRoom(room), /Empty the storage/);
    house.setFurniture(storageTarget, BUILDABLE_BY_KEY.get('CARVED_OAK_MAGIC_WARDROBE'));
    wardrobe = house.getFurnitureAtTarget(storageTarget);
    assert.equal(wardrobe.storage[4091], 1, 'upgrade keeps stored items');
    const saved = JSON.parse(JSON.stringify(house.save));
    assert.equal(saved.rooms[1][5][4].furnitureByLocation['3:3:10'].storage[4091], 1);
    assert.equal(withdrawHouseItem(guest, house, wardrobe, 4091), false);
    for (let i = inventory.getFreeSlots(); i > 0; i--) inventory.addItem(new Item(960, 1));
    assert.equal(withdrawHouseItem(owner, house, wardrobe, 4091), false);
    assert.equal(wardrobe.storage[4091], 1, 'full inventory must not lose stored items');
    inventory.delete(960, 1);
    assert.equal(withdrawHouseItem(owner, house, wardrobe, 4091), true);
    assert.equal(withdrawHouseItem(owner, house, wardrobe, 4091), false, 'repeated withdrawal cannot duplicate');
    assert.equal(house.canRemoveRoom(room), null);
  } finally { house.destroy(); }
});

test('house altar burners are shared, expire and affect only their chapel', async () => {
  const { CachePipeline } = require('../dist/game/cache/CachePipeline');
  const { PlayerHouseInstance, createDefaultHouseSave } = require('../dist/game/plugin/impl/construction/PlayerHouseInstance');
  const { offerHouseBones, lightHouseBurner, expireHouseBurners } = require('../dist/game/plugin/impl/construction/ConstructionAltars');
  const { Item } = require('../dist/game/model/Item');
  const { Skill } = require('../dist/game/model/Skill');
  await CachePipeline.initialize();
  const house = new PlayerHouseInstance(createDefaultHouseSave()), player = constructionPlayer('Prayer guest', 305);
  const altar = { buildableKey: 'GILDED_ALTAR' }, burner1 = { buildableKey: 'INCENSE_BURNER' }, burner2 = { buildableKey: 'MARBLE_BURNER' };
  const room = house.save.rooms[1][4][5]; room.furnitureByLocation = { altar, burner1, burner2 };
  player.setArea(house);
  house.redrawFurniture = () => {};
  house.getFurnitureAt = (_, id) => id === 13197 ? altar : id === 13208 ? burner1 : burner2;
  const event = { player, objectId: 13197, object: { getType: () => 10 }, location: { x: house.allocation.baseX + 50, y: house.allocation.baseY + 58, z: 1 }, itemId: 536, itemSlot: 0 };
  player.getInventory().addItem(new Item(536, 3)); player.getInventory().addItem(new Item(2347, 1));
  try {
    assert.equal(offerHouseBones(event), true);
    assert.deepEqual(player.experience.at(-1), [Skill.PRAYER, 180]);
    player.getInventory().addItem(new Item(590, 1)); player.getInventory().addItem(new Item(251, 2));
    lightHouseBurner({ ...event, objectId: 13208 }); lightHouseBurner({ ...event, objectId: 13212 });
    assert.equal(house.litBurners.size, 2);
    event.itemSlot = player.getInventory().getItems().findIndex(item => item.getId() === 536);
    offerHouseBones(event);
    assert.deepEqual(player.experience.at(-1), [Skill.PRAYER, 252]);
    expireHouseBurners(house, Date.now() + 300000);
    assert.equal(house.litBurners.size, 0);
    event.itemSlot = player.getInventory().getItems().findIndex(item => item.getId() === 536);
    offerHouseBones(event);
    assert.deepEqual(player.experience.at(-1), [Skill.PRAYER, 180]);
  } finally { house.destroy(); }
});

test("server-owned items inherit gameplay and deliver external models before definitions", async () => {
  const fs = require("node:fs");
  const { inflateSync } = require("node:zlib");
  const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
  const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
  const { ContentApi } = require("../dist/net/http/ContentApi");
  const { encodeContentData } = require("../dist/net/protocol/ClientProtocol");
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  await CachePipeline.initialize();
  let onLogin;
  require("../plugins/items/ItemDefinitionLoader.plugin").register({
    log() {},
    onPlayerLogin(handler) { onLogin = handler; },
    registerContentEndpoint(name, handler) { ContentApi.register(name, handler); },
  });
  const custom = CacheDefinitions.getCustomItems()[0];
  const item = ItemDefinition.forId(custom.id);
  const base = ItemDefinition.forId(custom.baseItemId);
  assert.equal(CacheDefinitions.getItem(custom.id).id, custom.id);
  assert.equal(item.getId(), custom.id);
  assert.equal(item.getName(), "Dragonic katana");
  assert.equal(item.getEquipmentType().getSlot(), 3);
  assert.equal(item.getNoteId(), -1, "custom weapons must not turn into the base weapon's note");
  assert.equal(item.isTradeable(), false);
  assert.deepEqual(item.getBonuses(), base.getBonuses());
  assert.notEqual(item.getBonuses(), base.getBonuses());
  assert.deepEqual(item.getRequirements(), base.getRequirements());
  assert.equal(CacheDefinitions.getItem(custom.id).inventoryActions[0], "Wield");
  assert.equal(CacheDefinitions.hasItem(custom.id), true);
  assert.equal(CacheDefinitions.hasItem(custom.id + 1), false, "unused custom IDs are not valid items");
  const delivered = [];
  onLogin({ player: { getPacketSender: () => ({
    sendContentData(source, datasets) {
      const packet = encodeContentData(source, datasets);
      assert.ok(packet.length <= 0xffff);
      assert.equal(packet.readUInt16BE(1), packet.length - 3);
      delivered.push(JSON.parse(inflateSync(packet.subarray(8)).toString("utf8")));
    },
  }) } });
  assert.deepEqual(delivered.map((payload) => payload.datasets[0].key),
    ["customModels", "customModels", "customModels", "customItems"]);
  assert.deepEqual(delivered[0].datasets[0].rows, []);
  for (const payload of delivered.slice(1, 3)) {
    const model = payload.datasets[0].rows[0];
    assert.deepEqual(Buffer.from(model.data, "base64"),
      fs.readFileSync(`data/models/${custom.models[model.id]}`));
  }
  assert.equal(delivered[3].datasets[0].rows[0].objType.model, 1000000);
  assert.equal(ContentApi.resolve("GET", `/api/custom-models/1000000`).status, 200);
  assert.throws(() => CacheDefinitions.registerCustomItems([{ ...custom, id: 70000 }]), /id must/);
  assert.throws(() => CacheDefinitions.registerCustomItems([custom, custom]), /duplicate item/);
  assert.equal(CacheDefinitions.getItem(custom.id).id, custom.id, "invalid registration preserves live definitions");
});

test("preset-spawned items carry the untradeable and unbankable metadata", () => {
  const { Item } = require("../dist/game/model/Item");
  const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");
  const item = presets._test.spawnPresetItem(
    new Item(ItemIdentifiers.COINS),
    presets.getGlobalPresetPool()[0],
  );

  assert.equal(item.getMetaValue(Item.UNTRADEABLE_META), true);
  assert.equal(item.getMetaValue(Item.UNBANKABLE_META), true);
  assert.equal(item.isTradeable(), false);
  assert.equal(item.isLostOnDeath(), true);
  assert.equal(item.isUnbankable(), true);
});

test("deposit booth slot actions reach Bank.deposit", () => {
  const booth = require("../plugins/objects/BankDepositBooth.plugin");
  const { Bank } = require("../dist/game/model/container/impl/Bank");
  let onInterfaceActionClick;
  booth.register({
    onObjectInteraction() {},
    onInterfaceActionClick(handler) { onInterfaceActionClick = handler; },
    onInterfaceActionButton() {},
    onItemOnObject() {},
    emitCanBank: () => null,
  });

  let amount = 1;
  const item = { getId: () => 4153 };
  const player = {
    getInterfaceId: () => 192,
    getInventory: () => ({ forSlot: () => item, getAmount: () => amount }),
    getPacketSender: () => ({ clearItemOnInterface() {}, sendItemContainer() {} }),
  };
  const deposit = Bank.deposit;
  try {
    Bank.deposit = (_player, id, slot, moved) => {
      assert.equal(id, 4153);
      assert.equal(slot, 0);
      assert.equal(moved, 1);
      amount = 0;
    };
    const event = { player, buttonId: (192 << 16) | 24, itemId: 4153, slot: 0, action: 2, handled: false };
    onInterfaceActionClick(event);
    assert.equal(event.handled, true);
  } finally {
    Bank.deposit = deposit;
  }
});

test("a player preset bot announces its suppressed drops once", () => {
  const botDeathLoot = require("../plugins/bots/runtime/BotDeathLoot");
  const messages = [];
  const killer = {
    isRegistered: () => true,
    isPlayerBot: () => false,
    sendMessage: (message) => messages.push(message),
  };
  const victim = { isPlayerBot: () => true };
  const event = {
    player: victim,
    killer,
    item: { isUnbankable: () => true },
    dropEligible: false,
    handled: false,
  };

  botDeathLoot.handleBotDeathItemDrop(event);
  botDeathLoot.handleBotDeathItemDrop(event);
  botDeathLoot.clearBotDeathLootPlan(victim);

  assert.deepEqual(messages, ["This bot was using a player preset and therefore has not dropped its items. Regular bots will still drop items"]);
});


test("house portal actions and shared-door room selection preserve the last exit", () => {
  const { ConstructionPlugin } = require('../dist/game/plugin/impl/construction/ConstructionPlugin');
  const { PlayerHouseInstance, createDefaultHouseSave } = require('../dist/game/plugin/impl/construction/PlayerHouseInstance');
  const hooks = new Map();
  const prompts = [];
  const messages = [];
  const house = Object.create(PlayerHouseInstance.prototype);
  house.save = createDefaultHouseSave();
  house.gridSize = 8;
  house.allocation = { baseX: 6400, baseY: 6400 };
  const original = { x: 4, y: 4, plane: 1 };
  const second = { x: 5, y: 4, plane: 1 };
  const garden = { roomKey: 'GARDEN', rotation: 0, furniture: {} };
  house.save.rooms[1][5][4] = garden;
  // West doorway of the second garden points at the original garden.
  const door = { x: 6456, y: 6451, z: 1 };
  house.doorTargets = new Map([['6456:6451:1', original]]);
  house.rebuild = () => true;
  house.destroy = () => {};
  let exits = 0;
  house.exitHouse = () => exits++;
  house.getFurnitureAt = () => ({ buildableKey: 'EXIT_PORTAL' });
  let locked = 0;
  const sender = {
    getVarbit(id) { assert.equal(id, 2183); return locked; },
    sendVarbit(id, value) { if (id === 2183) locked = value; },
    sendInterfaceRemoval() {}, sendPlayerOption() {},
  };
  const player = {
    getPrivateArea: () => house,
    getAttribute: () => house.save,
    getLocation: () => ({ x: 6458, y: 6451, z: 1 }),
    moveTo() {},
    getPacketSender: () => sender,
    sendMessage: message => messages.push(message),
    setAttribute() {},
  };
  house.owner = player;
  house.buildingMode = true;
  house.getPlayers = () => [player];
  const register = click => (ids, handler) => {
    for (const id of Array.isArray(ids) ? ids : [ids]) {
      const key = id + ':' + click;
      hooks.set(key, [...(hooks.get(key) ?? []), handler]);
    }
  };
  ConstructionPlugin.register(new Proxy({
    onObjectFirstClick: register(1), onObjectSecondClick: register(2),
    onObjectThirdClick: register(3), onObjectFifthClick: register(5),
    sendMultiChatboxPrompt(_player, title, ...options) { prompts.push({ title, options }); },
  }, { get: (target, key) => target[key] ?? (() => {}) }));
  const dispatch = (id, click, location, actions, sourceLocation = location) => {
    const event = { player, objectId: id, clickType: click, location, sourceLocation,
      object: { getType: () => 10 }, definition: { getInteractions: () => actions } };
    return (hooks.get(id + ':' + click) ?? []).some(handler => handler(event) !== false);
  };
  const choose = label => {
    const { options } = prompts.at(-1);
    const index = options.indexOf(label);
    assert.ok(index >= 0, label);
    options[index + 1]();
  };
  const portalActions = ['Enter', 'Lock', 'Remove board advert', null, 'Remove'];
  dispatch(4525, 2, door, portalActions);
  assert.equal(locked, 1);
  dispatch(4525, 2, door, portalActions);
  assert.equal(locked, 0);
  assert.equal(prompts.length, 0, 'locking must not open a removal prompt');
  dispatch(4525, 1, door, portalActions);
  assert.equal(exits, 1, 'Enter must leave even in building mode with only one portal');
  assert.ok(!messages.some(message => message.includes('at least one exit')));
  dispatch(4525, 5, door, portalActions);
  assert.match(messages.at(-1), /at least one exit portal/);
  assert.equal(prompts.length, 0, 'removing the last portal remains prohibited');

  const doorActions = [null, null, null, null, 'Build'];
  dispatch(15305, 5, door, doorActions, { x: 6458, y: 6451, z: 1 });
  choose('Room on this side');
  choose('Remove room');
  choose('Yes, remove it');
  assert.equal(house.getRoom(second), null);
  assert.equal(house.getRoom(original).furniture.CENTERPIECE, 'EXIT_PORTAL');

  // The same shared door must also expose the second garden from the other side.
  house.save.rooms[1][5][4] = garden;
  dispatch(15305, 5, door, doorActions, { x: 6454, y: 6451, z: 1 });
  choose('Room on the other side');
  choose('Remove room');
  choose('Yes, remove it');
  assert.equal(house.getRoom(second), null);
  assert.match(house.canRemoveRoom(original), /at least one exit portal/);

  // With another actual portal saved, removing either portal room is permitted.
  house.save.rooms[1][5][4] = { ...garden, furniture: { CENTERPIECE: 'EXIT_PORTAL' } };
  assert.equal(house.canRemoveRoom(original), null);
  assert.equal(house.canRemoveRoom(second), null);
});


test('house pickups route before collecting and revalidate reach', async (t) => {
  const { CachePipeline } = require('../dist/game/cache/CachePipeline');
  const { PlayerHouseInstance, createDefaultHouseSave } = require('../dist/game/plugin/impl/construction/PlayerHouseInstance');
  const { PickupItemPacketListener } = require('../dist/net/packet/impl/PickupItemPacketListener');
  const { ItemOnGroundManager } = require('../dist/game/entity/impl/grounditem/ItemOnGroundManager');
  const { ItemOnGround, State } = require('../dist/game/entity/impl/grounditem/ItemOnGround');
  const { MovementQueue } = require('../dist/game/model/movement/MovementQueue');
  const { Location } = require('../dist/game/model/Location');
  const { Item } = require('../dist/game/model/Item');
  const { World } = require('../dist/game/World');
  const { TaskManager } = require('../dist/game/task/TaskManager');
  await CachePipeline.initialize();
  const house = new PlayerHouseInstance(createDefaultHouseSave());
  const destination = new Location(house.allocation.baseX + 54, house.allocation.baseY + 50, 1);
  const item = new ItemOnGround(State.SEEN_BY_PLAYER, 'pickup test', destination, new Item(960, 1), false, -1, house);
  World.getItems().push(item);
  let location = destination.transform(-4, 0);
  let area = house, busy = false, cooldownReady = true;
  const inventory = [];
  const tasks = [];
  t.mock.method(TaskManager, 'submit', task => tasks.push(task));
  const player = {
    getUsername: () => 'pickup test', getIndex: () => -987,
    getLocation: () => location, getPrivateArea: () => area, getSize: () => 1,
    isPlayer: () => true, isNpc: () => false, isPlayerBot: () => true,
    getAsPlayer: () => player, getMovementQueue: () => queue,
    busy: () => busy,
    getLastItemPickup: () => ({ elapsedTime: () => cooldownReady, reset() {} }),
    getCombat: () => ({ setCastSpell() {}, reset() {} }),
    getSkillManager: () => ({ stopSkillable() {} }),
    setCombatFollowing() {}, setFollowing() {}, setPositionToFace() {},
    getInventory: () => ({ getFreeSlots: () => 28, getAmount: () => 0, addItem: value => inventory.push(value) }),
  };
  const queue = new MovementQueue(player);
  t.mock.method(queue, 'getMobility', () => ({ canMove: () => true }));
  t.mock.method(queue, 'syncDestinationFlagToRoute', () => {});
  const click = () => PickupItemPacketListener.pickup(player, 960, destination.x, destination.y, -1);
  try {
    busy = true;
    click();
    busy = false;
    cooldownReady = false;
    click();
    cooldownReady = true;
    area = {};
    click();
    area = house;
    assert.equal(tasks.length, 0, 'busy, cooldown and another instance must reject the pickup');

    // Force the real routefinder to detour around instance collision.
    for (let dy = -1; dy <= 1; dy++) house.setClip(destination.transform(-2, dy), 0x200000);
    click();
    assert.equal(inventory.length, 0, 'clicking a distant item must not collect it');
    assert.equal(tasks.length, 1);
    assert.equal(queue.hasRoute(), true);
    assert.ok(queue.pointsReturn().length > 1, 'the route must detour around blocked instance tiles');
    tasks[0].execute();
    assert.equal(inventory.length, 0, 'the walk callback must wait for arrival');
    ItemOnGroundManager.pickup(player, item);
    assert.equal(inventory.length, 0, 'direct pickup must also reject a distant item');

    location = new Location(destination.x, destination.y, destination.z + 1);
    ItemOnGroundManager.pickup(player, item);
    location = destination.clone();
    area = {};
    ItemOnGroundManager.pickup(player, item);
    area = house;
    item.setPendingRemoval(true);
    ItemOnGroundManager.pickup(player, item);
    assert.equal(inventory.length, 0, 'changed plane, instance and removed items must be rejected');
    item.setPendingRemoval(false);
    tasks[0].execute();
    tasks[0].execute();
    assert.equal(inventory.length, 1, 'the item is collected only after arrival');
    assert.equal(item.isPendingRemoval(), true);
    ItemOnGroundManager.pickup(player, item);
    assert.equal(inventory.length, 1, 'a stale callback cannot collect the item twice');
  } finally {
    World.getItems().splice(World.getItems().indexOf(item), 1);
    house.destroy();
  }
});

test('house normal entry removes template hotspots before replaying furniture', async () => {
  const { CachePipeline } = require('../dist/game/cache/CachePipeline');
  const { PlayerHouseInstance, createDefaultHouseSave } = require('../dist/game/plugin/impl/construction/PlayerHouseInstance');
  const { encodeLocDel } = require('../dist/net/protocol/ClientProtocol');
  const locDelOpcode = encodeLocDel(0, 0, 0, 0, 0)[0];
  const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
  await CachePipeline.initialize();
  const save = createDefaultHouseSave();
  save.rooms[1][4][5].furnitureByLocation = {
    '2:4:11': { buildableKey: 'CRUDE_WOODEN_CHAIR', hotspotKey: 'CHAIR_1',
      sourceObjectId: 4515, localX: 2, localY: 4, type: 11, face: 2 },
  };
  const house = new PlayerHouseInstance(save);
  const events = [];
  const player = {
    getSession: () => ({ sendClientPacket(frame) { events.push(frame); return true; } }),
    getPacketSender: () => ({
      sendVarbit(id, value) { assert.equal(id, 2176); events.push({ mode: value }); },
      sendObject(object) { events.push({ furniture: object }); },
    }),
  };
  try {
    const templates = PlayerHouseInstance.getTemplateObjects();
    assert.ok(templates.some(object => object.id === 37620), 'new cache Build hotspots must also be included');
    for (let rotation = 0; rotation < 4; rotation++) {
      save.rooms[1][4][5].rotation = rotation;
      for (const building of [false, true, false]) {
        events.length = 0;
        assert.equal(house.rebuild(player, building), true);
        assert.deepEqual(events[0], { mode: building ? 1 : 0 });
        const removals = events.filter(event => Buffer.isBuffer(event) && event[0] === locDelOpcode);
        if (building) {
          assert.equal(removals.length, 0, 'build mode must restore empty hotspots');
          assert.ok(house.doorTargets.size > 0);
        } else {
          assert.equal(house.doorTargets.size, 0);
          for (const hotspot of templates.filter(object => object.sourceChunkX === 232 && object.sourceChunkY === 887 && object.id !== 13830)) {
            const definition = CacheDefinitions.getObject(hotspot.id);
            const width = (hotspot.face & 1) ? definition.sizeY : definition.sizeX;
            const height = (hotspot.face & 1) ? definition.sizeX : definition.sizeY;
            const x = hotspot.localX, y = hotspot.localY;
            const [localX, localY] = [[x, y], [y, 8 - x - width],
              [8 - x - width, 8 - y - height], [8 - y - height, x]][rotation];
            const expected = encodeLocDel(house.allocation.baseX + 48 + localX,
              house.allocation.baseY + 56 + localY, 1, hotspot.type, (hotspot.face + rotation) & 3);
            assert.ok(removals.some(frame => frame.equals(expected)), 'normal entry must remove hotspot ' + hotspot.id);
          }
        }
        const placed = events.at(-1).furniture;
        assert.ok(placed, 'built furniture must be replayed after hotspot removal');
        assert.equal(placed.getId(), 6752);
        assert.equal(placed.getFace(), (2 + rotation) & 3);
      }
    }
  } finally {
    house.destroy();
  }
});


test('pool tiers restore only their documented effects and spellbook altars toggle', () => {
  const { Skill } = require('../dist/game/model/Skill');
  const { CombatSpecial } = require('../dist/game/content/combat/CombatSpecial');
  const { Sounds } = require('../dist/game/Sounds');
  const updateBar = CombatSpecial.updateBar, sound = Sounds.sendSound;
  CombatSpecial.updateBar = () => {}; Sounds.sendSound = () => {};
  const handlers = new Map();
  require('../plugins/objects/RejuvinationPool.plugin.js').register({ getTaskManager: () => ({ cancelTasks() {} }), onObjectInteraction: (name, actions) => handlers.set(name, actions.Drink) });
  try {
    const names = ['Pool of Restoration', 'Pool of Revitalisation', 'Pool of Rejuvenation', 'Fancy pool of Rejuvenation', 'Ornate pool of Rejuvenation'];
    names.forEach((name, tier) => {
      const values = new Map(Skill.values().map(skill => [skill, 50]));
      values.set(Skill.STRENGTH, 110);
      let hp = 50, run = 10, special = 0, poison = 6, venom = true;
      const player = {
        getSkillManager: () => ({ getCurrentLevel: skill => values.get(skill), getMaxLevel: () => 99, setCurrentLevels: (skill, value) => values.set(skill, value) }),
        getHitpoints: () => hp, setHitpoints: value => { hp = value; },
        setSpecialPercentage: value => { special = value; }, setRunEnergy: value => { run = value; },
        setPoisonDamage: value => { poison = value; }, setVenomed: value => { venom = value; }, sendMessage() {},
      };
      handlers.get(name)({ player });
      assert.equal(special, 100, name);
      assert.equal(run, tier >= 1 ? 100 : 10, name);
      assert.equal(values.get(Skill.PRAYER), tier >= 2 ? 99 : 50, name);
      assert.equal(values.get(Skill.ATTACK), tier >= 3 ? 99 : 50, name);
      assert.equal(values.get(Skill.STRENGTH), 110, 'boosts must survive');
      assert.equal(hp, tier >= 4 ? 99 : 50, name);
      assert.equal(poison, tier >= 4 ? 0 : 6, name);
      assert.equal(venom, tier < 4, name);
    });
  } finally { CombatSpecial.updateBar = updateBar; Sounds.sendSound = sound; }
  const altarActions = new Map();
  require('../plugins/objects/Altars.plugin.js').register({ onObjectInteraction: (name, actions) => altarActions.set(name, actions) });
  const change = MagicSpellbook.changeSpellbook;
  let book = MagicSpellbook.NORMAL;
  MagicSpellbook.changeSpellbook = (_, value) => { book = value; };
  Sounds.sendSound = () => {};
  try {
    const player = { getSpellbook: () => book, performAnimation() {} };
    for (const [name, expected] of [['Ancient Altar', MagicSpellbook.ANCIENT], ['Lunar Altar', MagicSpellbook.LUNAR], ['Dark Altar', MagicSpellbook.ARCEUUS]]) {
      altarActions.get(name).Venerate({ player }); assert.equal(book, expected);
      altarActions.get(name).Venerate({ player }); assert.equal(book, MagicSpellbook.NORMAL);
    }
    altarActions.get('Altar of the Occult').Arceuus({ player }); assert.equal(book, MagicSpellbook.ARCEUUS);
  } finally { MagicSpellbook.changeSpellbook = change; Sounds.sendSound = sound; }
});

test('rotated nexus hotspots, built models and interactions share the same footprint', async () => {
  const { CachePipeline } = require('../dist/game/cache/CachePipeline');
  const { PlayerHouseInstance, createDefaultHouseSave } = require('../dist/game/plugin/impl/construction/PlayerHouseInstance');
  const { BUILDABLE_BY_KEY, ROOM_BY_KEY } = require('../dist/game/plugin/impl/construction/ConstructionData');
  await CachePipeline.initialize();
  const house = new PlayerHouseInstance(createDefaultHouseSave());
  const position = { x: 5, y: 4, plane: 1 }, placed = [];
  const player = constructionPlayer('Nexus builder', 306);
  player.getPacketSender = () => ({ sendVarbit() {}, sendObject: object => placed.push(object) });
  try {
    for (let rotation = 0; rotation < 4; rotation++) {
      house.placeRoom(position, ROOM_BY_KEY.get('PORTAL_NEXUS'), rotation);
      const location = { x: house.allocation.baseX + 59, y: house.allocation.baseY + 51, z: 1 };
      const target = house.getFurnitureTarget(location, 33346);
      assert.ok(target, '2x2 centered nexus must be buildable at rotation ' + rotation);
      house.setFurniture(target, BUILDABLE_BY_KEY.get('MARBLE_PORTAL_NEXUS'));
      house.rebuild(player, false);
      const object = placed.findLast(value => value.getId() === 33408);
      assert.equal(object.getLocation().getX(), location.x);
      assert.equal(object.getLocation().getY(), location.y);
      assert.equal(house.getFurnitureAt(location, 33408, 10).buildableKey, 'MARBLE_PORTAL_NEXUS');
      assert.equal(house.removeFurniture(location, 33408, 10).buildableKey, 'MARBLE_PORTAL_NEXUS');
      assert.equal(house.getFurnitureAt(location, 33408, 10), null);
    }
  } finally { house.destroy(); }
});


test('pool upgrades use the build interface, consume real potions and reject stale menus', async () => {
  const { CachePipeline } = require('../dist/game/cache/CachePipeline');
  const { PlayerHouseInstance } = require('../dist/game/plugin/impl/construction/PlayerHouseInstance');
  const { BUILDABLE_BY_KEY, ROOM_BY_KEY, CONSTRUCTION_HOTSPOTS } = require('../dist/game/plugin/impl/construction/ConstructionData');
  const { Item } = require('../dist/game/model/Item');
  await CachePipeline.initialize();
  const player = constructionPlayer('Pool builder', 307), hooks = constructionHooks();
  hooks.click(player, 15478, 3);
  const house = player.getPrivateArea(), room = { x: 5, y: 4, plane: 1 };
  try {
    house.placeRoom(room, ROOM_BY_KEY.get('SUPERIOR_GARDEN'));
    const template = PlayerHouseInstance.getTemplateObjects().find(object => object.id === 29122 && object.sourceChunkX === 237 && object.sourceChunkY === 880);
    const location = { x: house.allocation.baseX + 56 + template.localX, y: house.allocation.baseY + 48 + template.localY, z: 1 };
    const target = house.getFurnitureTarget(location, 29122);
    assert.ok(target);
    house.setFurniture(target, BUILDABLE_BY_KEY.get('RESTORATION_POOL'));
    player.getInventory().addItem(new Item(2347, 1)); player.getInventory().addItem(new Item(8794, 1)); player.getInventory().addItem(new Item(12625, 10));
    hooks.click(player, 29237, 4, location, ['Drink', null, null, 'Upgrade', 'Remove']);
    hooks.selectFurniture(player, 2);
    assert.equal(house.getFurnitureAtTarget(target).buildableKey, 'REVITALISATION_POOL');
    assert.equal(player.getInventory().getAmount(12625), 0);
    player.getInventory().addItem(new Item(2434, 10));
    hooks.click(player, 29238, 4, location, ['Drink', null, null, 'Upgrade', 'Remove']);
    hooks.click(player, 4525, 1);
    hooks.selectFurniture(player, 3);
    assert.equal(player.getInventory().getAmount(2434), 10);
    assert.equal(house.getFurnitureAtTarget(target).buildableKey, 'REVITALISATION_POOL');
    assert.ok(CONSTRUCTION_HOTSPOTS.find(h => h.key === 'SPELLBOOK_ALTAR').buildables.includes('OCCULT_ALTAR_FROM_ANCIENT'));
  } finally { hooks.logout(player); }
});


test('house windows replace layout markers with styled windows or adjoining walls', async () => {
  const { CachePipeline } = require('../dist/game/cache/CachePipeline');
  const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
  const { PlayerHouseInstance, createDefaultHouseSave } = require('../dist/game/plugin/impl/construction/PlayerHouseInstance');
  const { CONSTRUCTION_ROOMS } = require('../dist/game/plugin/impl/construction/ConstructionData');
  const { encodeLocAddChange } = require('../dist/net/protocol/ClientProtocol');
  await CachePipeline.initialize();
  assert.deepEqual(CacheDefinitions.getObject(13099).models, [[13264]], 'use the native village window model');
  const house = new PlayerHouseInstance(createDefaultHouseSave());
  const frames = [];
  const viewer = () => ({
    getSession: () => ({ sendClientPacket(frame) { frames.push(frame); return true; } }),
    getPacketSender: () => ({ sendVarbit() {}, sendObject() {} }),
  });
  const owner = viewer(), guest = viewer();
  try {
    for (const room of CONSTRUCTION_ROOMS) {
      const windows = PlayerHouseInstance.getTemplateObjects().filter(object => object.id === 13830
        && object.sourceChunkX === room.sourceChunkX && object.sourceChunkY === room.sourceChunkY);
      if (!windows.length) continue;
      for (let rotation = 0; rotation < 4; rotation++) {
        house.placeRoom({ x: 4, y: 5, plane: 1 }, room, rotation);
        for (const neighbour of [null, 'KITCHEN', 'GARDEN', null]) {
          house.save.rooms[1][3][5] = neighbour ? { roomKey: neighbour, rotation: 0, furniture: {} } : null;
          for (const [player, building] of [[owner, true], [owner, false], [guest, false]]) {
            frames.length = 0;
            house.rebuild(player, building);
            for (const window of windows) {
              const [x, y] = [[window.localX, window.localY], [window.localY, 7 - window.localX],
                [7 - window.localX, 7 - window.localY], [7 - window.localY, window.localX]][rotation];
              const id = x === 0 && neighbour === 'KITCHEN' ? 13098 : 13099;
              const expected = encodeLocAddChange(id, house.allocation.baseX + 48 + x,
                house.allocation.baseY + 56 + y, 1, window.type, (window.face + rotation) & 3);
              assert.ok(frames.some(frame => frame.equals(expected)), `${room.key}: window must match the style and adjacent room`);
            }
          }
        }
      }
    }
  } finally { house.destroy(); }
});

test('native house options enforce ownership, instant kick and persistent preferences', async t => {
  const { CachePipeline } = require('../dist/game/cache/CachePipeline');
  const { World } = require('../dist/game/World');
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const { PlayerOptionPacketListener } = require('../dist/net/packet/impl/PlayerOptionPacketListener');
  await CachePipeline.initialize();
  const owner = constructionPlayer('Options host', 320), guest = constructionPlayer('Options guest', 321), other = constructionPlayer('Other home', 322);
  const hooks = constructionHooks();
  const click = (player, childId) => hooks.interfaceAction({ player, groupId: 370, childId, action: 1 });
  t.mock.method(World, 'getPlayerByName', name => [owner, guest, other].find(p => p.getUsername() === name));
  t.mock.method(World, 'getPlayers', () => ({ get: index => [owner, guest, other].find(p => p.getIndex() === index) }));
  t.mock.method(PluginManager, 'emitCustomEvent', (name, payload) => hooks.events.get(name)?.(payload));
  for (const p of [owner, guest, other]) { p.busy = () => false; p.getHitpoints = () => 99; p.getMovementQueue = () => { throw new Error('Kick must not pathfind'); }; }
  const visit = () => { hooks.click(guest, 15478, 4); guest.getEnteredSyntaxAction().execute(owner.getUsername()); };
  try {
    hooks.interfaceAction({ player: owner, groupId: 116, childId: 31, action: 1 });
    assert.ok(owner.packets.some(p => p[0] === 'sendSubInterface' && p[1] === ((161 << 16) | 87) && p[2] === 370));
    click(owner, 5);
    assert.equal(owner.getPrivateArea(), null, 'building mode requires being inside your own house');
    click(owner, 9); click(owner, 11); click(owner, 12);
    assert.equal(owner.vars.get(4744), 1, 'Default Off must not alter the teleport preference');
    assert.equal(owner.getAttribute('construction:house').defaultBuildingMode, false);
    hooks.click(owner, 15478, 2);
    const house = owner.getPrivateArea();
    assert.deepEqual(owner.packets.findLast(p => p[0] === 'sendPlayerOption'), ['sendPlayerOption', 7, 'Kick', false]);
    visit();
    hooks.command(guest); click(guest, 20); click(guest, 5);
    assert.equal(guest.getPrivateArea(), house, 'guests cannot expel or enable building mode');
    click(owner, 5);
    assert.equal(house.buildingMode, false, 'guests prevent building mode');
    hooks.click(other, 15478, 2);
    PlayerOptionPacketListener.executeClientOption(other, guest.getIndex(), 7);
    PlayerOptionPacketListener.executeClientOption(guest, owner.getIndex(), 7);
    assert.equal(guest.getPrivateArea(), house, 'a different owner and a guest cannot kick');
    PlayerOptionPacketListener.executeClientOption(owner, guest.getIndex(), 7);
    assert.equal(guest.getPrivateArea(), null);
    assert.equal(guest.getLocation().getX(), 2954);
    visit();
    assert.equal(guest.getPrivateArea(), house, 'Kick does not ban re-entry');
    click(owner, 20);
    assert.equal(guest.getPrivateArea(), null);
    click(owner, 5); assert.equal(house.buildingMode, true);
    click(owner, 6); assert.equal(house.buildingMode, false);
    click(owner, 21);
    assert.equal(owner.getPrivateArea(), null);
    assert.deepEqual(owner.packets.findLast(p => p[0] === 'sendPlayerOption'), ['sendPlayerOption', 7, '', false]);
    const close = { player: owner, handled: false };
    hooks.events.get('interface:close')(close);
    assert.equal(close.handled, true);
    assert.deepEqual(owner.packets.at(-1), ['sendSubInterface', (161 << 16) | 87, 116, 1]);
    hooks.events.get('spell:teleport-arrival')({ player: owner, name: 'teleport to house' });
    assert.equal(owner.getPrivateArea(), null, 'outside preference must keep the player outside');
    hooks.command(owner); click(owner, 8); click(owner, 11);
    hooks.events.get('spell:teleport-arrival')({ player: owner, name: 'teleport to house' });
    assert.equal(owner.getPrivateArea().buildingMode, true);
    assert.equal(JSON.parse(JSON.stringify(owner.getAttribute('construction:house'))).defaultBuildingMode, true);
  } finally { [owner, guest, other].forEach(p => hooks.logout(p)); }
});

test('native house viewer moves, rotates, builds and protects occupied rooms', async () => {
  const { CachePipeline } = require('../dist/game/cache/CachePipeline');
  const { ROOM_BY_KEY } = require('../dist/game/plugin/impl/construction/ConstructionData');
  const { Item } = require('../dist/game/model/Item');
  await CachePipeline.initialize();
  const owner = constructionPlayer('Viewer host', 323), hooks = constructionHooks();
  const options = childId => hooks.interfaceAction({ player: owner, groupId: 370, childId, action: 1 });
  const viewer = (childId, action = 1, slot) => hooks.interfaceAction({ player: owner, groupId: 422, childId, action, slot });
  hooks.command(owner);
  hooks.click(owner, 15478, 2); options(1);
  assert.notEqual(owner.getInterfaceId(), 422, 'normal mode must reject the viewer');
  options(5); options(1);
  const house = owner.getPrivateArea();
  try {
    assert.equal(owner.getInterfaceId(), 422);
    assert.equal(house.getMaxRooms(1), 24);
    assert.equal(house.getMaxRooms(50), 29);
    assert.equal(house.getMaxRooms(99), 38);
    assert.match(house.canPlaceRoom(ROOM_BY_KEY.get('PARLOUR'), { plane: 1, x: 0, y: 0 }, 1), /dimensions/);
    assert.ok(owner.packets.some(p => p[0] === 'sendClientScript' && p[1] === 1382));
    viewer(6); viewer(67);
    assert.match(owner.getMessages().at(-1), /at least one exit portal/);
    const room = house.save.rooms[1][4][5];
    room.furnitureByLocation = { stored: { buildableKey: 'OAK_TOY_BOX', hotspotKey: 'TOY_BOX', sourceObjectId: 18812,
      localX: 2, localY: 2, type: 10, face: 0, storage: { 1038: 1 } } };
    viewer(7); viewer(67);
    assert.match(owner.getMessages().at(-1), /Empty the storage/);
    viewer(63); viewer(5, 1, 81 + 5 * 9 + 5); viewer(65); viewer(69);
    assert.equal(house.getRoom({ plane: 1, x: 4, y: 5 }), null);
    const moved = house.getRoom({ plane: 1, x: 5, y: 5 });
    assert.equal(moved.rotation, 1);
    assert.equal(moved.furnitureByLocation.stored.storage[1038], 1);
    viewer(7); viewer(64); viewer(66); viewer(68);
    assert.equal(house.getRoom({ plane: 1, x: 5, y: 5 }).rotation, 1, 'Cancel must discard orientation changes');
    house.placeRoom({ plane: 2, x: 5, y: 5 }, ROOM_BY_KEY.get('PARLOUR'));
    assert.match(house.canMoveRoom({ plane: 1, x: 5, y: 5 }, { plane: 1, x: 6, y: 5 }), /supports/);
    house.removeRoom({ plane: 2, x: 5, y: 5 });
    owner.getInventory().addItem(new Item(995, 1000));
    viewer(5, 6, 81 + 4 * 9 + 5);
    assert.equal(owner.getInterfaceId(), 212, 'Add room must use the native room creation interface');
    hooks.interfaceAction({ player: owner, groupId: 212, childId: 4, action: 1 });
    assert.equal(house.getRoom({ plane: 1, x: 5, y: 4 }).roomKey, 'PARLOUR');
    assert.equal(owner.getInventory().getAmount(995), 0);
    options(21); viewer(6); viewer(64); viewer(65); viewer(69);
    assert.equal(house.getRoom({ plane: 1, x: 5, y: 5 }).rotation, 1, 'stale viewer actions after exit must not edit the house');
  } finally { hooks.logout(owner); }
});

test('house door preferences change models and collision for every occupant', async () => {
  const { CachePipeline } = require('../dist/game/cache/CachePipeline');
  const { RegionManager } = require('../dist/game/collision/RegionManager');
  await CachePipeline.initialize();
  require('../dist/game/definition/ObjectDefinition').ObjectDefinition.init();
  const owner = constructionPlayer('Door host', 324), hooks = constructionHooks();
  hooks.click(owner, 15478, 2); hooks.command(owner);
  const house = owner.getPrivateArea();
  const option = childId => hooks.interfaceAction({ player: owner, groupId: 370, childId, action: 1 });
  try {
    const first = house.visibleDoors[0];
    assert.ok(first);
    const closed = first.object;
    assert.notEqual(RegionManager.getClipping(closed.getLocation().x, closed.getLocation().y, closed.getLocation().z, house), 0);
    const actions = new Map();
    require('../plugins/objects/Doors.plugin.js').register(new Proxy({
      onObjectInteraction: (name, handlers) => actions.set(name, handlers),
      emitCustomEvent: (name, event) => hooks.events.get(name)?.(event),
    }, { get: (target, key) => target[key] ?? (() => {}) }));
    assert.equal(actions.get(closed.getDefinition().getName()).Open({ player: owner, object: closed,
      objectId: closed.getId(), location: closed.getLocation() }), true);
    assert.equal(first.open, true);
    option(18);
    assert.equal(house.visibleDoors.length, 0);
    assert.equal(RegionManager.getClipping(closed.getLocation().x, closed.getLocation().y, closed.getLocation().z, house), 0);
    option(16); assert.ok(house.visibleDoors.every(d => d.open));
    option(14); assert.ok(house.visibleDoors.every(d => !d.open));
    option(5); assert.equal(house.visibleDoors.length, 0, 'building mode uses door hotspots');
    option(6); assert.ok(house.visibleDoors.length > 0);
    assert.equal(JSON.parse(JSON.stringify(owner.getAttribute('construction:house'))).doorMode, 0);
  } finally { hooks.logout(owner); }
});
