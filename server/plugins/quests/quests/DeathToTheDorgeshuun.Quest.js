/**
 * Death to the Dorgeshuun (members).
 *
 * Stub: registered so the fifth issue #196 shortlist batch has a stable quest
 * entry; the transcript-driven implementation replaces this file in the same
 * branch.
 */
module.exports = function registerDeathToTheDorgeshuunQuest(api) {
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const VARP = 794;

  const quest = registerQuest(api, {
    key: "death_to_the_dorgeshuun",
    name: "Death to the Dorgeshuun",
    varpId: VARP,
    questPoints: 1,
  });

  api.onPlayerLogin(({ player }) => refreshQuestList(player));
};
