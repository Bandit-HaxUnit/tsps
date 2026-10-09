/**
 * The Curse of Arrav (members).
 *
 * Stub: registered so the fourth issue #196 shortlist batch has a stable quest
 * entry; the transcript-driven implementation replaces this file in the same
 * branch.
 */
module.exports = function registerCurseOfArravQuest(api) {
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const VARP = 7930;

  const quest = registerQuest(api, {
    key: "curse_of_arrav",
    name: "The Curse of Arrav",
    varpId: VARP,
    questPoints: 3,
  });

  api.onPlayerLogin(({ player }) => refreshQuestList(player));
};
