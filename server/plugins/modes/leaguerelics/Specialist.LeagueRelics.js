/**
 * Specialist (https://oldschool.runescape.wiki/w/Specialist_(Raging_Echoes_League)), Raging
 * Echoes' tier 8 relic: special attacks cost a fifth (floored) and roll accuracy twice as high, a
 * special that misses returns 10% energy, and killing any NPC restores 15%.
 */
const Common = require("./Common.LeagueRelics");
const { restoreSpecial } = require("./Hits.LeagueRelics");

let core;
let effect;

function active(player) {
  return Common.effectActive(player, effect);
}

function cost(request) {
  if (active(request.player)) request.cost = Math.floor(request.cost * effect.costMultiplier);
}

function specialAccuracy(entity, roll) {
  return entity.isSpecialActivated?.() && active(entity) ? roll * effect.accuracyMultiplier : roll;
}

/** A special that misses (one refund a missed hit) gives back a tenth of the bar. */
function missRefund({ player, hit }) {
  if (hit.isAccurate() || !player.isSpecialActivated() || !active(player)) return;
  restoreSpecial(core, player, effect.missRefundPercent);
}

function killRestore({ killer }) {
  if (killer?.isPlayer?.() && active(killer)) restoreSpecial(core, killer, effect.killRestorePercent);
}

module.exports = function attach(api) {
  core = api.core;
  effect = Common.data.effects.specialist;
  api.onCustomEvent("combat-special:cost", cost);
  api.registerMeleeAttackAccuracyModifier(specialAccuracy);
  api.registerRangedAttackAccuracyModifier(specialAccuracy);
  api.registerMagicAttackAccuracyModifier(specialAccuracy);
  api.onPlayerDealtDamage(missRefund);
  api.onNpcDeath(killRestore);
};
