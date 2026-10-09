/**
 * The Final Dawn (members).
 *
 * Stub: registered so the fifth issue #196 shortlist batch has a stable quest
 * entry; the transcript-driven implementation replaces this file in the same
 * branch.
 */
module.exports = function registerTheFinalDawnQuest(api) {
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const VARP = 7945;

  const quest = registerQuest(api, {
    key: "the_final_dawn",
    name: "The Final Dawn",
    varpId: VARP,
    questPoints: 3,
  });

  api.onPlayerLogin(({ player }) => refreshQuestList(player));
};
