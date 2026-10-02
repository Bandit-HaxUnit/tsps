"use strict";

const Shared = require("./ToaShared");
const Raid = require("./ToaRaid");

function skipPuzzle({ player }) {
  const raid = Raid.raidOf(player);
  const room = raid?.roomFor(player);
  if (!Shared.inTombs(player.getLocation()) || !room?.def.puzzle || room.destroyed) {
    player.sendMessage("Enter a Tombs of Amascut puzzle room before using ::toaskippuzzle.");
    return true;
  }
  if (room.isCompleted()) {
    player.sendMessage("This puzzle is already complete. Use the exit to proceed to the boss.");
    return true;
  }
  if (!room.isStarted()) room.start();
  room.complete();
  // Normal completion follows killing the enemies; a developer skip must remove them.
  for (const npc of [...room.npcs]) room.despawn(npc);
  raid.broadcast(`${Shared.displayName(player)} skipped the puzzle for testing. Use the exit to proceed to the boss.`);
  return true;
}

function skipBoss({ player }) {
  const raid = Raid.raidOf(player);
  const room = raid?.roomFor(player);
  if (!Shared.inTombs(player.getLocation()) || !room?.def.boss || room.destroyed) {
    player.sendMessage("Enter a Tombs of Amascut boss room before using ::toaskipboss.");
    return true;
  }
  if (room.isCompleted()) {
    player.sendMessage("This boss is already complete.");
    return true;
  }
  if (!room.isStarted()) room.start();
  if (room.key === "WARDENS_P1") {
    // The first encounter hands its state to the final phase instead of completing a room.
    room.toFinalPhase();
    raid.broadcast("Skipped to the Wardens' final phase for testing. Use ::toaskipboss again after arriving to complete it.");
    return true;
  }
  // Snapshot before completion: it spawns Osmumten and other progression NPCs.
  const enemies = [...room.npcs];
  room.complete();
  for (const npc of enemies) {
    if (room.npcs.has(npc)) room.despawn(npc);
  }
  raid.broadcast(`${Shared.displayName(player)} skipped ${room.def.boss} for testing. Use the normal route onward.`);
  return true;
}

/** Marks every path complete and rebuilds the Nexus, so the Wardens' entrance opens. */
function skipToWardens({ player }) {
  const raid = Raid.raidOf(player);
  const room = raid?.roomFor(player);
  if (!Shared.inTombs(player.getLocation()) || room?.key !== "MAIN_HALL" || room.destroyed) {
    player.sendMessage("Enter the Nexus of a Tombs of Amascut raid before using ::toaskiptowarden.");
    return true;
  }
  if (raid.pathsCompleted.length === Shared.PATHS.length) {
    player.sendMessage("Every path is already complete. The Wardens' entrance is open.");
    return true;
  }
  for (const path of Shared.PATHS) raid.completePath(path.key);
  if (raid.startCycle === 0) raid.startCycle = Shared.cycle();
  const nexus = raid.buildRoom("MAIN_HALL");
  for (const member of nexus.roomPlayers()) nexus.onPlayerArrive(member);
  raid.refreshHudStates();
  raid.broadcast(`${Shared.displayName(player)} completed every path for testing. The Wardens' entrance is open.`);
  return true;
}

module.exports = function registerTombsCommands(api) {
  api.registerCommand("toaskippuzzle", skipPuzzle, api.core.PlayerRights.DEVELOPER);
  api.registerCommand("toaskipboss", skipBoss, api.core.PlayerRights.DEVELOPER);
  api.registerCommand("toaskiptowarden", skipToWardens, api.core.PlayerRights.DEVELOPER);
};
