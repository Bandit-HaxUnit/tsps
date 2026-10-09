/**
 * King's Ransom (members).
 *
 * Stub: registered so the fifth issue #196 shortlist batch has a stable quest
 * entry; the transcript-driven implementation replaces this file in the same
 * branch.
 */
module.exports = function registerKingsRansomQuest(api) {
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const VARP = 7943;

  const quest = registerQuest(api, {
    key: "kings_ransom",
    name: "King's Ransom",
    varpId: VARP,
    questPoints: 1,
  });

  api.onPlayerLogin(({ player }) => refreshQuestList(player));
};
