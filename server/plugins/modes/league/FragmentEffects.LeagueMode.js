/**
 * Shattered Relics' fragment effects, batch 1 (data/league-shattered.json `fragmentEffects`): the
 * fragments and sets that the server's existing combat hooks carry. Each works at the level of the
 * equipped fragment (Fragments.equippedLevel) or the tier of the set (Fragments.setTier), with each
 * level's numbers from the fragment's own text in the cache. The rest are follow-ups listed in
 * docs/leagues.md.
 */
const Common = require("./Common.LeagueMode");
const Fragments = require("./Fragments.LeagueMode");
const { data } = require("./Shattered.LeagueMode");

/** The extra attack rolls the sets queued, so they never roll again in turn. */
const extraHits = new WeakSet();
/** Per player: ticks since Divine Restoration last restored a point. */
const prayerTicks = new WeakMap();

function effects() {
  return data.fragmentEffects;
}

function core() {
  return Common.core;
}

function chance(percent) {
  return Math.random() * 100 < percent;
}

/** The value for the level an equipped fragment works at, or null when it isn't equipped. */
function atLevel(player, fragment, values) {
  const level = Fragments.equippedLevel(player, fragment);
  return level > 0 ? values[level - 1] : null;
}

/** The value for a set's tier, or null below its first tier. */
function atTier(player, set, values) {
  const tier = Fragments.setTier(player, set);
  return tier > 0 ? values[Math.min(tier, values.length) - 1] : null;
}

// ---- Unholy Warrior / Ranger / Wizard: accuracy at 0 Prayer points ----

function accuracy(style) {
  const rows = Object.entries(effects().accuracy).filter(([, row]) => row.style === style);
  return function unholyAccuracy(entity, roll) {
    if (!entity?.isPlayer?.()) return roll;
    if (entity.getSkillManager().getCurrentLevel(core().Skill.PRAYER) > 0) return roll;
    let multiplier = 1;
    for (const [fragment, row] of rows) {
      const percent = atLevel(entity, Number(fragment), row.percent);
      if (percent !== null) multiplier += percent / 100;
    }
    return roll * multiplier;
  };
}

// ---- Bottomless Quiver, Arcane Conduit: ammunition, runes and charges saved ----

/** `combat:ammo-saving`: a shot's ammunition or bow charge saved (not chinchompas). */
function ammoSaving(request) {
  if (request.saved) return;
  const { fragment, percent, excluded } = effects().ammoSaving;
  const save = atLevel(request.player, fragment, percent);
  if (save === null) return;
  const weapon = core().ItemDefinition.forId(Number(request.weaponId))?.getName?.() ?? "";
  if (weapon.toLowerCase().includes(excluded)) return;
  if (chance(save)) request.saved = true;
}

/** `magic:rune-saving`: a cast's runes saved. */
function runeSaving(request) {
  if (request.saved) return;
  const save = atLevel(request.player, effects().runeSaving.fragment, effects().runeSaving.percent);
  if (save !== null && chance(save)) request.saved = true;
}

/** `combat:consume-charge` (powered staffs): the charge saved too. */
function chargeSaving(request) {
  if (request.skip) return;
  const save = atLevel(request.player, effects().runeSaving.fragment, effects().runeSaving.percent);
  if (save !== null && chance(save)) request.skip = true;
}

// ---- Larger Recharger: special energy back sooner ----

function specialRestore(entity, delayTicks) {
  if (!entity?.isPlayer?.()) return delayTicks;
  const ticks = atLevel(entity, effects().specialRestore.fragment, effects().specialRestore.everyTicks);
  return ticks === null ? delayTicks : Math.min(delayTicks, ticks);
}

// ---- Every tick: Divine Restoration, Venomaster's immunity ----

function perTick({ player }) {
  const restore = atLevel(player, effects().prayerRestore.fragment, effects().prayerRestore.everyTicks);
  if (restore !== null) {
    const ticks = (prayerTicks.get(player) ?? 0) + 1;
    prayerTicks.set(player, ticks >= restore ? 0 : ticks);
    if (ticks >= restore) {
      const skills = player.getSkillManager();
      const prayer = core().Skill.PRAYER;
      if (skills.getCurrentLevel(prayer) < skills.getMaxLevel(prayer)) skills.setCurrentLevel(prayer, skills.getCurrentLevel(prayer) + 1, true);
    }
  }
  const venom = effects().venom;
  const level = Fragments.equippedLevel(player, venom.fragment);
  if (level >= venom.poisonImmuneFrom) player.getCombat?.()?.getPoisonImmunityTimer?.()?.protectBriefly(2, level >= venom.venomImmuneFrom);
}

// ---- Landed hits: Venomaster, Drakan's Touch, the extra rolls, Absolute Unit's reflection ----

function poisonOnHit(attacker, target, damage) {
  const venom = effects().venom;
  const poison = atLevel(attacker, venom.fragment, venom.damage);
  if (poison !== null && damage > 0 && chance(venom.chancePercent)) core().CombatFactory.poisonEntity(target, poison, 1);
}

function drakansTouch(attacker, damage) {
  const set = effects().sets.drakansTouch;
  const percent = atTier(attacker, set.set, set.healPercent);
  if (percent === null || damage <= 0 || !chance(set.chancePercent)) return;
  const heal = Math.floor(damage * percent / 100);
  if (heal > 0) attacker.heal(heal);
}

const STYLES = { melee: "MELEE", ranged: "RANGED", magic: "MAGIC" };

/** Twin Strikes / Double Tap / Chain Magic: after a landed hit of the set's style, a chance of another roll. */
function extraRoll(attacker, target, hit) {
  if (extraHits.has(hit) || !hit.isAccurate?.()) return;
  for (const [set, row] of Object.entries(effects().sets.extraRolls)) {
    if (hit.getCombatType?.() !== core().CombatType[STYLES[row.style]]) continue;
    const percent = atTier(attacker, Number(set), row.chancePercent);
    if (percent === null || !chance(percent)) continue;
    const extra = new (core().PendingHit)(attacker, target, hit.getCombatMethod(), { delay: 0, rollAccuracy: true, experience: true });
    extraHits.add(extra);
    target.getCombat().getHitQueue().addPendingHit(extra, core().World.getProcessCycle());
  }
}

/** Absolute Unit: a share of what an NPC's hit still did is reflected back at it. */
function reflect(attacker, player, damage) {
  const set = effects().sets.absoluteUnit;
  const percent = atTier(player, set.set, set.reflectPercent);
  if (percent === null || damage <= 0 || !core().CombatFactory.canReceiveRecoil(attacker)) return;
  const reflected = Math.floor(damage * percent / 100);
  if (reflected <= 0) return;
  attacker.getCombat?.().getHitQueue().addPendingDamage([
    new (core().HitDamage)(reflected, core().HitMask.RED).markReflected().setSource(player),
  ]);
}

function hitResolved({ attacker, target, hit }) {
  const damage = Number(hit?.getTotalDamage?.() ?? 0);
  if (attacker?.isPlayer?.() && target) {
    poisonOnHit(attacker, target, damage);
    drakansTouch(attacker, damage);
    extraRoll(attacker, target, hit);
  }
  if (target?.isPlayer?.() && attacker?.isNpc?.()) reflect(attacker, target.getAsPlayer?.() ?? target, damage);
}

/** Absolute Unit: less damage from monsters. */
function incomingDamage(victim, hitDamage, context = {}) {
  if (!victim?.isPlayer?.() || !context.attacker?.isNpc?.()) return;
  const set = effects().sets.absoluteUnit;
  const percent = atTier(victim, set.set, set.reductionPercent);
  if (percent === null) return;
  hitDamage.setDamage(Math.floor(hitDamage.getDamage() * (100 - percent) / 100));
}

// ---- Slay All Day: healed by an on-task kill ----

function slayerKill({ player }) {
  const heal = atLevel(player, effects().slayerHeal.fragment, effects().slayerHeal.heal);
  if (heal !== null) player.heal(heal);
}

module.exports = function attach(api) {
  api.registerMeleeAttackAccuracyModifier(accuracy("melee"));
  api.registerRangedAttackAccuracyModifier(accuracy("ranged"));
  api.registerMagicAttackAccuracyModifier(accuracy("magic"));
  api.onCustomEvent("combat:ammo-saving", ammoSaving);
  api.onCustomEvent("magic:rune-saving", runeSaving);
  api.onCustomEvent("combat:consume-charge", chargeSaving);
  api.registerSpecialEnergyRestoreModifier(specialRestore);
  api.onPlayerProcess(perTick);
  api.onCombatHitResolved(hitResolved);
  api.registerIncomingDamageModifier(incomingDamage);
  api.onCustomEvent("slayer:task-kill", slayerKill);
};

module.exports._test = { accuracy, ammoSaving, runeSaving, chargeSaving, specialRestore, perTick, hitResolved, incomingDamage, slayerKill, extraHits };
