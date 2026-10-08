/**
 * Spirits of the Elid (members).
 *
 * Stub: registered so the issue #196 shortlist batch has a stable quest entry;
 * the transcript-driven implementation replaces this file in the same branch.
 */
module.exports = function registerSpiritsOfTheElidQuest(api) {
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const VARP = 616;

  const quest = registerQuest(api, {
    key: "spirits_of_the_elid",
    name: "Spirits of the Elid",
    varpId: VARP,
    varbitId: 1444,
    questPoints: 2,
  });

  api.onPlayerLogin(({ player }) => refreshQuestList(player));
};
