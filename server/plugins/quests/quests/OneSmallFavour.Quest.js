/**
 * One Small Favour (members).
 *
 * Stub: registered so the fifth issue #196 shortlist batch has a stable quest
 * entry; the transcript-driven implementation replaces this file in the same
 * branch.
 */
module.exports = function registerOneSmallFavourQuest(api) {
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const VARP = 416;

  const quest = registerQuest(api, {
    key: "one_small_favour",
    name: "One Small Favour",
    varpId: VARP,
    questPoints: 2,
  });

  api.onPlayerLogin(({ player }) => refreshQuestList(player));
};
