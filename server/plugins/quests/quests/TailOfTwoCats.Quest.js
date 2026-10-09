/**
 * A Tail of Two Cats (members).
 *
 * Stub: registered so the third issue #196 shortlist batch has a stable quest
 * entry; the transcript-driven implementation replaces this file in the same
 * branch.
 */
module.exports = function registerTailOfTwoCatsQuest(api) {
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const VARP = 7910;

  const quest = registerQuest(api, {
    key: "a_tail_of_two_cats",
    name: "A Tail of Two Cats",
    varpId: VARP,
    questPoints: 2,
  });

  api.onPlayerLogin(({ player }) => refreshQuestList(player));
};
