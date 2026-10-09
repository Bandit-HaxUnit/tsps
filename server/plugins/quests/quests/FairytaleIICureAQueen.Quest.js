/**
 * Fairytale II - Cure a Queen (members).
 *
 * Stub: registered so the second issue #196 shortlist batch has a stable quest
 * entry; the transcript-driven implementation replaces this file in the same
 * branch.
 */
module.exports = function registerFairytaleIICureAQueenQuest(api) {
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const VARP = 810;

  const quest = registerQuest(api, {
    key: "fairytale_ii_cure_a_queen",
    name: "Fairytale II - Cure a Queen",
    varpId: VARP,
    varbitId: 2326,
    questPoints: 2,
  });

  api.onPlayerLogin(({ player }) => refreshQuestList(player));
};
