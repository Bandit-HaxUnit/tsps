/**
 * The Ranged masteries (https://oldschool.runescape.wiki/w/Ranged_I .. Ranged_VI): I a landed
 * roll below 30% of the max hit becomes 30%; II every ranged attack after the first raises the max
 * hit another 5%, back to nothing after +20% (counted as the attack is made, so the roll that
 * follows sees it); IV every fifth landed ranged hit heals 5 hitpoints a hitsplat; VI a ranged
 * attack on an NPC never misses. The attack rates (III, V) are AttackRate.LeagueCombatMasteries.js.
 */
const Common = require("./Common.LeagueCombatMasteries");
const Passives = require("./Passives.LeagueCombatMasteries");

let core;

/** Ranged II: attacks made since the bonus last reset (0-4), and the bonus steps of the attack under way. */
const streak = new WeakMap();
const steps = new WeakMap();
/** Ranged IV: landed ranged hits since the last heal. */
const landed = new WeakMap();

const RANGED = () => core.CombatType.RANGED;

function attackSpeed({ attacker, combatType }) {
  if (combatType !== RANGED()) return;
  const second = Common.effect(attacker, "ranged", 2);
  if (!second) {
    streak.delete(attacker);
    steps.delete(attacker);
    return;
  }
  const limit = Math.round(second.maxHitCap / second.maxHitStep);
  const current = streak.get(attacker) ?? 0;
  steps.set(attacker, current);
  streak.set(attacker, current >= limit ? 0 : current + 1);
}

const maxHitModifier = {
  modifyMaxHit(attacker, _target, maxHit) {
    const second = Common.effect(attacker, "ranged", 2);
    if (!second) return null;
    const percent = Math.round(second.maxHitStep * 100) * (steps.get(attacker) ?? 0);
    return Math.floor((maxHit * (100 + percent)) / 100);
  },
  modifyAttackRoll() {
    return null;
  },
};

/** Ranged I: a landed roll below 30% of the max hit (what a protection prayer leaves of it) is raised to it. */
function damage(event) {
  if (event.combatType !== RANGED() || !event.accurate) return;
  const first = Common.effect(event.attacker, "ranged", 1);
  if (!first) return;
  const max = Common.maxHit(event.attacker, RANGED());
  const floor = Math.floor(Math.floor(max * first.minimumFraction) * Passives.damageFactor(event.attacker, event.target, RANGED()));
  if (event.damage.getDamage() < floor) event.damage.setDamage(floor);
}

function resolved({ attacker, hit }) {
  if (hit.getCombatType() !== RANGED() || !hit.isAccurate()) return;
  const fourth = Common.effect(attacker, "ranged", 4);
  if (!fourth) {
    landed.delete(attacker);
    return;
  }
  const count = (landed.get(attacker) ?? 0) + 1;
  if (count < fourth.everyHits) {
    landed.set(attacker, count);
    return;
  }
  landed.set(attacker, 0);
  attacker.heal(fourth.heal * Math.max(1, hit.getHits?.()?.length ?? 1));
}

function neverMiss(roll) {
  if (roll.combatType !== RANGED() || !roll.target?.isNpc?.()) return;
  if (Common.effect(roll.attacker, "ranged", 6)?.neverMiss) roll.forceAccurate = true;
}

module.exports = function attach(api) {
  core = api.core;
  api.onAttackSpeed(attackSpeed);
  api.registerRangedCombatModifier(maxHitModifier);
  api.onCombatHitDamage(damage);
  api.onCombatHitResolved(resolved);
  api.onCombatHitRoll(neverMiss);
};
