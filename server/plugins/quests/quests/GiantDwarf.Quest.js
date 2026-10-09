/**
 * The Giant Dwarf (members).
 *
 * Stub: registered so the fourth issue #196 shortlist batch has a stable quest
 * entry; the transcript-driven implementation replaces this file in the same
 * branch.
 */
module.exports = function registerGiantDwarfQuest(api) {
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const VARP = 482;

  const quest = registerQuest(api, {
    key: "giant_dwarf",
    name: "The Giant Dwarf",
    varpId: VARP,
    questPoints: 1,
  });

  api.onPlayerLogin(({ player }) => refreshQuestList(player));
};
