// The helm: taking and leaving it, the sidepanel sail buttons, and Escape. Ported from xrsps,
// which took it from rsmod's `SailingHelmActions.kt` and `BoatNavigation.kt`
// (https://github.com/rsmod/rsmod, ISC) and their live traces.
const { Sailing } = require("../../../src/main/typescript/elvarg/game/content/sailing/Sailing");
const { BoatManager } = require("../../../src/main/typescript/elvarg/game/content/sailing/BoatManager");
const { BoatMoveMode } = require("../../../src/main/typescript/elvarg/game/content/sailing/Boat");
const { Animation } = require("../../../src/main/typescript/elvarg/game/model/Animation");
const {
  VARBIT,
  MOVE_MODE,
  HELM_STATUS,
  SIDEPANEL_GROUP,
  SIDEPANEL_FACILITIES_CHILD,
  SCRIPT_HELM_UPDATE,
  SCRIPT_SIDEBUTTON_SWITCH,
  content,
  setVarbit,
  getVarbit,
  playSound,
  animateDeckLocs,
  isHelm,
  isSail,
} = require("./sailingContent");

const HELM_LOCKED_IN = 3;
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

/** The helm doesn't block walking: whoever navigates stands on its tile, so walk there first. */
function routeToHelm(event) {
  const option = event.definition?.getInteractions()?.[event.clickType - 1];
  if (event.definition?.getName() !== "Helm" || option !== "Navigate") return;
  if (!Sailing.instanceAboard(event.player)) return;
  const helm = event.object.getLocation();
  event.destination = { x: helm.getX(), y: helm.getY(), z: helm.getZ() };
}

function toggleHelm({ player }) {
  const boat = Sailing.instanceAboard(player);
  if (!boat) return;
  if (boat.helmPlayerId === player.getIndex()) leaveHelm(player, boat);
  else if (boat.helmPlayerId === undefined) takeHelm(player, boat);
}

/** Escape sinks the boat, so it asks first; the choice is checked again in case they left. */
function escapeBoat(api, { player }) {
  if (!Sailing.instanceAboard(player)) return;
  api.sendMultiChatboxPrompt(
    player,
    "Escape? Your boat will sink until a shipwright recovers it.",
    "Yes, abandon ship.",
    () => {
      if (!Sailing.instanceAboard(player)) return;
      Sailing.escape(player);
      player.sendMessage("Your boat sinks, and you make it back to shore.");
    },
    "No.",
    () => {},
  );
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
      Escape: (event) => escapeBoat(api, event),
    });
    api.onObjectRoute(routeToHelm);
    api.onInterfaceActionClick(clickSailButton);
    BoatManager.onHeadingSet(raiseSailForHeading);
  },
};
