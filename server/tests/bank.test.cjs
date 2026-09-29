// Run after `yarn build`: node --test tests/bank.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
const { Item } = require("../dist/game/model/Item");
const { Inventory } = require("../dist/game/model/container/impl/Inventory");
const { Bank } = require("../dist/game/model/container/impl/Bank");

const LAVA_BATTLESTAFF = 3053;
const MYSTIC_LAVA_STAFF = 3054;
// In the cache this note belongs to 3053, not to 3054 (its id minus one).
const LAVA_BATTLESTAFF_NOTE = 3055;

// Item definitions normally come from the cache; stub the few this test uses.
const DEFINITIONS = {
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
    isTradeable: () => true,
  };
};

function createPlayer() {
  const player = {
    getUsername: () => "alice",
    sendMessage: () => {},
    isSearchingBank: () => false,
  };
  player.inventory = new Inventory(player);
  player.inventory.resetItems();
  player.bank = new Bank(player);
  player.bank.resetItems();
  player.getInventory = () => player.inventory;
  player.getBank = () => player.bank;
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
