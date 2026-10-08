/**
 * The Queen of Thieves (members).
 *
 * Stub: registered so the issue #196 shortlist batch has a stable quest entry;
 * the transcript-driven implementation replaces this file in the same branch.
 */
module.exports = function registerQueenOfThievesQuest(api) {
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const VARP = 1672;

  const quest = registerQuest(api, {
    key: "the_queen_of_thieves",
    name: "The Queen of Thieves",
    varpId: VARP,
    varbitId: 6037,
    questPoints: 1,
  });

  api.onPlayerLogin(({ player }) => refreshQuestList(player));
};
