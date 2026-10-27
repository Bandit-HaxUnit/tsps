/**
 * Shattered Relics' fragment effects, batch 1 (data/league-shattered.json `fragmentEffects`): the
 * fragments and sets that the server's existing combat hooks carry. Each works with the number its
 * equipped level gives in the cache (Fragments.equippedValue) or the tier of the set
 * (Fragments.setTier). The rest are follow-ups listed in docs/leagues.md.
 */
const Common = require("./Common.LeagueMode");
const Fragments = require("./Fragments.LeagueMode");
const { data, isShattered } = require("./Shattered.LeagueMode");

/** The extra attack rolls the sets queued, so they never roll again in turn. */
const extraHits = new WeakSet();
/** Per player: ticks since Divine Restoration last restored a point. */
const prayerTicks = new WeakMap();
/** The players whose per-tick effects are running (one task each, from login). */
const ticking = new WeakSet();
/** The per-tick task, defined once api.core.Task is reachable. */
let TickTask = null;

function effects() {
  return data.fragmentEffects;
}

function core() {
  return Common.core;
}

function chance(percent) {
  return Math.random() * 100 < percent;
}

/** The value for a set's tier, or null below its first tier. */
function atTier(player, set, values) {
  const tier = Fragments.setTier(player, set);
  return tier > 0 ? values[Math.min(tier, values.length) - 1] : null;
}

// ---- Unholy Warrior / Ranger / Wizard: accuracy at 0 Prayer points ----

function accuracy(style) {
  const fragments = Object.entries(effects().accuracy).filter(([, each]) => each === style).map(([fragment]) => Number(fragment));
  return function unholyAccuracy(entity, roll) {
    if (!entity?.isPlayer?.()) return roll;
    if (entity.getSkillManager().getCurrentLevel(core().Skill.PRAYER) > 0) return roll;
    let multiplier = 1;
    for (const fragment of fragments) {
      const percent = Fragments.equippedValue(entity, fragment);
      if (percent !== null) multiplier += percent / 100;
    }
    return roll * multiplier;
  };
}

// ---- Bottomless Quiver, Arcane Conduit: ammunition, runes and charges saved ----

/** `combat:ammo-saving`: a shot's ammunition or bow charge saved (not chinchompas). */
function ammoSaving(request) {
  if (request.saved) return;
  const { fragment, excluded } = effects().ammoSaving;
  const save = Fragments.equippedValue(request.player, fragment);
  if (save === null) return;
  const weapon = core().ItemDefinition.forId(Number(request.weaponId))?.getName?.() ?? "";
  if (weapon.toLowerCase().includes(excluded)) return;
  if (chance(save)) request.saved = true;
}

/** `magic:rune-saving`: a cast's runes saved. */
function runeSaving(request) {
  if (request.saved) return;
  const save = Fragments.equippedValue(request.player, effects().runeSaving.fragment);
  if (save !== null && chance(save)) request.saved = true;
}

/** `combat:consume-charge` (powered staffs): the charge saved too. */
function chargeSaving(request) {
  if (request.skip) return;
  const save = Fragments.equippedValue(request.player, effects().runeSaving.fragment);
  if (save === null || core().CombatFactory.getMethod(request.player).type() !== core().CombatType.MAGIC) return;
  if (chance(save)) request.skip = true;
}

// ---- Larger Recharger: special energy back sooner ----

function specialRestore(entity, delayTicks) {
  if (!entity?.isPlayer?.()) return delayTicks;
  const ticks = Fragments.equippedValue(entity, effects().specialRestore.fragment);
  return ticks === null ? delayTicks : Math.min(delayTicks, ticks);
}

// ---- Every tick for a Shattered Relics character: Divine Restoration, Venomaster's immunity ----

function perTick({ player }) {
  const restore = Fragments.equippedValue(player, effects().prayerRestore.fragment);
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

function tickTask() {
  TickTask ??= class extends core().Task {
    constructor(player) {
      super(1);
      this.player = player;
    }

    execute() {
      if (this.player.isRegistered?.() === false || !isShattered(this.player)) {
        ticking.delete(this.player);
        this.stop();
        return;
      }
      perTick({ player: this.player });
    }
  };
  return TickTask;
}

/** `league:login`: a Shattered Relics character's per-tick effects run while it is online. */
function startTicking({ player }) {
  if (!isShattered(player) || ticking.has(player)) return;
  const manager = Common.api.getTaskManager?.();
  if (typeof manager?.submit !== "function") return;
  ticking.add(player);
  manager.submit(new (tickTask())(player));
}

// ---- Landed hits: Venomaster, Drakan's Touch, the extra rolls, Absolute Unit's reflection ----

/** Venomaster: its level's number is the poison's severity (15/25/35 hit for 3/5/7). */
function poisonOnHit(attacker, target, damage) {
  const venom = effects().venom;
  const severity = Fragments.equippedValue(attacker, venom.fragment);
  if (severity !== null && damage > 0 && chance(venom.chancePercent)) core().CombatFactory.poisonEntity(target, severity, 1);
}

function drakansTouch(attacker, damage) {
  const set = effects().sets.drakansTouch;
  const percent = atTier(attacker, set.set, set.healPercent);
  if (percent === null || damage <= 0 || !chance(set.chancePercent)) return;
  const heal = Math.floor(damage * percent / 100);
  if (heal > 0) attacker.heal(heal);
}

const STYLES = { melee: "MELEE", ranged: "RANGED", magic: "MAGIC" };

/**
 * Another roll of the hit it follows: with that hit's spell and cast (a manual cast is over by
 * now) and never a special attack's traits, both put back as they were once it is rolled. It can
 * take at most `hitpointsLeft`, which addPendingHit applies before paying its XP.
 */
function followUpHit(attacker, target, hit, hitpointsLeft) {
  const combat = attacker.getCombat();
  const castSpell = combat.getCastSpell();
  const special = attacker.isSpecialActivated();
  const spell = hit.getSpell?.() ?? null;
  if (spell) combat.setCastSpell(spell);
  attacker.setSpecialActivated(false);
  try {
    const extra = new (core().PendingHit)(attacker, target, hit.getCombatMethod(),
      { delay: 0, rollAccuracy: true, handleAfterHitEffects: false, damageBudget: { remaining: hitpointsLeft } },
      undefined, hit.getSpellContext?.() ?? null);
    return spell ? extra.setSpell(spell) : extra;
  } finally {
    combat.setCastSpell(castSpell);
    attacker.setSpecialActivated(special);
  }
}

/** The target's hitpoints once the damage already queued against it (the hit just resolved) lands. */
function hitpointsLeft(target) {
  const queued = Number(target.getCombat?.()?.getHitQueue?.()?.getQueuedDamage?.()) || 0;
  return Math.max(0, (Number(target.getHitpoints?.()) || 0) - queued);
}

/**
 * Twin Strikes / Double Tap / Chain Magic: after a landed hit of the set's style, a chance of
 * another roll, for no more than the hitpoints the target has left (none after a killing blow).
 */
function extraRoll(attacker, target, hit) {
  if (extraHits.has(hit) || !hit.isAccurate?.()) return;
  for (const [set, row] of Object.entries(effects().sets.extraRolls)) {
    if (hit.getCombatType?.() !== core().CombatType[STYLES[row.style]]) continue;
    const percent = atTier(attacker, Number(set), row.chancePercent);
    if (percent === null || !chance(percent)) continue;
    const left = hitpointsLeft(target);
    if (left <= 0) return;
    const extra = followUpHit(attacker, target, hit, left);
    extraHits.add(extra);
    core().CombatFactory.addPendingHit(extra);
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
  const heal = Fragments.equippedValue(player, effects().slayerHeal.fragment);
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
  api.onCustomEvent("league:login", startTicking);
  api.onCombatHitResolved(hitResolved);
  api.registerIncomingDamageModifier(incomingDamage);
  api.onCustomEvent("slayer:task-kill", slayerKill);
};

module.exports._test = { accuracy, ammoSaving, runeSaving, chargeSaving, specialRestore, perTick, startTicking, hitResolved, incomingDamage, slayerKill, followUpHit, extraHits };
