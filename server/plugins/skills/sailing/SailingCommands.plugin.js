// Developer commands for testing sailing until boats can be bought (and the Pandemonium quest
// hands out the first raft).
const { Sailing } = require("../../../src/main/typescript/elvarg/game/content/sailing/Sailing");
const { BoatMoveMode } = require("../../../src/main/typescript/elvarg/game/content/sailing/Boat");
const { packedHeadingToAngle } = require("../../../src/main/typescript/elvarg/game/content/sailing/HeadingUtils");
const { PlayerRights } = require("../../../src/main/typescript/elvarg/game/model/rights/PlayerRights");
const { content } = require("./sailingContent");

const RAFT_DOCK = "the_pandemonium";
const MOVE_MODES = {
  full: BoatMoveMode.Full,
  half: BoatMoveMode.Half,
  reverse: BoatMoveMode.Reverse,
  stop: BoatMoveMode.Stopped,
};

function giveRaft({ player }) {
  const boat = Sailing.giveBoat(player, "raft", RAFT_DOCK, "Raft");
  player.sendMessage(boat
    ? `A raft is moored for you at ${Sailing.getDock(RAFT_DOCK).name} (slot ${boat.slot}).`
    : "You can't own another boat.");
}

function describe(boat) {
  const where = boat.location.kind === "docked" ? `docked at ${boat.location.dock}`
    : boat.location.kind === "at_sea" ? `at sea (${Math.floor(boat.location.fineX / 128)}, ${Math.floor(boat.location.fineY / 128)})`
    : "sunk";
  return `Slot ${boat.slot}: ${boat.type} "${boat.name}", ${where}`;
}

function boatInfo({ player }) {
  const { boats, activeBoatSlot } = player.getSailing();
  if (boats.length === 0) {
    player.sendMessage("You don't own a boat. Use ::raft.");
    return;
  }
  for (const boat of boats) player.sendMessage(describe(boat) + (boat.slot === activeBoatSlot ? " (active)" : ""));
  const aboard = Sailing.instanceAboard(player);
  if (aboard) {
    player.sendMessage(`Aboard boat ${aboard.entityIndex}: angle ${aboard.angle}, heading ${aboard.heading}, mode ${aboard.moveMode}.`);
  }
}

function sailMode({ player, parts }) {
  const boat = Sailing.instanceAboard(player);
  const mode = MOVE_MODES[parts[1]];
  if (!boat || mode === undefined) {
    player.sendMessage("Usage (aboard): ::sailmode full|half|reverse|stop");
    return;
  }
  boat.moveMode = mode;
}

function heading({ player, parts }) {
  const boat = Sailing.instanceAboard(player);
  const packed = Number(parts[1]);
  if (!boat || !Number.isInteger(packed) || packed < 0 || packed > 15) {
    player.sendMessage("Usage (aboard): ::heading 0-15");
    return;
  }
  boat.heading = packedHeadingToAngle(packed);
}

module.exports = {
  name: "SailingCommands",
  register(api) {
    content();
    api.registerCommand("raft", giveRaft, PlayerRights.DEVELOPER);
    api.registerCommand("boatinfo", boatInfo, PlayerRights.DEVELOPER);
    api.registerCommand("sailmode", sailMode, PlayerRights.DEVELOPER);
    api.registerCommand("heading", heading, PlayerRights.DEVELOPER);
  },
};
