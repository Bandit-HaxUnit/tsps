/**
 * The Magic masteries (https://oldschool.runescape.wiki/w/Magic_I .. Magic_VI): I a landed roll
 * above 90% of the max hit deals 50% more; II the max hit rises 5% for every idle tick between two
 * magic attacks, up to +40% (our reading of "per tick in-between": the gap less the attack's own
 * tick); IV a roll above 90% heals 10% of the damage when the hit lands; VI the max hit rises 1%
 * for every 100 hitpoints the target has, up to +10%, and a target with fewer hitpoints than the
 * max hit (before Magic I, Wiki) takes the max hit. The max hit changes ride the core's
 * `combat:magic-max-hit` request, so every magic max hit (and Magic I's threshold) includes them.
 * The attack rates (III, V) are AttackRate.LeagueCombatMasteries.js.
 */
const Common = require("./Common.LeagueCombatMasteries");
const Passives = require("./Passives.LeagueCombatMasteries");

let core;

/** Magic II: the cycle of each player's last magic attack, and the bonus (in percent) of the attack under way. */
const lastCast = new WeakMap();
const bonus = new WeakMap();
/** Hits whose roll was above 90% of the max hit (Magic IV heals when they land). */
const highRolls = new WeakSet();

const MAGIC = () => core.CombatType.MAGIC;

function attackSpeed({ attacker, combatType }) {
  if (combatType !== MAGIC()) return;
  const cycle = core.World.getProcessCycle();
  const second = Common.effect(attacker, "magic", 2);
  if (second) {
    const previous = lastCast.get(attacker);
    const idle = previous === undefined ? 0 : Math.max(0, cycle - previous - 1);
    bonus.set(attacker, Math.min(Math.round(second.cap * 100), idle * Math.round(second.perTick * 100)));
  } else {
    bonus.delete(attacker);
  }
  lastCast.set(attacker, cycle);
}

function maxHit(request) {
  const { attacker, target } = request ?? {};
  if (!attacker?.isPlayer?.() || !Common.isEchoes(attacker)) return;
  let percent = 0;
  if (Common.effect(attacker, "magic", 2)) percent += bonus.get(attacker) ?? 0;
  const sixth = Common.effect(attacker, "magic", 6);
  if (sixth && typeof target?.getHitpoints === "function") {
    const stepPercent = Math.round(sixth.perStep * 100);
    percent += Math.min(Math.round(sixth.cap * 100), Math.floor(target.getHitpoints() / sixth.perHitpoints) * stepPercent);
  }
  if (percent > 0) request.maxHit = Math.floor((request.maxHit * (100 + percent)) / 100);
}

/** Magic I and the mark for Magic IV: a landed roll above 90% of what the max hit would deal. */
function damage(event) {
  if (event.combatType !== MAGIC() || !event.accurate) return;
  const first = Common.effect(event.attacker, "magic", 1);
  const fourth = Common.effect(event.attacker, "magic", 4);
  if (!first && !fourth) return;
  const max = Common.maxHit(event.attacker, MAGIC()) * Passives.damageFactor(event.attacker, event.target, MAGIC());
  const fraction = (first ?? fourth).highRollFraction;
  if (event.damage.getDamage() <= Math.floor(max * fraction)) return;
  if (first) event.damage.setDamage(Math.floor(event.damage.getDamage() * first.damageMultiplier));
  if (fourth && event.hit) highRolls.add(event.hit);
}

function resolved({ attacker, hit }) {
  if (!highRolls.has(hit)) return;
  highRolls.delete(hit);
  const fourth = Common.effect(attacker, "magic", 4);
  if (fourth && hit.isAccurate()) attacker.heal(Math.floor(hit.getTotalDamage() * fourth.healFraction));
}

/** Magic VI's execute: a target with fewer hitpoints than the max hit takes it (on an accurate roll). */
function execute(roll) {
  if (roll.combatType !== MAGIC() || !Common.effect(roll.attacker, "magic", 6)?.execute) return;
  if (roll.target.getHitpoints() < Common.maxHit(roll.attacker, MAGIC())) roll.forceMaxHit = true;
}

module.exports = function attach(api) {
  core = api.core;
  api.onAttackSpeed(attackSpeed);
  api.onCustomEvent("combat:magic-max-hit", maxHit);
  api.onCombatHitDamage(damage);
  api.onCombatHitResolved(resolved);
  api.onCombatHitRoll(execute);
};
