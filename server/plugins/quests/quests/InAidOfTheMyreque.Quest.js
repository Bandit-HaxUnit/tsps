/**
 * In Aid of the Myreque (members).
 *
 * Stub: registered so the second issue #196 shortlist batch has a stable quest
 * entry; the transcript-driven implementation replaces this file in the same
 * branch.
 */
module.exports = function registerInAidOfTheMyrequeQuest(api) {
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const VARP = 704;

  const quest = registerQuest(api, {
    key: "in_aid_of_the_myreque",
    name: "In Aid of the Myreque",
    varpId: VARP,
    questPoints: 2,
  });

  api.onPlayerLogin(({ player }) => refreshQuestList(player));
};
