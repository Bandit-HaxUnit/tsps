/**
 * Shared by the combat relics: the attacker's max hit as combat computes it for a hit (the
 * formulas, the ranged modifiers, a spell's bounds), for relics that raise the minimum.
 */
function maxHitFor(core, attacker, target, combatType) {
  const { CombatType, DamageFormulas, PluginManager } = core;
  if (combatType === CombatType.MAGIC) return DamageFormulas.sourceHitBounds(attacker, combatType, target).maximum;
  const max = DamageFormulas.sourceMaxHit(attacker, combatType);
  return combatType === CombatType.RANGED ? PluginManager.modifyRangedMaxHit(attacker, target, max) : max;
}

/** Restores special attack energy and redraws the bar. */
function restoreSpecial(core, player, percent) {
  player.incrementSpecialPercentage(percent);
  core.CombatSpecial.updateBar(player);
}

module.exports = { maxHitFor, restoreSpecial };
