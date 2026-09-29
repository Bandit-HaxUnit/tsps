// Run after `yarn build`: node --test tests/bank.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
const { Item } = require("../dist/game/model/Item");
const { Inventory } = require("../dist/game/model/container/impl/Inventory");
const { Bank } = require("../dist/game/model/container/impl/Bank");
const { PlayerStatus } = require("../dist/game/model/PlayerStatus");

const TRIDENT = 11907;
const LAVA_BATTLESTAFF = 3053;
const MYSTIC_LAVA_STAFF = 3054;
// In the cache this note belongs to 3053, not to 3054 (its id minus one).
const LAVA_BATTLESTAFF_NOTE = 3055;

// Item definitions normally come from the cache; stub the few this test uses.
const DEFINITIONS = {
  [TRIDENT]: { name: "Trident of the seas" },
  [LAVA_BATTLESTAFF]: { name: "Lava battlestaff" },
  [MYSTIC_LAVA_STAFF]: { name: "Mystic lava staff" },
  [LAVA_BATTLESTAFF_NOTE]: { name: "Lava battlestaff", stackable: true, noteOf: LAVA_BATTLESTAFF },
};
ItemDefinition.forId = (id) => {
  const def = DEFINITIONS[id] ?? { name: "null" };
  return {
    getId: () => id,
    getName: () => def.name,
    isStackable: () => def.stackable === true,
    isNoted: () => def.noteOf != null,
    unNote: () => def.noteOf ?? id,
    getNoteId: () => -1,
    isTradeable: () => true,
  };
};

function createPlayer() {
  // Every packet-sender call is a chainable no-op.
  const sender = new Proxy({}, { get: () => () => sender });
  let currentTab = 0;
  const messages = [];
  const player = {
    messages,
    getUsername: () => "alice",
    sendMessage: (message) => messages.push(message),
    isSearchingBank: () => false,
    getPacketSender: () => sender,
    getStatus: () => PlayerStatus.BANKING,
    getInterfaceId: () => Bank.MAIN_INTERFACE_ID,
    getCurrentBankTab: () => currentTab,
    setCurrentBankTab: (tab) => { currentTab = tab; },
    withdrawAsNote: () => false,
    isPlaceholders: () => false,
    isPlayerBot: () => false,
  };
  player.inventory = new Inventory(player);
  player.inventory.resetItems();
  player.banks = Array.from({ length: Bank.TOTAL_BANK_TABS }, () => new Bank(player).resetItems());
  player.getInventory = () => player.inventory;
  player.getBank = (tab = 0) => player.banks[tab];
  player.setBank = (tab, bank) => { player.banks[tab] = bank; };
  return player;
}

test("depositing a note banks the item it notes, not the item before it", () => {
  const player = createPlayer();
  player.getInventory().add(new Item(LAVA_BATTLESTAFF_NOTE, 2), false);

  player.getInventory().switchItem(player.getBank(), new Item(LAVA_BATTLESTAFF_NOTE, 2), false, 0, false);

  assert.equal(player.getBank().getAmount(LAVA_BATTLESTAFF), 2);
  assert.equal(player.getBank().getAmount(MYSTIC_LAVA_STAFF), 0);
  assert.equal(player.getBank().getAmount(LAVA_BATTLESTAFF_NOTE), 0);
});

test("depositing everything banks notes as the item they note", () => {
  const player = createPlayer();
  player.getInventory().add(new Item(LAVA_BATTLESTAFF_NOTE, 3), false);
  const item = player.getInventory().getValidItems()[0];

  // What Deposit inventory does for each inventory item.
  player.getInventory().switchItems(player.getBank(), item.clone(), false, false);

  assert.equal(player.getBank().getAmount(LAVA_BATTLESTAFF), 3);
  assert.equal(player.getBank().getAmount(LAVA_BATTLESTAFF_NOTE), 0);
  assert.equal(player.getInventory().getAmount(LAVA_BATTLESTAFF_NOTE), 0);
});

function metas(container) {
  return container.getValidItems().map((item) => [item.getAmount(), item.getMeta()]);
}

test("depositing items keeps each one's metadata", () => {
  const player = createPlayer();
  player.getInventory().add(new Item(TRIDENT, 1, { charges: 5 }), false);
  player.getInventory().add(new Item(TRIDENT, 1, { charges: 1200 }), false);

  Bank.deposit(player, TRIDENT, 1, 2, true);

  assert.deepEqual(metas(player.getBank(0)), [[1, { charges: 1200 }], [1, { charges: 5 }]]);
  assert.equal(player.getInventory().getValidItems().length, 0);
});

test("withdrawing an item keeps its metadata", () => {
  const player = createPlayer();
  player.getBank(0).add(new Item(TRIDENT, 1, { charges: 1200 }), false);

  Bank.withdraw(player, TRIDENT, 0, 1, 0);

  assert.deepEqual(metas(player.getInventory()), [[1, { charges: 1200 }]]);
  assert.equal(player.getBank(0).getAmount(TRIDENT), 0);
});

test("a full bank tab refuses the item instead of throwing", () => {
  const player = createPlayer();
  const bank = player.getBank(0);
  for (let slot = 0; slot < bank.capacity(); slot++) bank.add(new Item(20000 + slot, 1), false);
  player.getInventory().add(new Item(TRIDENT, 1), false);

  assert.doesNotThrow(() => player.getInventory().switchItem(bank, new Item(TRIDENT, 1), false, 0, false));

  assert.ok(player.messages.includes("Not enough space in bank."));
  assert.equal(player.getInventory().getAmount(TRIDENT), 1);
});
