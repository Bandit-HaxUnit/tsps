/**
 * X Marks the Spot (members).
 *
 * Stub: registered so the issue #196 shortlist batch has a stable quest entry;
 * the transcript-driven implementation replaces this file in the same branch.
 */
module.exports = function registerXMarksTheSpotQuest(api) {
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const VARP = 1566;

  const quest = registerQuest(api, {
    key: "x_marks_the_spot",
    name: "X Marks the Spot",
    varpId: VARP,
    varbitId: 5619,
    questPoints: 1,
  });

  api.onPlayerLogin(({ player }) => refreshQuestList(player));
};
