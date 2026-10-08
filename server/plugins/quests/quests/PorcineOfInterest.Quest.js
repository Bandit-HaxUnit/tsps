/**
 * A Porcine of Interest (members).
 *
 * Stub: registered so the issue #196 shortlist batch has a stable quest entry;
 * the transcript-driven implementation replaces this file in the same branch.
 */
module.exports = function registerPorcineOfInterestQuest(api) {
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const VARP = 2748;

  const quest = registerQuest(api, {
    key: "a_porcine_of_interest",
    name: "A Porcine of Interest",
    varpId: VARP,
    varbitId: 10582,
    questPoints: 1,
  });

  api.onPlayerLogin(({ player }) => refreshQuestList(player));
};
