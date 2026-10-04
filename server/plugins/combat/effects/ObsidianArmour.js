const { CombatEquipment } = require("../../../src/main/typescript/elvarg/game/content/combat/CombatEquipment");
const { Equipment } = require("../../../src/main/typescript/elvarg/game/model/container/impl/Equipment");
const { ItemIdentifiers } = require("../../../src/main/typescript/elvarg/util/ItemIdentifiers");

// Wiki: the berserker necklace gives +20% melee damage with an obsidian weapon,
// and the obsidian armour set (helm, body, legs) gives a further +10% melee
// accuracy and damage. Both need an obsidian weapon and stack.
const NECKLACE_MULTIPLIER = 1.20;
const SET_MULTIPLIER = 1.10;

const OBSIDIAN_SET = new Map([
  [Equipment.HEAD_SLOT, ItemIdentifiers.OBSIDIAN_HELMET],
  [Equipment.BODY_SLOT, ItemIdentifiers.OBSIDIAN_PLATEBODY],
  [Equipment.LEG_SLOT, ItemIdentifiers.OBSIDIAN_PLATELEGS],
]);

function wieldingObsidianWeapon(player) {
  const weaponId = player.getEquipment().getItems()[Equipment.WEAPON_SLOT]?.getId?.();
  return CombatEquipment.OBSIDIAN_WEAPONS.includes(weaponId);
}

function wearingObsidianSet(player) {
  const items = player.getEquipment().getItems();
  for (const [slot, itemId] of OBSIDIAN_SET) {
    if (items[slot]?.getId?.() !== itemId) {
      return false;
    }
  }
  return true;
}

function obsidianPlayer(entity) {
  if (!entity?.isPlayer?.()) {
    return null;
  }
  const player = entity.getAsPlayer();
  return wieldingObsidianWeapon(player) ? player : null;
}

function applyObsidianDamage(entity, baseHit) {
  const player = obsidianPlayer(entity);
  if (!player) {
    return baseHit;
  }
  let hit = baseHit;
  if (CombatEquipment.wearingObsidian(player)) {
    hit *= NECKLACE_MULTIPLIER;
  }
  if (wearingObsidianSet(player)) {
    hit *= SET_MULTIPLIER;
  }
  return hit;
}

function applyObsidianAccuracy(entity, value) {
  const player = obsidianPlayer(entity);
  return player && wearingObsidianSet(player) ? value * SET_MULTIPLIER : value;
}

module.exports = function registerObsidianEffects(api) {
  api.registerMeleeHitModifier(applyObsidianDamage);
  api.registerMeleeAttackAccuracyModifier(applyObsidianAccuracy);
};
