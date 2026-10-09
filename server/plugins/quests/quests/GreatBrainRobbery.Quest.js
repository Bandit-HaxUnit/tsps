/**
 * The Great Brain Robbery (members).
 *
 * Stub: registered so the fourth issue #196 shortlist batch has a stable quest
 * entry; the transcript-driven implementation replaces this file in the same
 * branch.
 */
module.exports = function registerGreatBrainRobberyQuest(api) {
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const VARP = 980;

  const quest = registerQuest(api, {
    key: "great_brain_robbery",
    name: "The Great Brain Robbery",
    varpId: VARP,
    questPoints: 2,
  });

  api.onPlayerLogin(({ player }) => refreshQuestList(player));
};
