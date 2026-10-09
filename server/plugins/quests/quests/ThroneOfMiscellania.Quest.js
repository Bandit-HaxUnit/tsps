/**
 * Throne of Miscellania (members).
 *
 * Stub: registered so the third issue #196 shortlist batch has a stable quest
 * entry; the transcript-driven implementation replaces this file in the same
 * branch.
 */
module.exports = function registerThroneOfMiscellaniaQuest(api) {
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const VARP = 359;

  const quest = registerQuest(api, {
    key: "throne_of_miscellania",
    name: "Throne of Miscellania",
    varpId: VARP,
    questPoints: 1,
  });

  api.onPlayerLogin(({ player }) => refreshQuestList(player));
};
