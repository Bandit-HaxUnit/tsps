/**
 * Client of Kourend (members).
 *
 * Stub: registered so the issue #196 shortlist batch has a stable quest entry;
 * the transcript-driven implementation replaces this file in the same branch.
 */
module.exports = function registerClientOfKourendQuest(api) {
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const VARP = 1566;

  const quest = registerQuest(api, {
    key: "client_of_kourend",
    name: "Client of Kourend",
    varpId: VARP,
    varbitId: 5619,
    questPoints: 1,
  });

  api.onPlayerLogin(({ player }) => refreshQuestList(player));
};
