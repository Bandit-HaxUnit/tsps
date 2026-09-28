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
    sendVarbit(id, value) { assert.equal(id, 2183); locked = value; },
  };
  const player = {
    getPrivateArea: () => house,
    getPacketSender: () => sender,
    sendMessage: message => messages.push(message),
    setAttribute() {},
  };
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
          for (const hotspot of templates.filter(object => object.sourceChunkX === 232 && object.sourceChunkY === 887)) {
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
