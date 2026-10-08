/**
 * A Soul's Bane (members).
 *
 * Stub: registered so the issue #196 shortlist batch has a stable quest entry;
 * the transcript-driven implementation replaces this file in the same branch.
 */
module.exports = function registerSoulsBaneQuest(api) {
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const VARP = 709;

  const quest = registerQuest(api, {
    key: "a_souls_bane",
    name: "A Soul's Bane",
    varpId: VARP,
    varbitId: 2011,
    questPoints: 2,
  });

  api.onPlayerLogin(({ player }) => refreshQuestList(player));
};
