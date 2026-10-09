/**
 * Enlightened Journey (members).
 *
 * Stub: registered so the third issue #196 shortlist batch has a stable quest
 * entry; the transcript-driven implementation replaces this file in the same
 * branch.
 */
module.exports = function registerEnlightenedJourneyQuest(api) {
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const VARP = 7921;

  const quest = registerQuest(api, {
    key: "enlightened_journey",
    name: "Enlightened Journey",
    varpId: VARP,
    questPoints: 2,
  });

  api.onPlayerLogin(({ player }) => refreshQuestList(player));
};
