/**
 * Lunar Diplomacy (members).
 *
 * Stub: registered so the fifth issue #196 shortlist batch has a stable quest
 * entry; the transcript-driven implementation replaces this file in the same
 * branch.
 */
module.exports = function registerLunarDiplomacyQuest(api) {
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const VARP = 823;

  const quest = registerQuest(api, {
    key: "lunar_diplomacy",
    name: "Lunar Diplomacy",
    varpId: VARP,
    questPoints: 2,
  });

  api.onPlayerLogin(({ player }) => refreshQuestList(player));
};
