/**
 * Eagles' Peak (members).
 *
 * Stub: registered so the issue #196 shortlist batch has a stable quest entry;
 * the transcript-driven implementation replaces this file in the same branch.
 */
module.exports = function registerEaglesPeakQuest(api) {
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const VARP = 934;

  const quest = registerQuest(api, {
    key: "eagles_peak",
    name: "Eagles' Peak",
    varpId: VARP,
    varbitId: 2780,
    questPoints: 2,
  });

  api.onPlayerLogin(({ player }) => refreshQuestList(player));
};
