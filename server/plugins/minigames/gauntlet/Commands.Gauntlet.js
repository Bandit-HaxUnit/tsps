"use strict";

const Shared = require("./GauntletShared");
const GauntletMap = require("./GauntletMap");
const Run = require("./GauntletRun");

/**
 * ::gauntletmap [corrupted] [all] - builds a maze (no run) and puts you in its start room, to
 * check the map; "all" lights every room at once. Leaving the maze removes it.
 */
function buildMap({ player, parts }) {
  const args = (parts?.slice(1) ?? []).map((arg) => arg.toLowerCase());
  if (Run.runOf(player)) {
    player.sendMessage("Leave your Gauntlet run before using ::gauntletmap.");
    return true;
  }
  const map = GauntletMap.createMap({ corrupted: args.includes("corrupted") });
  if (args.includes("all")) map.lightAll();
  map.enter(player);
  player.moveTo(map.startTile());
  player.sendMessage(`You enter a test maze of ${map.getName()} (start room ${map.start.x}, ${map.start.y}).`);
  return true;
}

/** ::gauntletstart [corrupted] - starts a run without Bryn's checks; your hands must be empty. */
function startRun({ player, parts }) {
  const corrupted = (parts?.slice(1) ?? []).some((arg) => arg.toLowerCase() === "corrupted");
  if (Run.runOf(player)) {
    player.sendMessage("You are already in a Gauntlet run.");
    return true;
  }
  if (!Shared.isEmptyHanded(player)) {
    player.sendMessage("Bank your inventory and equipment first: a run takes everything you carry when it ends.");
    return true;
  }
  Run.startRun(player, { corrupted });
  return true;
}

/** ::gauntletboss - ends the preparation now and takes you to the Hunllef. */
function skipToBoss({ player }) {
  const run = Run.runOf(player);
  if (!run || run.stage !== "prep") {
    player.sendMessage("Start a Gauntlet run before using ::gauntletboss.");
    return true;
  }
  run.startBossPhase({ forced: true });
  return true;
}

/** ::gauntlettime <seconds> - sets the preparation time left. */
function setPrepTime({ player, parts }) {
  const run = Run.runOf(player);
  const seconds = Number(parts?.[1]);
  if (!run || run.stage !== "prep" || !Number.isFinite(seconds) || seconds < 0) {
    player.sendMessage("Use ::gauntlettime <seconds> during a run's preparation.");
    return true;
  }
  run.prepLeft = Math.max(1, Math.round(seconds / 0.6));
  player.getPacketSender().sendClientScript(Shared.SCRIPT.TIMER_START, run.prepLeft);
  return true;
}

function toLobby({ player }) {
  if (Run.runOf(player)) {
    player.sendMessage("Leave your Gauntlet run before using ::gauntlet.");
    return true;
  }
  player.moveTo(Shared.loc(Shared.LOBBY));
  return true;
}

module.exports = function registerGauntletCommands(api) {
  Shared.bind(api);
  const { DEVELOPER } = api.core.PlayerRights;
  api.registerCommand("gauntlet", toLobby, DEVELOPER);
  api.registerCommand("gauntletmap", buildMap, DEVELOPER);
  api.registerCommand("gauntletstart", startRun, DEVELOPER);
  api.registerCommand("gauntletboss", skipToBoss, DEVELOPER);
  api.registerCommand("gauntlettime", setPrepTime, DEVELOPER);
};
