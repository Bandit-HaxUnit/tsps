/**
 * The Depths of Despair (members).
 *
 * Stub: registered so the issue #196 shortlist batch has a stable quest entry;
 * the transcript-driven implementation replaces this file in the same branch.
 */
module.exports = function registerDepthsOfDespairQuest(api) {
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const VARP = 1671;

  const quest = registerQuest(api, {
    key: "the_depths_of_despair",
    name: "The Depths of Despair",
    varpId: VARP,
    varbitId: 6027,
    questPoints: 1,
  });

  api.onPlayerLogin(({ player }) => refreshQuestList(player));
};
