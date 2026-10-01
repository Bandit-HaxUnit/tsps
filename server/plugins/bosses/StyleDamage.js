"use strict";

/**
 * Rolls one attack style's OSRS max hit for an NPC and writes it onto the hit.
 *
 * NpcDefinition carries a single max hit (the wiki's highest style), so a boss
 * whose styles cap differently - Graardor 60 melee / 35 ranged, Kree'arra
 * 25/69/21, Zilyana 27/20, K'ril 46/30/49 - would otherwise roll the wrong
 * maximum. The bounds are passed as flat bonuses so the exact integer max
 * survives rollSpecialDamage's floor, and protection prayers still reduce the
 * result the normal way unless bypassPrayer is set.
 */
function applyStyleDamage(CombatFactory, attacker, target, hit, maxHit, options = {}) {
  if (!hit || !hit.isAccurate() || hit.getHits().length === 0) {
    return;
  }
  const rolled = CombatFactory.getHitDamage(
    attacker,
    target,
    hit.getCombatType(),
    options.bypassPrayer === true,
    {
      minimumMultiplier: 0,
      maximumMultiplier: 0,
      minimumBonus: options.minHit ?? 0,
      maximumBonus: maxHit,
    }
  );
  const damage = Math.max(0, Math.min(rolled.getDamage(), target.getHitpoints()));
  hit.getHits()[0].setDamage(damage);
  hit.updateTotalDamage();
}

module.exports = { applyStyleDamage };
