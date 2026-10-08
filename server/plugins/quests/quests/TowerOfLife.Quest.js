/**
 * Tower of Life (members).
 *
 * Stub: registered so the issue #196 shortlist batch has a stable quest entry;
 * the transcript-driven implementation replaces this file in the same branch.
 */
module.exports = function registerTowerOfLifeQuest(api) {
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const VARP = 977;

  const quest = registerQuest(api, {
    key: "tower_of_life",
    name: "Tower of Life",
    varpId: VARP,
    varbitId: 3337,
    questPoints: 1,
  });

  api.onPlayerLogin(({ player }) => refreshQuestList(player));
};
