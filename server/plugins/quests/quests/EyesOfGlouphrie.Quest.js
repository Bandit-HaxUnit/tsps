/**
 * The Eyes of Glouphrie (members).
 *
 * Stub: registered so the issue #196 shortlist batch has a stable quest entry;
 * the transcript-driven implementation replaces this file in the same branch.
 */
module.exports = function registerEyesOfGlouphrieQuest(api) {
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const VARP = 844;

  const quest = registerQuest(api, {
    key: "the_eyes_of_glouphrie",
    name: "The Eyes of Glouphrie",
    varpId: VARP,
    questPoints: 2,
  });

  api.onPlayerLogin(({ player }) => refreshQuestList(player));
};
