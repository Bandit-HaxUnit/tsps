/**
 * Land of the Goblins (members).
 *
 * Stub: registered so the fifth issue #196 shortlist batch has a stable quest
 * entry; the transcript-driven implementation replaces this file in the same
 * branch.
 */
module.exports = function registerLandOfTheGoblinsQuest(api) {
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const VARP = 7941;

  const quest = registerQuest(api, {
    key: "land_of_the_goblins",
    name: "Land of the Goblins",
    varpId: VARP,
    questPoints: 2,
  });

  api.onPlayerLogin(({ player }) => refreshQuestList(player));
};
