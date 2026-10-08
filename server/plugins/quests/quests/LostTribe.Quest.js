/**
 * The Lost Tribe (members).
 *
 * Stub: registered so the issue #196 shortlist batch has a stable quest entry;
 * the transcript-driven implementation replaces this file in the same branch.
 */
module.exports = function registerLostTribeQuest(api) {
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const VARP = 465;

  const quest = registerQuest(api, {
    key: "the_lost_tribe",
    name: "The Lost Tribe",
    varpId: VARP,
    varbitId: 532,
    questPoints: 1,
  });

  api.onPlayerLogin(({ player }) => refreshQuestList(player));
};
