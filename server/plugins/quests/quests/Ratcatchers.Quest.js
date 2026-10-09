/**
 * Ratcatchers (members).
 *
 * Stub: registered so the fourth issue #196 shortlist batch has a stable quest
 * entry; the transcript-driven implementation replaces this file in the same
 * branch.
 */
module.exports = function registerRatcatchersQuest(api) {
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const VARP = 7934;

  const quest = registerQuest(api, {
    key: "ratcatchers",
    name: "Ratcatchers",
    varpId: VARP,
    questPoints: 2,
  });

  api.onPlayerLogin(({ player }) => refreshQuestList(player));
};
