// Run after `yarn build`: node --test tests/shops.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
const { ShopDefinition } = require("../dist/game/definition/ShopDefinition");
const { Item } = require("../dist/game/model/Item");
const { PlayerStatus } = require("../dist/game/model/PlayerStatus");
const { Inventory } = require("../dist/game/model/container/impl/Inventory");
const { ShopManager } = require("../dist/game/model/container/shop/ShopManager");

const COINS = 995;
const BRONZE_AXE = 1351;
const STEEL_AXE = 1353;

// Item definitions normally come from the cache; stub the few this test uses.
const DEFINITIONS = {
  [COINS]: { name: "Coins", stackable: true, value: 1 },
  [BRONZE_AXE]: { name: "Bronze axe", value: 16 },
  [STEEL_AXE]: { name: "Steel axe", value: 200 },
};
ItemDefinition.forId = (id) => {
  const def = DEFINITIONS[id] ?? { name: "null", value: 0 };
  return {
    getId: () => id,
    getName: () => def.name,
    getExamine: () => "",
    isStackable: () => def.stackable === true,
    isNoted: () => def.noteOf != null,
    unNote: () => def.noteOf ?? id,
    getNoteId: () => -1,
    getValue: () => def.value,
    isTradeable: () => true,
    isSellable: () => true,
  };
};

const AXE_SHOP = 900;

function loadShops() {
  ShopDefinition.replace([
    new ShopDefinition(AXE_SHOP, "Bob's Brilliant Axes", "COINS", [
      { id: BRONZE_AXE, amount: 2, restockTicks: null, price: null },
      { id: STEEL_AXE, amount: 1, restockTicks: null, price: null },
    ], 100, 100, 100, "test"),
  ]);
  ShopManager.reload();
}

function createPlayer() {
  // Every packet-sender call is a chainable no-op.
  const sender = new Proxy({}, { get: () => () => sender });
  const messages = [];
  let status = PlayerStatus.NONE;
  let interfaceId = -1;
  const player = {
    messages,
    getUsername: () => "alice",
    sendMessage: (message) => messages.push(message),
    getPacketSender: () => sender,
    getSession: () => ({ sendClientPacket: () => true }),
    getStatus: () => status,
    setStatus: (next) => { status = next; },
    getInterfaceId: () => interfaceId,
    setInterfaceId: (next) => { interfaceId = next; },
    isPlayerBot: () => false,
  };
  player.inventory = new Inventory(player);
  player.inventory.resetItems();
  player.getInventory = () => player.inventory;
  return player;
}

function openShop(coins = 10000) {
  loadShops();
  const player = createPlayer();
  if (coins > 0) player.getInventory().add(new Item(COINS, coins), false);
  ShopManager.open(player, AXE_SHOP);
  return player;
}

function buy(player, displaySlot, itemId, option = "Buy 1") {
  ShopManager.handleWidgetAction(player, {
    groupId: ShopManager.MAIN_INTERFACE_ID, childId: 16, buttonNum: 0, option, slot: displaySlot + 1, itemId,
  });
}

test("a specialist shop sells its last item", () => {
  const player = openShop();

  buy(player, 1, STEEL_AXE);

  assert.equal(player.getInventory().getAmount(STEEL_AXE), 1);
});
