const { Equipment } = require("../../../src/main/typescript/elvarg/game/model/container/impl/Equipment");
const { ItemIdentifiers } = require("../../../src/main/typescript/elvarg/util/ItemIdentifiers");

// Wiki: melee 1/6, ranged 1/6 and magic 15% against undead; the enchanted
// variants push melee to 20% and (ei) every style to 20%. The bonus does not
// stack with the black mask/slayer helmet (the SlayerHelmet plugin suppresses
// its own bonus when a salve amulet is worn against an undead target).
const AMULETS = new Map([
  [ItemIdentifiers.SALVE_AMULET, { melee: 1 / 6 }],
  [ItemIdentifiers.SALVE_AMULET_E_, { melee: 0.20 }],
  [ItemIdentifiers.SALVE_AMULET_I_, { melee: 1 / 6, ranged: 1 / 6, magic: 0.15 }],
  [ItemIdentifiers.SALVE_AMULET_EI_, { melee: 0.20, ranged: 0.20, magic: 0.20 }],
]);

function isUndead(target) {
  return target?.isNpc?.() && target.getAsNpc()?.getCurrentDefinition?.()?.isUndead?.() === true;
}

function undeadBonus(entity, style) {
  if (!entity?.isPlayer?.()) {
    return 0;
  }
  const player = entity.getAsPlayer();
  const amuletId = Number(player.getEquipment().get(Equipment.AMULET_SLOT)?.getId?.() ?? -1);
  const entry = AMULETS.get(amuletId);
  if (!entry || !isUndead(entity.getCombat?.()?.getTarget?.())) {
    return 0;
  }
  return entry[style] ?? 0;
}

function applyBonus(entity, value, style) {
  const bonus = undeadBonus(entity, style);
  return bonus > 0 ? value * (1 + bonus) : value;
}

module.exports = function registerSalveAmuletEffects(api) {
  api.registerMeleeAttackAccuracyModifier((entity, value) => applyBonus(entity, value, "melee"));
  api.registerMeleeHitModifier((entity, value) => applyBonus(entity, value, "melee"));
  api.registerRangedAttackAccuracyModifier((entity, value) => applyBonus(entity, value, "ranged"));
  api.registerRangedHitModifier((entity, value) => applyBonus(entity, value, "ranged"));
  api.registerMagicAttackAccuracyModifier((entity, value) => applyBonus(entity, value, "magic"));
  api.registerMagicHitModifier((entity, value) => applyBonus(entity, value, "magic"));
};
