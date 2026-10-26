/**
 * A league character on login (every login on a league world): joins the world's league the
 * first time (starting levels from the Wiki), gets the league varbits the client's journal and
 * panels read, its XP rate, and answers `league:profile` ({ player } -> { league }) for every
 * other plugin. A main character (a plain world) gets nothing.
 */
const Common = require("./Common.LeagueMode");

/** The varbits a league account carries (capture 227/00070 login): account, type, and the tutorial's done state the journal tab needs. */
function sendVarbits(player, type) {
  const { varbits, tutorialCompletedValue } = Common.data;
  const sender = player.getPacketSender();
  sender.sendVarbit(varbits.account, 1);
  sender.sendVarbit(varbits.type, type);
  sender.sendVarbit(varbits.tutorialCompleted, tutorialCompletedValue);
}

/** A new league character starts with the league's levels (Wiki: Trailblazer Reloaded starts at Herblore 3, Runecraft 5, Agility 10). */
function applyStartingLevels(player, type) {
  const { Skill } = Common.core;
  const SkillManager = Common.api.getSkillManager();
  const skills = player.getSkillManager();
  for (const [name, level] of Object.entries(Common.league(type).startingLevels ?? {})) {
    const skill = Skill[name];
    if (!skill || skills.getMaxLevel(skill) >= level) continue;
    const experience = SkillManager.getExperienceForLevel(level);
    skills.setExperiences(skill, experience, false);
    skills.setMaxLevels(skill, level, false);
    skills.setCurrentLevels(skill, level, true);
  }
}

function login({ player, isNewAccount }) {
  if (!Common.isLeagueProfile(player)) return;
  let type = Common.leagueOf(player);
  if (type === null) {
    type = Common.configuredType();
    player.setAttribute(Common.LEAGUE_TYPE_ATTRIBUTE, type);
    if (isNewAccount) applyStartingLevels(player, type);
  }
  sendVarbits(player, type);
  Common.api.emitCustomEvent("league:login", { player, league: type });
}

function profile(query) {
  if (!query?.player) return;
  query.league = Common.leagueOf(query.player);
}

/** The league's XP rate multiplies every gain (the world's own rate still applies first). */
function experienceRate(event) {
  if (!Common.isLeagueProfile(event.player)) return;
  event.multiplier *= Common.xpMultiplier(event.player);
}

module.exports = function attach(api) {
  api.persistAttribute(Common.LEAGUE_TYPE_ATTRIBUTE);
  api.onPlayerLogin(login);
  api.onCustomEvent("league:profile", profile);
  api.onCanGainExperience(experienceRate);
};
