// Shared by the sailing plugins: boat and dock data, cache ids and small client helpers.
// Cache ids come from xrsps's sailing port, which took them from rsmod's live traces
// (https://github.com/rsmod/rsmod, ISC) and checked them against the rev 237 cache.
const fs = require("fs");
const path = require("path");
const { Sailing } = require("../../../src/main/typescript/elvarg/game/content/sailing/Sailing");
const { GameConstants } = require("../../../src/main/typescript/elvarg/game/GameConstants");
const { BoatManager } = require("../../../src/main/typescript/elvarg/game/content/sailing/BoatManager");
const { Animation } = require("../../../src/main/typescript/elvarg/game/model/Animation");
const { Location } = require("../../../src/main/typescript/elvarg/game/model/Location");

const VARBIT = {
  LAST_PERSONAL_BOAT_BOARDED: 18554, // boat slot, from 1
  PLAYER_IS_ON_PLAYER_BOAT: 19104, // gangplank: Board / Disembark
  FACILITY_LOCKEDIN: 19105, // helm: Navigate / Stop-navigating (3)
  PRELOADED_ANIMS: 19118,
  BOAT_SPAWNED: 19121, // boat slot, from 1
  BOARDED_BOAT_WORLD: 19122,
  PREVIOUS_BOAT_DATA_SLOT: 19130, // boat slot, from 1
  BOARDED_BOAT: 19136,
  BOARDED_BOAT_TYPE: 19137, // raft 0, skiff 1, sloop 2
  PREVIOUS_BOAT_TYPE_ID: 19143,
  SIDEPANEL_VISIBLE: 19151,
  SIDEPANEL_VISIBLE_FROM_COMBAT_TAB: 19153,
  SIDEPANEL_FACILITY_HOTSPOT0: 19156,
  SIDEPANEL_SAIL_BUTTON_TOGGLED: 19174,
  SIDEPANEL_BOAT_MOVE_MODE: 19175,
  SIDEPANEL_HELM_STATUS: 19176,
  SIDEPANEL_BOAT_HP_MAX: 19177,
  SIDEPANEL_BOAT_HP: 19181,
  SIDEPANEL_PLAYER_AT_HELM: 19205,
  SIDEPANEL_REPAIRKITS: 19210,
  SIDEPANEL_PLAYER_ROLE: 19233,
  SIDEPANEL_PLAYERS_ON_BOARD_TOTAL: 19235,
  SIDEPANEL_BOAT_BASESPEED: 19250,
  SIDEPANEL_BOAT_SPEEDCAP: 19251,
  SIDEPANEL_BOAT_SPEEDBOOST_DURATION: 19256,
  SIDEPANEL_BOAT_ACCELERATION: 19257,
  MINIMAP_STATE: 6719,
};
const VARP_SIDEPANEL_BOAT_TYPE = 5117;
/** The sidepanel's boat defence stats, by `stats` field in boats.json. */
const VARP_SIDEPANEL_DEFENCE = {
  defence: 5147,
  stabDefence: 5159,
  slashDefence: 5160,
  crushDefence: 5161,
  magicDefence: 5162,
  heavyRangedDefence: 5163,
  standardRangedDefence: 5164,
  lightRangedDefence: 5165,
};

const MOVE_MODE = { STOPPED: 0, HALF: 1, FULL: 2, REVERSE: 3, MOORED: 4 };
const HELM_STATUS = { FREE: 1, NAVIGATING: 2 };
const ROLE_CAPTAIN = 10;

const SIDEPANEL_GROUP = 937;
const SIDEPANEL_FACILITIES_CHILD = 25;
const COMBAT_TAB_UID = (161 << 16) | 76;
const OVERLAY_ATMOSPHERE_UID = (161 << 16) | 1;
const FADE_OVERLAY_GROUP = 174;
const SCRIPT_FADE = 948;
const FADE_CYCLES = 15;
const SCRIPT_SIDEPANEL_INIT = 8776;
const SCRIPT_HELM_UPDATE = 8778;
const SCRIPT_SIDEBUTTON_SWITCH = 915;

let loaded = null;

/** Loads boats.json and sailing-docks.json into Sailing once, for every plugin. */
function content() {
  if (loaded) return loaded;
  const read = (file) => JSON.parse(fs.readFileSync(path.resolve(process.cwd(), GameConstants.DEFINITIONS_DIRECTORY, file), "utf8"));
  const boats = read("boats.json");
  const docks = read("sailing-docks.json");
  for (const boat of boats) Sailing.registerBoatType(boat);
  for (const dock of docks) Sailing.registerDock(dock);
  loaded = { boats, docks };
  return loaded;
}

function boatType(type) {
  return content().boats.find((boat) => boat.type === type);
}

/** The dock whose gangplank is at (or right by) a clicked loc. */
function dockAtGangplank(location) {
  return content().docks.find((dock) =>
    Math.max(Math.abs(dock.gangplank.x - location.x), Math.abs(dock.gangplank.y - location.y)) <= 1);
}

function setVarbit(player, id, value) {
  player.getPacketSender().sendVarbit(id, value);
}

function getVarbit(player, id) {
  return player.getPacketSender().getVarbit(id);
}

function playSound(player, soundId) {
  player.getPacketSender().sendSoundEffect(soundId, 1, 0, 10);
}

/** Plays a loc animation on the boat's deck for the player and everyone who sees them. */
function animateDeckLocs(player, boat, isLoc, animId) {
  const type = boatType(BoatManager.getSpec(boat)?.type);
  const viewers = [player, ...player.getLocalPlayers().filter((other) => other.getLocalPlayers().includes(player))];
  for (const loc of type?.locs ?? []) {
    if (!isLoc(loc)) continue;
    const drawn = {
      getId: () => loc.id,
      getLocation: () => new Location(boat.deckBaseX + loc.x, boat.deckBaseY + loc.y, loc.level),
      getType: () => loc.shape,
      getFace: () => loc.rotation,
    };
    for (const viewer of viewers) viewer.getPacketSender().sendObjectAnimation(drawn, new Animation(animId));
  }
}

function isHelm(loc) {
  return loc.helm === true;
}

function isSail(loc) {
  return loc.sail === true;
}

/** Fades the screen out (or back in) with interface 174 and `fade_overlay` (script 948). */
function fade(player, out) {
  const args = out ? [0, 255, 0, 0, FADE_CYCLES] : [0, 0, 0, 255, FADE_CYCLES];
  player.getPacketSender().sendSubInterface(OVERLAY_ATMOSPHERE_UID, FADE_OVERLAY_GROUP, 1, {
    postScripts: [{ scriptId: SCRIPT_FADE, args }],
  });
  setVarbit(player, VARBIT.MINIMAP_STATE, out ? 2 : 0);
}

module.exports = {
  VARBIT,
  VARP_SIDEPANEL_BOAT_TYPE,
  VARP_SIDEPANEL_DEFENCE,
  MOVE_MODE,
  HELM_STATUS,
  ROLE_CAPTAIN,
  SIDEPANEL_GROUP,
  SIDEPANEL_FACILITIES_CHILD,
  COMBAT_TAB_UID,
  SCRIPT_SIDEPANEL_INIT,
  SCRIPT_HELM_UPDATE,
  SCRIPT_SIDEBUTTON_SWITCH,
  content,
  boatType,
  dockAtGangplank,
  setVarbit,
  getVarbit,
  playSound,
  fade,
  animateDeckLocs,
  isHelm,
  isSail,
};
