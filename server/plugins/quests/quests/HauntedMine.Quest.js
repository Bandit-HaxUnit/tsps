/**
 * Haunted Mine (members).
 *
 * Stub: registered so the third issue #196 shortlist batch has a stable quest
 * entry; the transcript-driven implementation replaces this file in the same
 * branch.
 */
module.exports = function registerHauntedMineQuest(api) {
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const VARP = 382;

  const quest = registerQuest(api, {
    key: "haunted_mine",
    name: "Haunted Mine",
    varpId: VARP,
    questPoints: 2,
  });

  api.onPlayerLogin(({ player }) => refreshQuestList(player));
};
