/**
 * The Corsair Curse (members).
 *
 * Stub: registered so the issue #196 shortlist batch has a stable quest entry;
 * the transcript-driven implementation replaces this file in the same branch.
 */
module.exports = function registerCorsairCurseQuest(api) {
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const VARP = 1677;

  const quest = registerQuest(api, {
    key: "the_corsair_curse",
    name: "The Corsair Curse",
    varpId: VARP,
    varbitId: 6071,
    questPoints: 2,
  });

  api.onPlayerLogin(({ player }) => refreshQuestList(player));
};
