/**
 * Darkness of Hallowvale (members).
 *
 * Stub: registered so the fifth issue #196 shortlist batch has a stable quest
 * entry; the transcript-driven implementation replaces this file in the same
 * branch.
 */
module.exports = function registerDarknessOfHallowvaleQuest(api) {
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const VARP = 869;

  const quest = registerQuest(api, {
    key: "darkness_of_hallowvale",
    name: "Darkness of Hallowvale",
    varpId: VARP,
    questPoints: 2,
  });

  api.onPlayerLogin(({ player }) => refreshQuestList(player));
};
