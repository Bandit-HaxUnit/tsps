/**
 * Grim Tales (members).
 *
 * Stub: registered so the fourth issue #196 shortlist batch has a stable quest
 * entry; the transcript-driven implementation replaces this file in the same
 * branch.
 */
module.exports = function registerGrimTalesQuest(api) {
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const VARP = 1016;

  const quest = registerQuest(api, {
    key: "grim_tales",
    name: "Grim Tales",
    varpId: VARP,
    questPoints: 1,
  });

  api.onPlayerLogin(({ player }) => refreshQuestList(player));
};
