/**
 * The Ascent of Arceuus (members).
 *
 * Stub: registered so the second issue #196 shortlist batch has a stable quest
 * entry; the transcript-driven implementation replaces this file in the same
 * branch.
 */
module.exports = function registerAscentOfArceuusQuest(api) {
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const VARP = 7900;

  const quest = registerQuest(api, {
    key: "the_ascent_of_arceuus",
    name: "The Ascent of Arceuus",
    varpId: VARP,
    questPoints: 1,
  });

  api.onPlayerLogin(({ player }) => refreshQuestList(player));
};
