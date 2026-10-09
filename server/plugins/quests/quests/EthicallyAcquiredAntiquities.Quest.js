/**
 * Ethically Acquired Antiquities (members).
 *
 * Stub: registered so the second issue #196 shortlist batch has a stable quest
 * entry; the transcript-driven implementation replaces this file in the same
 * branch.
 */
module.exports = function registerEthicallyAcquiredAntiquitiesQuest(api) {
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const VARP = 7904;

  const quest = registerQuest(api, {
    key: "ethically_acquired_antiquities",
    name: "Ethically Acquired Antiquities",
    varpId: VARP,
    questPoints: 1,
  });

  api.onPlayerLogin(({ player }) => refreshQuestList(player));
};
