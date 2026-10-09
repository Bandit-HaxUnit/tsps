/**
 * Garden of Tranquillity (members).
 *
 * Stub: registered so the second issue #196 shortlist batch has a stable quest
 * entry; the transcript-driven implementation replaces this file in the same
 * branch.
 */
module.exports = function registerGardenOfTranquillityQuest(api) {
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const VARP = 553;

  const quest = registerQuest(api, {
    key: "garden_of_tranquillity",
    name: "Garden of Tranquillity",
    varpId: VARP,
    varbitId: 961,
    questPoints: 2,
  });

  api.onPlayerLogin(({ player }) => refreshQuestList(player));
};
