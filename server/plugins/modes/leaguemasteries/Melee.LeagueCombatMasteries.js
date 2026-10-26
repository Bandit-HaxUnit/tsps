/**
 * The Melee masteries (https://oldschool.runescape.wiki/w/Melee_I .. Melee_VI): I a 25% chance to
 * roll the damage twice and keep the higher; II a 10% chance that a melee attack on an NPC is
 * followed by an echo hit, a melee hit of its own accuracy rolled from half the max hit, a tick
 * later, with the captured echo projectile; IV a 5% chance that a landed hit heals 40% of its
 * damage; VI echoes on 20% of attacks and lets an echo echo in turn, up to eight in a row. The
 * attack rates (III, V) are AttackRate.LeagueCombatMasteries.js.
 */
const Common = require("./Common.LeagueCombatMasteries");
const Passives = require("./Passives.LeagueCombatMasteries");

let core;

/** Echo hits this unit queued, and how many echoes deep they are (1 for an echo of a real hit). */
const echoes = new WeakMap();
/** The echo being built: its depth, while its PendingHit rolls (the damage hook runs inside the constructor). */
let building = null;
let side = 0;

const MELEE = () => core.CombatType.MELEE;

/** Melee I's second roll, and an echo's own roll from half the max hit. */
function damage(event) {
  if (event.combatType !== MELEE() || !event.accurate || !Common.isEchoes(event.attacker)) return;
  let max = Common.maxHit(event.attacker, MELEE());
  const factor = Passives.damageFactor(event.attacker, event.target, MELEE());
  if (building && building.attacker === event.attacker) {
    max = Math.floor(max * Common.mastery("melee", 2).effect.echoMaxHitFraction);
    event.damage.setDamage(Math.floor(core.Misc.randomInclusive(0, max) * factor));
  }
  const first = Common.effect(event.attacker, "melee", 1);
  if (!first || Math.random() >= first.rerollChance) return;
  const second = Math.floor(core.Misc.randomInclusive(0, max) * factor);
  if (second > event.damage.getDamage()) event.damage.setDamage(second);
}

function echoChance(attacker, depth) {
  const second = Common.effect(attacker, "melee", 2);
  if (!second) return 0;
  const sixth = Common.effect(attacker, "melee", 6);
  if (depth > 0 && (!sixth || depth >= sixth.echoChainLimit)) return 0;
  return sixth?.echoChance ?? second.echoChance;
}

function queueEcho(attacker, target, depth) {
  const second = Common.mastery("melee", 2).effect;
  building = { attacker };
  let echo;
  try {
    echo = new core.PendingHit(attacker, target, core.CombatFactory.MELEE_COMBAT, { delay: second.echoDelay });
  } finally {
    building = null;
  }
  echoes.set(echo, depth + 1);
  target.getCombat().getHitQueue().addPendingHit(echo, core.World.getProcessCycle());
  const projectile = second.echoProjectiles[side++ % second.echoProjectiles.length];
  core.Projectile.createProjectile(attacker, target, projectile, second.echoProjectileDelay, second.echoProjectileSpeed,
    second.echoProjectileHeights[0], second.echoProjectileHeights[1]).sendProjectile();
}

/** A melee hit landed: Melee IV's heal, then the echo roll (II, VI). */
function resolved({ attacker, target, hit }) {
  if (hit.getCombatType() !== MELEE() || !Common.isEchoes(attacker)) return;
  const fourth = Common.effect(attacker, "melee", 4);
  const dealt = hit.isAccurate() ? hit.getTotalDamage() : 0;
  if (fourth && dealt > 0 && Math.random() < fourth.healChance) attacker.heal(Math.floor(dealt * fourth.healFraction));
  if (!target?.isNpc?.() || target.getHitpoints() <= 0) return;
  const depth = echoes.get(hit) ?? 0;
  const chance = echoChance(attacker, depth);
  if (chance > 0 && Math.random() < chance) queueEcho(attacker, target, depth);
}

module.exports = function attach(api) {
  core = api.core;
  api.onCombatHitDamage(damage);
  api.onCombatHitResolved(resolved);
};

module.exports.isEcho = (hit) => echoes.has(hit);
