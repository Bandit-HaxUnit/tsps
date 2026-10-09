/**
 * Another Slice of H.A.M. (members).
 *
 * Stub: registered so the fifth issue #196 shortlist batch has a stable quest
 * entry; the transcript-driven implementation replaces this file in the same
 * branch.
 */
module.exports = function registerAnotherSliceOfHAMQuest(api) {
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const VARP = 7940;

  const quest = registerQuest(api, {
    key: "another_slice_of_ham",
    name: "Another Slice of H.A.M.",
    varpId: VARP,
    questPoints: 1,
  });

  api.onPlayerLogin(({ player }) => refreshQuestList(player));
};
