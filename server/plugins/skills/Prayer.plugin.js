const { Skill } = require("../../src/main/typescript/elvarg/game/model/Skill");
const { Animation } = require("../../src/main/typescript/elvarg/game/model/Animation");
const { ItemDefinition } = require("../../src/main/typescript/elvarg/game/definition/ItemDefinition");
const { Sound } = require("../../src/main/typescript/elvarg/game/Sound");
const { Sounds } = require("../../src/main/typescript/elvarg/game/Sounds");
const { BONE_XP: BONES } = require("../../src/main/typescript/elvarg/game/content/combat/magic/ArceuusOfferings");

const BURY_ANIMATION = new Animation(827);
const BURY_DELAY_MS = 1000;


module.exports = {
  name: "Prayer",
  register(api) {
    api.onItemFirstAction((event) => {
      const { player, itemId, slot } = event;
      const xp = BONES.get(itemId);
      if (!xp) {
        return false;
      }

      if (!player.getClickDelay().elapsedTime(BURY_DELAY_MS)) {
        return true;
      }

      player.getSkillManager().stopSkillable();
      player.getPacketSender().sendInterfaceRemoval();
      player.performAnimation(BURY_ANIMATION);
      Sounds.sendSound(player, Sound.BURY_BONES);
      player.sendMessage("You dig a hole in the ground..");
      player.getInventory().deleteAtSlot(slot, 1);
      setTimeout(() => {
        const name = ItemDefinition.forId(itemId).getName();
        player.sendMessage(`..and bury the ${name}.`);
        player.getSkillManager().addExperiences(Skill.PRAYER, xp);
      }, BURY_DELAY_MS);
      player.getClickDelay().reset();
      return true;
    });

    api.log("registered", { buryableBones: BONES.size });
  },
};
