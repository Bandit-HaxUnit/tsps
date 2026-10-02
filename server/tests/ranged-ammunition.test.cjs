// Run after `yarn build`: node --test tests/ranged-ammunition.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { Ammunition, RangedWeapon, RangedData } = require('../dist/game/content/combat/ranged/RangedData');
const { ItemIdentifiers: Items } = require('../dist/util/ItemIdentifiers');

test('dragon bolts, plain and gem-tipped, are ammunition for the dragon-tier crossbows only', () => {
  const dragonBolts = [Items.DRAGON_BOLTS_2, Items.RUBY_DRAGON_BOLTS_E_, Items.RUBY_DRAGON_BOLTS, Items.ONYX_DRAGON_BOLTS_E_, Items.OPAL_DRAGON_BOLTS];
  for (const id of dragonBolts) {
    const ammunition = Ammunition.getForItem(id);
    assert.ok(ammunition, `${id} is ammunition`);
    assert.equal(ammunition.getStrength(), 122, 'ranged strength +122 (Wiki)');
    for (const crossbow of [RangedWeapon.ARMADYL_CROSSBOW, RangedWeapon.DRAGON_CROSSBOW, RangedWeapon.ZARYTE_CROSSBOW]) {
      assert.ok(crossbow.getAmmunitionData().includes(ammunition));
    }
    assert.ok(!RangedWeapon.RUNE_CROSSBOW.getAmmunitionData().includes(ammunition), 'not below a dragon crossbow');
  }
});

test('an enchanted dragon bolt has its gem effect: ruby (e) is Blood Forfeit', () => {
  assert.equal(Ammunition.effectOf(Ammunition.ENCHANTED_RUBY_DRAGON_BOLT), Ammunition.ENCHANTED_RUBY_BOLT);
  assert.equal(Ammunition.effectOf(Ammunition.ENCHANTED_ONYX_DRAGON_BOLT), Ammunition.ENCHANTED_ONYX_BOLT);
  assert.equal(Ammunition.effectOf(Ammunition.RUBY_BOLT), Ammunition.RUBY_BOLT);

  const selfHits = [];
  const player = {
    getHitpoints: () => 90,
    getCombat: () => ({
      getAmmunition: () => Ammunition.ENCHANTED_RUBY_DRAGON_BOLT,
      getHitQueue: () => ({ addPendingDamage: (hits) => selfHits.push(...hits.map((hit) => hit.getDamage())) }),
    }),
  };
  const target = { getHitpoints: () => 300, performGraphic() {}, isPlayer: () => false };
  const multiplier = RangedData.getSpecialEffectsMultiplier(player, target, 30);
  assert.equal(Math.floor(30 * multiplier), 60, "20% of the target's current hitpoints");
  assert.deepEqual(selfHits, [9], "for 10% of the player's");

  const big = { getHitpoints: () => 2000, performGraphic() {}, isPlayer: () => false };
  assert.equal(Math.floor(40 * RangedData.getSpecialEffectsMultiplier(player, big, 40)), 100, 'capped at 100');

  const weak = { ...player, getHitpoints: () => 9 };
  assert.equal(RangedData.getSpecialEffectsMultiplier(weak, target, 30), 1, "not when the player can't spare it");
});


test('a shot refreshes the native equipment counter immediately, including the final arrow', () => {
  const { CombatFactory } = require('../dist/game/content/combat/CombatFactory');
  const { Equipment } = require('../dist/game/model/container/impl/Equipment');
  const { Item } = require('../dist/game/model/Item');
  let ammo = new Item(Items.BRONZE_ARROW, 2);
  const amounts = [];
  const equipment = {
    get: slot => slot === Equipment.AMMUNITION_SLOT ? ammo : new Item(-1, 0),
    set: (slot, item) => { assert.equal(slot, Equipment.AMMUNITION_SLOT); ammo = item; },
    refreshItems: () => amounts.push(ammo.getAmount()),
  };
  const p = { getEquipment: () => equipment, sendMessage() {},
    getCombat: () => ({ getRangedWeapon: () => RangedWeapon.SHORTBOW, getAmmunition: () => Ammunition.BRONZE_ARROW }) };
  CombatFactory.decrementAmmo(p, null, 1);
  assert.equal(ammo.getAmount(), 1); assert.deepEqual(amounts, [1]);
  CombatFactory.decrementAmmo(p, null, 1);
  assert.equal(ammo.getId(), -1); assert.equal(amounts.length, 2);
});
