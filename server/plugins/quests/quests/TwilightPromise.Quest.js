/**
 * Twilight's Promise (members).
 *
 * Stub: registered so the third issue #196 shortlist batch has a stable quest
 * entry; the transcript-driven implementation replaces this file in the same
 * branch.
 */
module.exports = function registerTwilightPromiseQuest(api) {
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const VARP = 4386;

  const quest = registerQuest(api, {
    key: "twilights_promise",
    name: "Twilight's Promise",
    varpId: VARP,
    questPoints: 1,
  });

  api.onPlayerLogin(({ player }) => refreshQuestList(player));
};
