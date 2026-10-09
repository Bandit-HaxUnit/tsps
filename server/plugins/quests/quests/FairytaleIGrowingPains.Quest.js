/**
 * Fairytale I - Growing Pains (members).
 *
 * Stub: registered so the second issue #196 shortlist batch has a stable quest
 * entry; the transcript-driven implementation replaces this file in the same
 * branch.
 */
module.exports = function registerFairytaleIGrowingPainsQuest(api) {
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const VARP = 671;

  const quest = registerQuest(api, {
    key: "fairytale_i_growing_pains",
    name: "Fairytale I - Growing Pains",
    varpId: VARP,
    varbitId: 1803,
    questPoints: 2,
  });

  api.onPlayerLogin(({ player }) => refreshQuestList(player));
};
