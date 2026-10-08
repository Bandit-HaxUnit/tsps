/**
 * Recruitment Drive (members).
 *
 * Stub: registered so the issue #196 shortlist batch has a stable quest entry;
 * the transcript-driven implementation replaces this file in the same branch.
 */
module.exports = function registerRecruitmentDriveQuest(api) {
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const VARP = 496;

  const quest = registerQuest(api, {
    key: "recruitment_drive",
    name: "Recruitment Drive",
    varpId: VARP,
    questPoints: 3,
  });

  api.onPlayerLogin(({ player }) => refreshQuestList(player));
};
