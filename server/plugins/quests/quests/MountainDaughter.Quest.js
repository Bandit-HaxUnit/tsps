/**
 * Mountain Daughter (members).
 *
 * Stub: registered so the third issue #196 shortlist batch has a stable quest
 * entry; the transcript-driven implementation replaces this file in the same
 * branch.
 */
module.exports = function registerMountainDaughterQuest(api) {
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const VARP = 423;

  const quest = registerQuest(api, {
    key: "mountain_daughter",
    name: "Mountain Daughter",
    varpId: VARP,
    questPoints: 2,
  });

  api.onPlayerLogin(({ player }) => refreshQuestList(player));
};
