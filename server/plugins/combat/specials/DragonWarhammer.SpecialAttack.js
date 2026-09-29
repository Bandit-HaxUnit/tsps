// TODO: ported from xrsps-typescript; untested.
module.exports = function registerDragonWarhammerSpecialAttack(api) {
  const { Animation, CombatSpecial, Graphic, ItemIdentifiers, MeleeCombatMethod, Priority, Skill, Sounds } = api.core;

  const DRAIN = 50;
  const DEFENCE_DRAIN_FRACTION = 0.3;
  const ANIMATION = new Animation(1378);
  const GRAPHIC = new Graphic(1292, Priority.HIGH);

  function smash(target, damage) {
    if (Math.floor(damage) <= 0) {
      return;
    }
    if (!target.isPlayer()) {
      // TODO: NPC combat-stat drain is not exposed by our core NPC state.
      return;
    }
    const skillManager = target.getAsPlayer().getSkillManager();
    const currentLevel = Math.max(0, Math.floor(skillManager.getCurrentLevel(Skill.DEFENCE)));
    const drainAmount = Math.floor(currentLevel * DEFENCE_DRAIN_FRACTION);
    skillManager.setCurrentLevels(Skill.DEFENCE, Math.max(0, currentLevel - drainAmount));
  }

  class DragonWarhammerCombatMethod extends MeleeCombatMethod {
    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      character.performAnimation(ANIMATION);
      character.performGraphic(GRAPHIC);
      Sounds.sendSound(character, character.getAttackSound());
    }

    handleAfterHitEffects(hit) {
      smash(hit.getTarget(), hit.getTotalDamage());
    }
  }

  api.registerCombatSpecial({
    id: "dragon_warhammer",
    itemIds: [ItemIdentifiers.DRAGON_WARHAMMER],
    drainAmount: DRAIN,
    strengthMultiplier: 1.5,
    accuracyMultiplier: 1,
    traits: {
      hitCount: 1,
      accuracyMultiplier: 1,
      damageMultiplier: 1.5,
    },
    combatMethod: new DragonWarhammerCombatMethod(),
  });
};
