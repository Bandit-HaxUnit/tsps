/**
 * A league character on login (every login on a league world): joins the world's league the
 * first time (starting levels from the Wiki), gets the league varbits the client's journal and
 * panels read, its XP rate, the league content every plugin contributes (Content.LeagueMode),
 * plays as a standard Ironman (Wiki "Player restrictions": every league player is one; set through
 * the Ironman plugin's `ironman:set-mode` at every login the character is anything else, and kept,
 * since `ironman:change-mode` is refused for a league character), and answers `league:profile`
 * ({ player } -> { league }) for every other plugin. A main character (a plain world) gets nothing.
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

/** The mode the Ironman plugin reports ("none" without one), or undefined when that plugin is not loaded. */
function ironmanMode(player) {
  const query = { player };
  Common.api.emitCustomEvent("ironman:mode", query);
  return query.mode;
}

/**
 * Every league player is a standard Ironman (Wiki): any other mode (none, or one an admin or an
 * earlier save gave it) is set right at every login, so characters made before this rule get it
 * too. Nothing happens when the Ironman plugin is not loaded (its `ironman:mode` goes unanswered).
 */
function applyIronman(player) {
  const mode = ironmanMode(player);
  if (mode === undefined || mode === Common.data.ironmanMode) return;
  Common.api.emitCustomEvent("ironman:set-mode", { player, mode: Common.data.ironmanMode, handled: false });
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
  applyIronman(player);
  Common.api.emitCustomEvent("league:login", { player, league: type });
  // Every plugin's struct and enum overrides, in one packet (Content.LeagueMode).
  Common.api.emitCustomEvent("league:send-content", { player });
}

/** A league character's mode cannot be changed in game (the Ironman tutor, Adam): `ironman:change-mode` is refused. */
function refuseModeChange(change) {
  if (!Common.isLeagueProfile(change?.player)) return;
  change.allowed = false;
  change.reason = Common.message("ironmanLocked");
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
  api.onCustomEvent("ironman:change-mode", refuseModeChange);
  api.onCanGainExperience(experienceRate);
};
