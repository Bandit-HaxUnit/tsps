// Run after `yarn build`: node --test tests/ring-of-suffering.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { ItemIds } = require("../dist/util/IdEnums");

const RingOfSuffering = require("../plugins/items/RingOfSuffering.plugin");

let incoming;
RingOfSuffering.register({
  core: { ItemIdentifiers: ItemIds },
  registerIncomingDamageModifier: (modifier) => { incoming = modifier; },
  onItemAction() {},
  onItemOnItem() {},
  persistAttribute() {},
});

function item(id, meta = {}) {
  return {
    id,
    meta: { ...meta },
    getId() { return this.id; },
    setId(next) { this.id = next; },
    getMetaValue(key) { return this.meta[key]; },
    setMetaValue(key, next) {
      if (next === undefined) delete this.meta[key];
      else this.meta[key] = next;
    },
  };
}

function createPlayer({ ring = null, disabled = false } = {}) {
  const equipment = new Array(14).fill(null).map(() => item(0));
  if (ring) equipment[Equipment.RING_SLOT] = ring;
  const attributes = new Map();
  if (disabled) attributes.set("ring-of-suffering:recoil-disabled", true);
  const messages = [];
  return {
    attributes,
    messages,
    getEquipment: () => ({ get: (slot) => equipment[slot], refreshItems: () => {} }),
    getInventory: () => ({ deleteNumber: () => {}, refreshItems: () => {} }),
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getCombat: () => ({ getHitQueue: () => ({ addPendingDamage: (hits) => { this.pending = hits; } }), getTarget: () => null }),
    sendMessage: (message) => messages.push(message),
    isPlayer: () => true,
    getAsPlayer() { return this; },
  };
}

function attacker() {
  const pending = [];
  return { pending, getCombat: () => ({ getHitQueue: () => ({ addPendingDamage: (hits) => pending.push(...hits) }) }) };
}

test("rings of recoil charge the ring and switch it to (r)", () => {
  const ring = item(ItemIds.RING_OF_SUFFERING);
  const player = createPlayer({ ring });
  RingOfSuffering._test.chargeRing({
    player,
    usedItem: ring,
    usedWithItem: item(ItemIds.RING_OF_RECOIL),
    usedItemId: ItemIds.RING_OF_SUFFERING,
    usedWithItemId: ItemIds.RING_OF_RECOIL,
    handled: false,
  });
  assert.equal(ring.getId(), ItemIds.RING_OF_SUFFERING_R_);
  assert.equal(RingOfSuffering._test.charges(ring), 40);
});

test("a recoil proc deals 10% + 1 and spends a charge", () => {
  const ring = item(ItemIds.RING_OF_SUFFERING_R_, { "ring-of-suffering": 5 });
  const player = createPlayer({ ring });
  const enemy = attacker();
  const original = Math.random;
  try {
    Math.random = () => 0.9; // not the 1-in-3 fizzle
    incoming(player, { getDamage: () => 100 }, { attacker: enemy });
  } finally {
    Math.random = original;
  }
  assert.equal(enemy.pending.length, 1);
  assert.equal(enemy.pending[0].getDamage(), 11);
  assert.equal(RingOfSuffering._test.charges(ring), 4);

  ring.setMetaValue("ring-of-suffering", 1);
  incoming(player, { getDamage: () => 10 }, { attacker: attacker() });
  assert.equal(ring.getId(), ItemIds.RING_OF_SUFFERING, "the last charge reverts the ring");
});

test("the toggle disables the effect and the fizzle rolls nothing", () => {
  const ring = item(ItemIds.RING_OF_SUFFERING_R_, { "ring-of-suffering": 5 });
  const disabled = createPlayer({ ring, disabled: true });
  incoming(disabled, { getDamage: () => 100 }, { attacker: attacker() });
  assert.equal(RingOfSuffering._test.charges(ring), 5, "disabled spends nothing");

  const player = createPlayer({ ring });
  const enemy = attacker();
  const original = Math.random;
  try {
    Math.random = () => 0.1; // hits the 2 in floor(random*3)+1 === 2? 0.1 -> 1, not 2
    incoming(player, { getDamage: () => 100 }, { attacker: enemy });
  } finally {
    Math.random = original;
  }
  assert.equal(enemy.pending.length, 1);

  const fizzle = createPlayer({ ring });
  const fizzleEnemy = attacker();
  try {
    Math.random = () => 0.4; // floor(0.4*3)+1 = 2 -> fizzle
    incoming(fizzle, { getDamage: () => 100 }, { attacker: fizzleEnemy });
  } finally {
    Math.random = original;
  }
  assert.equal(fizzleEnemy.pending.length, 0, "the one-in-three fizzle deals nothing");
  assert.equal(RingOfSuffering._test.charges(ring), 4, "no charge is spent on a fizzle");
});
