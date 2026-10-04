/**
 * Demonbane melee and ranged weapons against demons (Wiki: Demonbane weapons;
 * order and rounding from the Wiki DPS calculator): accuracy and damage each gain
 * a percentage of themselves, rounded down.
 * - Arclight and Emberlight 70%, Silverlight and Darklight 60%, bone and burning claws 5%.
 * - Scorching bow 30% (ranged).
 * Not modelled: bosses with reduced demonbane effectiveness (Duke Sucellus takes 70% of it).
 */
const { asPlayer, weaponName, targetHasAttribute, addPercent } = require("./GearChecks");

const MELEE_PERCENT = new Map([
  ["arclight", 70],
  ["emberlight", 70],
  ["silverlight", 60],
  ["silverlight (dyed)", 60],
  ["darklight", 60],
  ["bone claws", 5],
  ["burning claws", 5],
]);
const RANGED_PERCENT = new Map([["scorching bow", 30]]);

function percentFor(entity, table) {
  const player = asPlayer(entity);
  if (!player) return 0;
  const percent = table.get(weaponName(player)) ?? 0;
  return percent > 0 && targetHasAttribute(entity, "demon") ? percent : 0;
}

function meleeDemonbane(entity, value) {
  const percent = percentFor(entity, MELEE_PERCENT);
  return percent > 0 ? addPercent(value, percent) : value;
}

function rangedDemonbane(entity, value) {
  const percent = percentFor(entity, RANGED_PERCENT);
  return percent > 0 ? addPercent(value, percent) : value;
}

module.exports = function registerDemonbaneEffects(api) {
  api.registerMeleeAttackAccuracyModifier(meleeDemonbane);
  api.registerMeleeHitModifier(meleeDemonbane);
  api.registerRangedAttackAccuracyModifier(rangedDemonbane);
  api.registerRangedHitModifier(rangedDemonbane);
};

module.exports._test = { meleeDemonbane, rangedDemonbane };
