/**
 * Children of the Sun (members).
 *
 * Stub: registered so the issue #196 shortlist batch has a stable quest entry;
 * the transcript-driven implementation replaces this file in the same branch.
 */
module.exports = function registerChildrenOfTheSunQuest(api) {
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const VARP = 4075;

  const quest = registerQuest(api, {
    key: "children_of_the_sun",
    name: "Children of the Sun",
    varpId: VARP,
    varbitId: 9632,
    questPoints: 1,
  });

  api.onPlayerLogin(({ player }) => refreshQuestList(player));
};
