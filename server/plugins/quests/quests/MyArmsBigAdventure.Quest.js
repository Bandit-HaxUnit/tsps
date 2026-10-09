/**
 * My Arm's Big Adventure (members).
 *
 * Stub: registered so the second issue #196 shortlist batch has a stable quest
 * entry; the transcript-driven implementation replaces this file in the same
 * branch.
 */
module.exports = function registerMyArmsBigAdventureQuest(api) {
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const VARP = 905;

  const quest = registerQuest(api, {
    key: "my_arms_big_adventure",
    name: "My Arm's Big Adventure",
    varpId: VARP,
    varbitId: 2790,
    questPoints: 1,
  });

  api.onPlayerLogin(({ player }) => refreshQuestList(player));
};
