/**
 * The Forsaken Tower (members).
 *
 * Stub: registered so the issue #196 shortlist batch has a stable quest entry;
 * the transcript-driven implementation replaces this file in the same branch.
 */
module.exports = function registerForsakenTowerQuest(api) {
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const VARP = 2066;

  const quest = registerQuest(api, {
    key: "the_forsaken_tower",
    name: "The Forsaken Tower",
    varpId: VARP,
    varbitId: 7796,
    questPoints: 1,
  });

  api.onPlayerLogin(({ player }) => refreshQuestList(player));
};
