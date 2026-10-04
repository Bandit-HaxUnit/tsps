/**
 * Scythe of Vitur (Wiki: Scythe of Vitur): against a large target each swing lands
 * as many hits as the target is wide, up to three - one on a 1x1, two on a 2x2,
 * three on a 3x3 or larger. Each hit rolls its own accuracy and damage, and each
 * hit's max is half the one before, rounded down (47 -> 23 -> 11).
 *
 * Not modelled: the 1x3 arc that hits three 1x1 targets side by side in multi, and
 * blood-rune charges (the scythe swings without them here).
 */
const SCYTHES = new Set(["scythe of vitur", "holy scythe of vitur", "sanguine scythe of vitur"]);
const MAX_HITS = 3;

let core;
let scytheMethod = null;

function wieldsScythe(player) {
  const weapon = player.getEquipment().get(core.Equipment.WEAPON_SLOT);
  const id = weapon?.getId?.() ?? -1;
  return id > 0 && SCYTHES.has(String(core.ItemDefinition.forId(id)?.getName?.() ?? "").toLowerCase());
}

/** Hits per swing: the target's size, 1 to 3. Players are 1x1. */
function hitCount(target) {
  const size = target?.isNpc?.() ? Number(target.getAsNpc().getSize?.() ?? 1) : 1;
  return Math.max(1, Math.min(MAX_HITS, Math.trunc(size) || 1));
}

/** Max hit of the nth hit (0-based): halved, rounded down, per hit. */
function hitMax(maxHit, index) {
  return Math.floor(maxHit / 2 ** index);
}

function createMethod() {
  const { MeleeCombatMethod, PendingHit, CombatFactory, DamageFormulas } = core;
  return new (class ScytheCombatMethod extends MeleeCombatMethod {
    hits(character, target) {
      const maxHit = DamageFormulas.calculateMaxMeleeHit(character);
      const hits = [];
      for (let index = 0; index < hitCount(target); index++) {
        const hit = new PendingHit(character, target, this);
        if (index > 0) CombatFactory.applyStyleDamage(hit, hitMax(maxHit, index));
        hits.push(hit);
      }
      return hits;
    }
  })();
}

function resolveScythe(attacker) {
  if (!attacker?.isPlayer?.() || !wieldsScythe(attacker.getAsPlayer())) return null;
  scytheMethod ??= createMethod();
  return scytheMethod;
}

module.exports = {
  name: "ScytheOfVitur",
  members: true,
  register(api) {
    core = api.core;
    api.registerCombatMethodResolver({ resolve: resolveScythe });
  },
  _test: { hitCount, hitMax },
};
