/**
 * Making History (members).
 *
 * Stub: registered so the issue #196 shortlist batch has a stable quest entry;
 * the transcript-driven implementation replaces this file in the same branch.
 */
module.exports = function registerMakingHistoryQuest(api) {
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const VARP = 604;

  const quest = registerQuest(api, {
    key: "making_history",
    name: "Making History",
    varpId: VARP,
    varbitId: 1383,
    questPoints: 3,
  });

  api.onPlayerLogin(({ player }) => refreshQuestList(player));
};
