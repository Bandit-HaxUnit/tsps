"use strict";

const Shared = require("./GauntletShared");
const GauntletMap = require("./GauntletMap");

/**
 * ::gauntletmap [corrupted] [all] - builds a maze and puts you in its start room, to check the
 * map; "all" lights every room at once. Leaving the maze removes it.
 */
function buildMap({ player, parts }) {
  const args = (parts?.slice(1) ?? []).map((arg) => arg.toLowerCase());
  const map = GauntletMap.createMap({ corrupted: args.includes("corrupted") });
  if (args.includes("all")) map.lightAll();
  map.enter(player);
  player.moveTo(map.startTile());
  player.sendMessage(`You enter a test maze of ${map.getName()} (start room ${map.start.x}, ${map.start.y}).`);
  return true;
}

function toLobby({ player }) {
  const { Location } = Shared.core();
  player.moveTo(new Location(Shared.LOBBY.x, Shared.LOBBY.y, Shared.LOBBY.z));
  return true;
}

module.exports = function registerGauntletCommands(api) {
  Shared.bind(api);
  api.registerCommand("gauntletmap", buildMap, api.core.PlayerRights.DEVELOPER);
  api.registerCommand("gauntlet", toLobby, api.core.PlayerRights.DEVELOPER);
};
