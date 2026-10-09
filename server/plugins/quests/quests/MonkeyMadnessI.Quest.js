/**
 * Monkey Madness I (members).
 *
 * Stub: registered so the fifth issue #196 shortlist batch has a stable quest
 * entry; the transcript-driven implementation replaces this file in the same
 * branch.
 */
module.exports = function registerMonkeyMadnessIQuest(api) {
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const VARP = 365;

  const quest = registerQuest(api, {
    key: "monkey_madness_i",
    name: "Monkey Madness I",
    varpId: VARP,
    questPoints: 3,
  });

  api.onPlayerLogin(({ player }) => refreshQuestList(player));
};
