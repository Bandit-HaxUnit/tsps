// Run after `yarn build`: node --test tests/salve-amulet.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { Skill } = require("../dist/game/model/Skill");
const { ItemIds } = require("../dist/util/IdEnums");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");

const registerSalve = require("../plugins/combat/effects/SalveAmulet");
const registerJusticiar = require("../plugins/combat/effects/JusticiarArmour");

function undeadTarget(undead) {
  return {
    isNpc: () => true,
    getAsNpc: () => ({ getCurrentDefinition: () => ({ isUndead: () => undead }) }),
  };
}

function createPlayer({ amulet = -1, undead = true } = {}) {
  return {
    isPlayer: () => true,
    getAsPlayer() { return this; },
    getEquipment: () => ({ get: (slot) => (slot === Equipment.AMULET_SLOT ? { getId: () => amulet } : null) }),
    getCombat: () => ({ getTarget: () => undeadTarget(undead) }),
  };
}

const salve = {};
registerSalve({
  registerMeleeAttackAccuracyModifier: (fn) => { salve.meleeAccuracy = fn; },
  registerMeleeHitModifier: (fn) => { salve.meleeHit = fn; },
  registerRangedAttackAccuracyModifier: (fn) => { salve.rangedAccuracy = fn; },
  registerRangedHitModifier: (fn) => { salve.rangedHit = fn; },
  registerMagicAttackAccuracyModifier: (fn) => { salve.magicAccuracy = fn; },
  registerMagicHitModifier: (fn) => { salve.magicHit = fn; },
});
void registerJusticiar;

test("salve amulets boost the right styles against undead only", () => {
  const base = createPlayer({ amulet: ItemIds.SALVE_AMULET });
  assert.ok(Math.abs(salve.meleeHit(base, 600) - 700) < 1e-9, "1/6 melee");
  assert.equal(salve.rangedHit(base, 100), 100, "plain salve does not help ranged");
  assert.equal(salve.magicHit(base, 100), 100);

  const enchanted = createPlayer({ amulet: ItemIds.SALVE_AMULET_E_ });
  assert.equal(salve.meleeHit(enchanted, 100), 120, "20% melee");
  assert.equal(salve.rangedHit(enchanted, 100), 100);

  const imbued = createPlayer({ amulet: ItemIds.SALVE_AMULET_I_ });
  assert.ok(Math.abs(salve.rangedHit(imbued, 100) - 116.666) < 0.01);
  assert.ok(Math.abs(salve.magicHit(imbued, 100) - 115) < 1e-9, "15% magic");
  assert.ok(Math.abs(salve.magicAccuracy(imbued, 100) - 115) < 1e-9);

  const enchantedImbued = createPlayer({ amulet: ItemIds.SALVE_AMULET_EI_ });
  assert.equal(salve.rangedHit(enchantedImbued, 100), 120);
  assert.equal(salve.magicHit(enchantedImbued, 100), 120);

  const living = createPlayer({ amulet: ItemIds.SALVE_AMULET_EI_, undead: false });
  assert.equal(salve.meleeHit(living, 100), 100, "not undead, no bonus");
  assert.equal(salve.magicHit(createPlayer({ amulet: -1 }), 100), 100, "no amulet, no bonus");
});

test("a salve amulet suppresses the slayer helmet bonus on undead targets", () => {
  const names = new Map([
    [ItemIdentifiers.SLAYER_HELMET, "Slayer helmet"],
    [ItemIdentifiers.SALVE_AMULET_E_, "Salve amulet (e)"],
  ]);
  const modifiers = {};
  const SlayerHelmet = require("../plugins/items/SlayerHelmet.plugin");
  SlayerHelmet.register({
    core: {
      ItemIdentifiers,
      Skill,
      Equipment: { HEAD_SLOT: 0, AMULET_SLOT: Equipment.AMULET_SLOT },
      ItemDefinition: { forId: (id) => ({ getName: () => names.get(id) ?? "" }) },
    },
    emitCustomEvent: (name, request) => { if (name === "slayer:on-task") request.onTask = true; },
    registerMeleeAttackAccuracyModifier: (fn) => { modifiers.meleeAccuracy = fn; },
    registerMeleeHitModifier: (fn) => { modifiers.meleeHit = fn; },
    registerRangedAttackAccuracyModifier: (fn) => { modifiers.rangedAccuracy = fn; },
    registerRangedHitModifier: (fn) => { modifiers.rangedHit = fn; },
    registerMagicAttackAccuracyModifier: (fn) => { modifiers.magicAccuracy = fn; },
    registerMagicHitModifier: (fn) => { modifiers.magicHit = fn; },
    onItemOnItem() {},
    onItemAction() {},
  });

  const equipment = new Array(14).fill(null).map(() => ({ getId: () => 0 }));
  equipment[0] = { getId: () => ItemIdentifiers.SLAYER_HELMET };
  equipment[Equipment.AMULET_SLOT] = { getId: () => ItemIdentifiers.SALVE_AMULET_E_ };
  const undead = {
    isPlayer: () => true,
    getAsPlayer() { return this; },
    getEquipment: () => ({ getItems: () => equipment }),
    getCombat: () => ({ getTarget: () => undeadTarget(true) }),
  };
  assert.equal(modifiers.meleeHit(undead, 42), 42, "salve wins, no slayer helmet stack");

  const living = {
    ...undead,
    getCombat: () => ({ getTarget: () => undeadTarget(false) }),
  };
  assert.equal(modifiers.meleeHit(living, 42), 49, "against living targets the helmet still applies");
});
