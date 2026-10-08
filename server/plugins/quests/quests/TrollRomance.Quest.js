/**
 * Troll Romance (members).
 *
 * Stub: registered so the issue #196 shortlist batch has a stable quest entry;
 * the transcript-driven implementation replaces this file in the same branch.
 */
module.exports = function registerTrollRomanceQuest(api) {
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const VARP = 385;

  const quest = registerQuest(api, {
    key: "troll_romance",
    name: "Troll Romance",
    varpId: VARP,
    questPoints: 2,
  });

  api.onPlayerLogin(({ player }) => refreshQuestList(player));
};
