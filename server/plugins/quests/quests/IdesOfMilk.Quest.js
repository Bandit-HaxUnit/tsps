/**
 * The Ides of Milk (members).
 *
 * Stub: registered so the second issue #196 shortlist batch has a stable quest
 * entry; the transcript-driven implementation replaces this file in the same
 * branch.
 */
module.exports = function registerIdesOfMilkQuest(api) {
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const VARP = 7902;

  const quest = registerQuest(api, {
    key: "the_ides_of_milk",
    name: "The Ides of Milk",
    varpId: VARP,
    questPoints: 1,
  });

  api.onPlayerLogin(({ player }) => refreshQuestList(player));
};
