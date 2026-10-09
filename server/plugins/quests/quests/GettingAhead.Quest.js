/**
 * Getting Ahead (members).
 *
 * Stub: registered so the second issue #196 shortlist batch has a stable quest
 * entry; the transcript-driven implementation replaces this file in the same
 * branch.
 */
module.exports = function registerGettingAheadQuest(api) {
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const VARP = 7903;

  const quest = registerQuest(api, {
    key: "getting_ahead",
    name: "Getting Ahead",
    varpId: VARP,
    questPoints: 1,
  });

  api.onPlayerLogin(({ player }) => refreshQuestList(player));
};
