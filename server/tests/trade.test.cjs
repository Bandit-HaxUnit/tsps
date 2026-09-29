// Run after `yarn build`: node --test tests/trade.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
const { Item } = require("../dist/game/model/Item");
const { PlayerStatus } = require("../dist/game/model/PlayerStatus");
const { Inventory } = require("../dist/game/model/container/impl/Inventory");
const { Trading } = require("../dist/game/content/Trading");

const LOBSTER = 379;
const COINS = 995;

// Item definitions normally come from the cache; stub the few this test uses.
const DEFINITIONS = {
  [LOBSTER]: { name: "Lobster", stackable: false },
  [COINS]: { name: "Coins", stackable: true },
};
ItemDefinition.forId = (id) => {
  const def = DEFINITIONS[id] ?? { name: "null", stackable: false };
  return {
    getId: () => id,
    getName: () => def.name,
    isStackable: () => def.stackable,
    isTradeable: () => true,
    isNoted: () => false,
  };
};

function createPlayer(name, index) {
  const messages = [];
  let status = PlayerStatus.NONE;
  let interfaceId = -1;
  // Every packet-sender call is a chainable no-op, except closing interfaces,
  // which resets the status and interface like the real sender does.
  const sender = new Proxy({}, {
    get: (_target, key) => key === "sendInterfaceRemoval"
      ? () => { status = PlayerStatus.NONE; interfaceId = -1; return sender; }
      : () => sender,
  });
  const player = {
    messages,
    getUsername: () => name,
    getIndex: () => index,
    getSession: () => ({ sendClientPacket: () => true }),
    getPacketSender: () => sender,
    sendMessage: (message) => messages.push(message),
    getStatus: () => status,
    setStatus: (next) => { status = next; },
    getInterfaceId: () => interfaceId,
    setInterfaceId: (next) => { interfaceId = next; },
    isPlayerBot: () => false,
  };
  player.inventory = new Inventory(player);
  player.inventory.resetItems();
  player.getInventory = () => player.inventory;
  player.trading = new Trading(player);
  player.getTrading = () => player.trading;
  return player;
}

function count(player, itemId) {
  return player.getInventory().getAmount(itemId);
}

function offer(player, itemId, amount) {
  const inventory = player.getInventory();
  const slot = inventory.getSlotForItemId(itemId);
  player.getTrading().handleItem(itemId, amount, slot, inventory, player.getTrading().getContainer());
}

function startTrade() {
  const alice = createPlayer("alice", 1);
  const bob = createPlayer("bob", 2);
  alice.getInventory().adds(LOBSTER, 3);
  bob.getInventory().adds(COINS, 500);
  alice.getTrading().requestTrade(bob);
  bob.getTrading().requestTrade(alice);
  offer(alice, LOBSTER, 3);
  offer(bob, COINS, 200);
  assert.equal(count(alice, LOBSTER), 0);
  assert.equal(count(bob, COINS), 300);
  return { alice, bob };
}

test("declining returns both players' offered items and ends the trade for both", () => {
  const { alice, bob } = startTrade();

  alice.getTrading().closeTrade();

  assert.equal(count(alice, LOBSTER), 3);
  assert.equal(count(bob, COINS), 500);
  for (const player of [alice, bob]) {
    assert.equal(player.getTrading().getInteract(), null);
    assert.equal(player.getStatus(), PlayerStatus.NONE);
    assert.equal(player.getTrading().getContainer().getValidItems().length, 0);
  }
  assert.ok(bob.messages.includes("Other player declined trade."));
});

test("the other player can trade again straight after a decline", () => {
  const { alice, bob } = startTrade();
  alice.getTrading().closeTrade();
  // Skip the two-second cooldown between trade requests.
  bob.getTrading().request_delay.stop();

  bob.getTrading().requestTrade(alice);

  assert.ok(!bob.messages.includes("You cannot do that right now."));
  assert.equal(bob.getTrading().getInteract(), alice);
});

test("a second decline does not return items twice", () => {
  const { alice, bob } = startTrade();

  alice.getTrading().closeTrade();
  alice.getTrading().closeTrade();
  bob.getTrading().closeTrade();

  assert.equal(count(alice, LOBSTER), 3);
  assert.equal(count(bob, COINS), 500);
});

test("closing a trade after the other player's interface was closed still returns their items", () => {
  const { alice, bob } = startTrade();
  // Closing Bob's interfaces from elsewhere resets his status, not his trade.
  bob.getPacketSender().sendInterfaceRemoval();

  alice.getTrading().closeTrade();

  assert.equal(count(bob, COINS), 500);
  assert.equal(bob.getTrading().getInteract(), null);
});
