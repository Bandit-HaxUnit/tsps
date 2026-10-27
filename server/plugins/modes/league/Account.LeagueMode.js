/**
 * A league character on login (every login on a league world): joins the world's league the
 * first time (starting levels from the Wiki), gets the league varbits the client's journal and
 * panels read, its XP rate, the league content every plugin contributes (Content.LeagueMode), and
 * answers `league:profile` ({ player } -> { league }) for every other plugin. A main character
 * (a plain world) gets nothing.
 */
const Common = require("./Common.LeagueMode");

/** world.json pluginConfig: when the league started (an ISO date), for the client's league clock; beside `league:type`. */
const START_CONFIG = "league:start";

/**
 * The varbits a league account carries (capture 227/00070 login): account, type, the tutorial's
 * stage (Tutorial's `league:tutorial-stage`, else the finished value the journal tab needs), the client's date (current_runeday, which live sends with the
 * journal and the Info panel reads) and, when the world says when its league began, that start.
 */
function sendVarbits(player, type) {
  const { varbits, varps, tutorialCompletedValue } = Common.data;
  const sender = player.getPacketSender();
  sender.sendVarbit(varbits.account, 1);
  sender.sendVarbit(varbits.type, type);
  const tutorial = { player, stage: tutorialCompletedValue };
  Common.api.emitCustomEvent("league:tutorial-stage", tutorial);
  sender.sendVarbit(varbits.tutorialCompleted, tutorial.stage);
  sender.sendVarbit(varbits.runeday, Common.runeday());
  const start = Date.parse(String(Common.api.getPluginConfig(START_CONFIG, "")));
  if (Number.isFinite(start)) sender.sendConfig(varps.leagueStart, Math.floor(start / 60000));
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
    Common.api.emitCustomEvent("league:joined", { player, league: type });
  }
  sendVarbits(player, type);
  Common.api.emitCustomEvent("league:login", { player, league: type });
  // Every plugin's struct and enum overrides, in one packet (Content.LeagueMode).
  Common.api.emitCustomEvent("league:send-content", { player });
}

/**
 * The client tells a league world by the world flags it caches (varp map_flags_cached, script 206:
 * bit 30 set and bit 29 clear), not by the league varbits: the journal's Leagues tab, the summary
 * and the trophies all check it. The Wilderness plugin owns that varp and asks for extra bits.
 */
function mapFlags(request) {
  if (!request?.player || !Common.isLeagueProfile(request.player)) return;
  request.flags = (request.flags | 0) | Common.data.mapFlags.leagueWorld;
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
  api.onCustomEvent("world:map-flags", mapFlags);
  api.onCanGainExperience(experienceRate);
};
