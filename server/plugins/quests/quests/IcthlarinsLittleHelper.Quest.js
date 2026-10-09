/**
 * Icthlarin's Little Helper (members).
 *
 * Stub: registered so the second issue #196 shortlist batch has a stable quest
 * entry; the transcript-driven implementation replaces this file in the same
 * branch.
 */
module.exports = function registerIcthlarinsLittleHelperQuest(api) {
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const VARP = 7905;

  const quest = registerQuest(api, {
    key: "ictlharins_little_helper",
    name: "Icthlarin's Little Helper",
    varpId: VARP,
    questPoints: 2,
  });

  api.onPlayerLogin(({ player }) => refreshQuestList(player));
};
