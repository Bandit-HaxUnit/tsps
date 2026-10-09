/**
 * Bone Voyage (members).
 *
 * Stub: registered so the fourth issue #196 shortlist batch has a stable quest
 * entry; the transcript-driven implementation replaces this file in the same
 * branch.
 */
module.exports = function registerBoneVoyageQuest(api) {
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const VARP = 1630;

  const quest = registerQuest(api, {
    key: "bone_voyage",
    name: "Bone Voyage",
    varpId: VARP,
    questPoints: 1,
  });

  api.onPlayerLogin(({ player }) => refreshQuestList(player));
};
