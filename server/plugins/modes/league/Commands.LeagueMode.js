/**
 * Developer commands. `::league [player]` shows a character's league and points.
 * `::leaguetask <id> <points> [name]` awards a named task through the real award path
 * (LeaguePoints), the only source of points until the task catalog (LeagueTasks) exists.
 */
const Common = require("./Common.LeagueMode");

function target(player, name) {
  if (!name) return player;
  const found = Common.core.World.getPlayerByName(name);
  if (!found) player.sendMessage(`No player called ${name} is online.`);
  return found;
}

function leagueCommand({ player, parts }) {
  const who = target(player, parts.slice(1).join(" ").trim());
  if (!who) return true;
  const type = Common.leagueOf(who);
  if (type === null) {
    player.sendMessage(Common.message("notLeague", { name: who.getUsername() }));
    return true;
  }
  const query = { player: who, points: 0, tasks: 0 };
  Common.api.emitCustomEvent("league:points", query);
  player.sendMessage(Common.message("status", {
    name: who.getUsername(), league: Common.league(type).name, points: query.points, tasks: query.tasks,
  }));
  return true;
}

function leagueTaskCommand({ player, parts }) {
  const id = String(parts[1] ?? "").trim();
  const points = Number(parts[2]);
  if (!id || !Number.isInteger(points) || points < 0) {
    player.sendMessage(Common.message("taskUsage"));
    return true;
  }
  const name = parts.slice(3).join(" ").trim() || id;
  if (Common.leagueOf(player) === null) {
    player.sendMessage(Common.message("notLeague", { name: player.getUsername() }));
    return true;
  }
  const award = { player, id, points, name, awarded: false };
  Common.api.emitCustomEvent("league:award-task", award);
  player.sendMessage(Common.message(award.awarded ? "taskAwarded" : "taskRepeat", { id, points, name: player.getUsername() }));
  return true;
}

module.exports = function attach(api) {
  const { PlayerRights } = api.core;
  api.registerCommand("league", leagueCommand, PlayerRights.DEVELOPER, "Show a character's league and League Points: ::league [player]");
  api.registerCommand("leaguetask", leagueTaskCommand, PlayerRights.DEVELOPER, "Award yourself a league task: ::leaguetask <id> <points> [name]");
};
