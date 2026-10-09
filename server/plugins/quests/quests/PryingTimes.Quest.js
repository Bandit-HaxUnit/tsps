/**
 * Prying Times (members).
 *
 * Stub: registered so the second issue #196 shortlist batch has a stable quest
 * entry; the transcript-driven implementation replaces this file in the same
 * branch.
 */
module.exports = function registerPryingTimesQuest(api) {
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const VARP = 4960;

  const quest = registerQuest(api, {
    key: "prying_times",
    name: "Prying Times",
    varpId: VARP,
    varbitId: 18317,
    questPoints: 1,
  });

  api.onPlayerLogin(({ player }) => refreshQuestList(player));
};
