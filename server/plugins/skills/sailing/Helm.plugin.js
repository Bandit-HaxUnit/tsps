// The helm: taking and leaving it, the sidepanel sail buttons, and Escape. Ported from xrsps,
// which took it from rsmod's `SailingHelmActions.kt` and `BoatNavigation.kt`
// (https://github.com/rsmod/rsmod, ISC) and their live traces.
const { Sailing } = require("../../../src/main/typescript/elvarg/game/content/sailing/Sailing");
const { BoatManager } = require("../../../src/main/typescript/elvarg/game/content/sailing/BoatManager");
const { BoatMoveMode } = require("../../../src/main/typescript/elvarg/game/content/sailing/Boat");
const { Animation } = require("../../../src/main/typescript/elvarg/game/model/Animation");
const { Location } = require("../../../src/main/typescript/elvarg/game/model/Location");
const {
  VARBIT,
  MOVE_MODE,
  HELM_STATUS,
  SIDEPANEL_GROUP,
  SIDEPANEL_FACILITIES_CHILD,
  SCRIPT_HELM_UPDATE,
  SCRIPT_SIDEBUTTON_SWITCH,
  content,
  boatType,
  setVarbit,
  getVarbit,
  playSound,
} = require("./sailingContent");

const HELM_LOCKED_IN = 3;
const IF_EVENT_OP1 = 1 << 1;
const SEQ_HUMAN_HELM_ACTIVE = 13340;
const SEQ_HELM_ACTIVE = 13335;
const SEQ_HELM_INACTIVE = 13334;
const SEQ_SAIL_DOWN = 13367;
const SEQ_SAIL_DOWN_TO_FULL = 13374;
const SEQ_SAIL_DOWN_TO_HALF = 13371;
const SEQ_SAIL_FULL_TO_DOWN = 13369;
const SEQ_SAIL_HALF_TO_DOWN = 13368;
const SOUND_HELM_ENTER = 10792;
const SOUND_HELM_EXIT = 10793;
const SOUND_SAIL_RAISE = 10831;
const SOUND_SAIL_LOWER = 10833;

const SAIL_MODES = {
  full: { varbit: MOVE_MODE.FULL, boat: BoatMoveMode.Full },
  half: { varbit: MOVE_MODE.HALF, boat: BoatMoveMode.Half },
  reverse: { varbit: MOVE_MODE.REVERSE, boat: BoatMoveMode.Reverse },
  stop: { varbit: MOVE_MODE.STOPPED, boat: BoatMoveMode.Stopped },
};

/**
 * The helm facility's three sidepanel buttons (sailing facility dbrows 8121-8123). Each shows
 * one op whose label depends on the move mode, so the action depends on both:
 *
 * | mode        | button 0     | button 1     | button 2     |
 * | 0 stopped   | Set sails    | Reverse      | Set sails    |
 * | 1 slow      | Un-set sails | Un-set sails | Raise speed  |
 * | 2 fast      | Un-set sails | Lower speed  | Raise speed  |
 * | 3 reversing | Stop boat    | Reverse      | Stop boat    |
 * | 4 moored    | Set sails    | Reverse      | Set sails    |
 */
function sailButtonTransition(slot, moveMode) {
  const atRest = moveMode === MOVE_MODE.STOPPED || moveMode === MOVE_MODE.MOORED;
  switch (slot) {
    case 0:
      return atRest ? "full" : "stop";
    case 1:
      if (atRest) return "reverse";
      if (moveMode === MOVE_MODE.FULL) return "half";
      if (moveMode === MOVE_MODE.HALF) return "stop";
      return undefined; // already reversing
    case 2:
      if (atRest) return "half";
      if (moveMode === MOVE_MODE.HALF) return "full";
      if (moveMode === MOVE_MODE.REVERSE) return "stop";
      return undefined; // already at full speed
    default:
      return undefined;
  }
}

/** Plays a loc animation on the boat's deck for the helmsman and everyone who sees them. */
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

function sailLoweringSeq(moveMode) {
  if (moveMode === MOVE_MODE.FULL) return SEQ_SAIL_FULL_TO_DOWN;
  if (moveMode === MOVE_MODE.HALF) return SEQ_SAIL_HALF_TO_DOWN;
  return SEQ_SAIL_DOWN;
}

function setSailMode(player, boat, mode) {
  const previous = getVarbit(player, VARBIT.SIDEPANEL_BOAT_MOVE_MODE);
  boat.moveMode = SAIL_MODES[mode].boat;
  setVarbit(player, VARBIT.SIDEPANEL_BOAT_MOVE_MODE, SAIL_MODES[mode].varbit);
  setVarbit(player, VARBIT.SIDEPANEL_SAIL_BUTTON_TOGGLED, mode === "stop" ? 0 : 1);
  if (mode === "full" || mode === "half") {
    animateDeckLocs(player, boat, isSail, mode === "full" ? SEQ_SAIL_DOWN_TO_FULL : SEQ_SAIL_DOWN_TO_HALF);
    playSound(player, SOUND_SAIL_RAISE);
  } else if (mode === "reverse") {
    animateDeckLocs(player, boat, isSail, SEQ_SAIL_DOWN);
  } else {
    animateDeckLocs(player, boat, isSail, sailLoweringSeq(previous));
    playSound(player, SOUND_SAIL_LOWER);
  }
}

function takeHelm(player, boat) {
  boat.helmPlayerId = player.getIndex();
  boat.heading = boat.angle;
  const sender = player.getPacketSender();
  setVarbit(player, VARBIT.FACILITY_LOCKEDIN, HELM_LOCKED_IN);
  sender.sendInterfaceFlagsRange((SIDEPANEL_GROUP << 16) | SIDEPANEL_FACILITIES_CHILD, 0, 2, IF_EVENT_OP1);
  player.performAnimation(new Animation(SEQ_HUMAN_HELM_ACTIVE));
  animateDeckLocs(player, boat, isHelm, SEQ_HELM_ACTIVE);
  sender.sendInterfaceScript(SCRIPT_SIDEBUTTON_SWITCH, [0]);
  playSound(player, SOUND_HELM_ENTER);
  if (getVarbit(player, VARBIT.SIDEPANEL_BOAT_MOVE_MODE) === MOVE_MODE.STOPPED) {
    setVarbit(player, VARBIT.SIDEPANEL_BOAT_MOVE_MODE, MOVE_MODE.MOORED);
  }
  setVarbit(player, VARBIT.SIDEPANEL_PLAYER_AT_HELM, 1);
  setVarbit(player, VARBIT.SIDEPANEL_HELM_STATUS, HELM_STATUS.NAVIGATING);
  sender.sendInterfaceScript(SCRIPT_HELM_UPDATE, ["", 0, player.getUsername(), 1]);
  player.sendMessage("You take the helm. Click the water to steer.");
}

function leaveHelm(player, boat) {
  const moveMode = getVarbit(player, VARBIT.SIDEPANEL_BOAT_MOVE_MODE);
  boat.helmPlayerId = undefined;
  boat.moveMode = BoatMoveMode.Stopped;
  boat.heading = boat.angle;
  setVarbit(player, VARBIT.FACILITY_LOCKEDIN, 0);
  animateDeckLocs(player, boat, isHelm, SEQ_HELM_INACTIVE);
  animateDeckLocs(player, boat, isSail, sailLoweringSeq(moveMode));
  player.performAnimation(Animation.DEFAULT_RESET_ANIMATION);
  playSound(player, SOUND_HELM_EXIT);
  setVarbit(player, VARBIT.SIDEPANEL_BOAT_MOVE_MODE, MOVE_MODE.STOPPED);
  setVarbit(player, VARBIT.SIDEPANEL_PLAYER_AT_HELM, 0);
  setVarbit(player, VARBIT.SIDEPANEL_HELM_STATUS, HELM_STATUS.FREE);
  setVarbit(player, VARBIT.SIDEPANEL_SAIL_BUTTON_TOGGLED, 0);
  player.getPacketSender().sendInterfaceScript(SCRIPT_HELM_UPDATE, ["", 0, "", 1]);
}

function toggleHelm({ player }) {
  const boat = Sailing.instanceAboard(player);
  if (!boat) return;
  if (boat.helmPlayerId === player.getIndex()) leaveHelm(player, boat);
  else if (boat.helmPlayerId === undefined) takeHelm(player, boat);
}

function escapeBoat({ player }) {
  if (!Sailing.instanceAboard(player)) return;
  Sailing.escape(player);
  player.sendMessage("Your boat sinks, and you make it back to shore.");
}

function clickSailButton(event) {
  if (event.groupId !== SIDEPANEL_GROUP || event.childId !== SIDEPANEL_FACILITIES_CHILD) return;
  event.handled = true;
  const { player } = event;
  const boat = Sailing.instanceAboard(player);
  if (!boat || boat.helmPlayerId !== player.getIndex()) return;
  const mode = sailButtonTransition(event.slot ?? -1, getVarbit(player, VARBIT.SIDEPANEL_BOAT_MOVE_MODE));
  if (mode) setSailMode(player, boat, mode);
}

/** rsmod `enableSailIfNeededForHeading`: the first heading while moored raises full sail. */
function raiseSailForHeading(player, boat) {
  const moveMode = getVarbit(player, VARBIT.SIDEPANEL_BOAT_MOVE_MODE);
  if (moveMode === MOVE_MODE.MOORED || moveMode === MOVE_MODE.STOPPED) setSailMode(player, boat, "full");
}

module.exports = {
  name: "SailingHelm",
  sailButtonTransition,
  register(api) {
    content();
    api.onObjectInteraction("Helm", {
      Navigate: toggleHelm,
      "Stop-navigating": toggleHelm,
      Escape: escapeBoat,
    });
    api.onInterfaceActionClick(clickSailButton);
    BoatManager.onHeadingSet(raiseSailForHeading);
  },
};
