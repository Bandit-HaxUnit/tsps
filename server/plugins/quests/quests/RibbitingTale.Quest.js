/**
 * The Ribbiting Tale of a Lily Pad Labour Dispute (members).
 *
 * Stub: registered so the third issue #196 shortlist batch has a stable quest
 * entry; the transcript-driven implementation replaces this file in the same
 * branch.
 */
module.exports = function registerRibbitingTaleQuest(api) {
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const VARP = 7912;

  const quest = registerQuest(api, {
    key: "the_ribbiting_tale_of_a_lily_pad_labour_dispute",
    name: "The Ribbiting Tale of a Lily Pad Labour Dispute",
    varpId: VARP,
    questPoints: 1,
  });

  api.onPlayerLogin(({ player }) => refreshQuestList(player));
};
