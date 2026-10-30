// The rocks: Wiki supplies melee23 and switching to melee against Protect from Magic.
// RSProx235/948 supplies the magic impact369 (delay10) and interruption. Its magic maximum,
// movement-freeze duration, random adjacent melee and teleport odds remain unknown.
const common = require("./Common.Charting");
const ROCKS = "sailing_charting_drink_troll_ice";
const MELEE_MAX = 23;

function isRocks(npc) {
  return npc?.isNpc?.() && npc.getId() === common.core().CacheDefinitions.getNpcId(ROCKS);
}

function meleeRoll(event) {
  const { CombatType, Misc } = common.core();
  if (event.combatType !== CombatType.MELEE || !isRocks(event.attacker)
    || event.attacker.getOwner() !== event.target) return;
  // A style-specific, unmitigated roll: PendingHit still owns accuracy and protection.
  // Do not turn the canonical unknown magic maximum into an invented shared NPC maximum.
  event.damage = Misc.randomInclusive(0, MELEE_MAX);
}

function combatClass() {
  const { Animation, CombatMethod, CombatFactory, CombatType, Graphic, PendingHit, PrayerHandler, CacheDefinitions } = common.core();
  return class RocksCombat extends CombatMethod {
    constructor(npc) {
      super();
      this.npc = npc;
      const target = npc.getCombat().getTarget();
      this.attackType = target && PrayerHandler.isActivated(target, PrayerHandler.PROTECT_FROM_MAGIC)
        ? CombatType.MELEE : CombatType.MAGIC;
    }
    type() { return this.attackType; }
    attackDistance(character) {
      return this.attackType === CombatType.MELEE
        ? CombatFactory.MELEE_COMBAT.attackDistance(character) : CombatFactory.MAGIC_COMBAT.attackDistance(character);
    }
    start(character, target) {
      // Both recorded styles use troll_attack. The generic magic start would add an
      // uncaptured fallback projectile; a shared melee start also adds an unverified sound.
      const animation = character.getAttackAnim(target);
      if (animation !== -1) character.performAnimation(new Animation(animation));
    }
    // Delay0 is an explicit implementation choice: the adjacent mixed-style capture
    // does not establish a magic cast-to-impact delay for this NPC.
    hits(character, target) { return [new PendingHit(character, target, this)]; }
    handleAfterHitEffects(hit) {
      const target = hit.getTarget();
      if (this.attackType !== CombatType.MAGIC || !target.isPlayer() || this.npc.getOwner() !== target) return;
      target.clearPendingAction();
      target.performGraphic(new Graphic(CacheDefinitions.getSpotanimId("ice_barrage_impact"), 10, 0));
      // No freeze timer is guessed from the recording's graphic or "briefly" Wiki wording.
    }
  };
}

function attach(api) {
  common.init(api);
  api.registerNpcCombatMethodProvider([api.core.CacheDefinitions.getNpcId(ROCKS)], combatClass(), { singleton: false });
  api.onCustomEvent("combat:hit-rolled", meleeRoll);
}
module.exports = attach;
