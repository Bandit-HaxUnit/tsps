/**
 * What Lies Below (members).
 *
 * Stub: registered so the third issue #196 shortlist batch has a stable quest
 * entry; the transcript-driven implementation replaces this file in the same
 * branch.
 */
module.exports = function registerWhatLiesBelowQuest(api) {
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const VARP = 7920;

  const quest = registerQuest(api, {
    key: "what_lies_below",
    name: "What Lies Below",
    varpId: VARP,
    questPoints: 1,
  });

  api.onPlayerLogin(({ player }) => refreshQuestList(player));
};
