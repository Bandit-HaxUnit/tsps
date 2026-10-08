/**
 * Elemental Workshop II (members).
 *
 * Stub: registered so the issue #196 shortlist batch has a stable quest entry;
 * the transcript-driven implementation replaces this file in the same branch.
 */
module.exports = function registerElementalWorkshopIIQuest(api) {
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const VARP = 896;

  const quest = registerQuest(api, {
    key: "elemental_workshop_ii",
    name: "Elemental Workshop II",
    varpId: VARP,
    questPoints: 1,
  });

  api.onPlayerLogin(({ player }) => refreshQuestList(player));
};
