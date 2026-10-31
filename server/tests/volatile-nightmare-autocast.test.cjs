// Run after `yarn build`: node --test tests/volatile-nightmare-autocast.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CombatFactory } = require("../dist/game/content/combat/CombatFactory");
const { CombatSpecial } = require("../dist/game/content/combat/CombatSpecial");
const { CombatType } = require("../dist/game/content/combat/CombatType");
const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");

const core = PluginManager.getCoreApi();
require("../plugins/combat/specials/VolatileNightmareStaff.SpecialAttack")({
  core,
  registerCombatSpecial: CombatSpecial.register,
});

const WEAPON_ID = ItemIdentifiers.VOLATILE_NIGHTMARE_STAFF;

function player({ autocast = true, activated = true } = {}) {
  const weapon = { getId: () => WEAPON_ID };
  const items = Array.from({ length: 14 }, () => ({ getId: () => -1 }));
  items[Equipment.WEAPON_SLOT] = weapon;
  const combat = {
    getAmmunition: () => null,
    setAmmunition() {},
    getRangedWeapon: () => null,
    setRangedWeapon() {},
    getCastSpell: () => null,
    getAutocastSpell: () => autocast ? { name: "Fire Strike" } : null,
    getTarget: () => null,
  };
  const p = {
    isPlayer: () => true,
    isNpc: () => false,
    getAsPlayer: () => p,
    getCombat: () => combat,
    getEquipment: () => ({ hasStaffEquipped: () => true, getItems: () => items, get: () => weapon }),
    getCombatSpecial: () => CombatSpecial.getForWeaponId(WEAPON_ID),
    isSpecialActivated: () => activated,
  };
  return p;
}

test("Volatile Nightmare staff special overrides an active autocast", () => {
  const special = CombatSpecial.getForWeaponId(WEAPON_ID);
  assert.ok(special, "the Volatile special is registered");

  const method = CombatFactory.getMethod(player({ autocast: true, activated: true }));
  assert.equal(method, special.getCombatMethod(), "the activated special owns the swing");
  assert.equal(method.type(), CombatType.MAGIC);
});

test("without the special activated, the same staff still autocasts", () => {
  const method = CombatFactory.getMethod(player({ autocast: true, activated: false }));
  assert.equal(method, CombatFactory.MAGIC_COMBAT, "ordinary autocast keeps using the spell method");
});

test("without autocast, the activated special is still selected", () => {
  const special = CombatSpecial.getForWeaponId(WEAPON_ID);
  const method = CombatFactory.getMethod(player({ autocast: false, activated: true }));
  assert.equal(method, special.getCombatMethod());
});
