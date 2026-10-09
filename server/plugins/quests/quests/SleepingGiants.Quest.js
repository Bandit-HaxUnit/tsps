/**
 * Sleeping Giants (members).
 *
 * Stub: registered so the third issue #196 shortlist batch has a stable quest
 * entry; the transcript-driven implementation replaces this file in the same
 * branch.
 */
module.exports = function registerSleepingGiantsQuest(api) {
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const VARP = 7917;

  const quest = registerQuest(api, {
    key: "sleeping_giants",
    name: "Sleeping Giants",
    varpId: VARP,
    questPoints: 1,
  });

  api.onPlayerLogin(({ player }) => refreshQuestList(player));
};
