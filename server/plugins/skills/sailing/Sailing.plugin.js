// The client side of being on a boat: the boarded varbits and the sailing sidepanel on the
// combat tab, applied whenever Sailing puts a player aboard and cleared whenever they leave
// (disembarking, sinking or logging out). Values follow xrsps's raft port, taken from rsmod's
// `applyBoardedState` (https://github.com/rsmod/rsmod, ISC).
const { Task } = require("../../../src/main/typescript/elvarg/game/task/Task");
const { TaskManager } = require("../../../src/main/typescript/elvarg/game/task/TaskManager");
const { Animation } = require("../../../src/main/typescript/elvarg/game/model/Animation");
const {
  VARBIT,
  VARP_SIDEPANEL_BOAT_TYPE,
  MOVE_MODE,
  HELM_STATUS,
  ROLE_CAPTAIN,
  SIDEPANEL_GROUP,
  COMBAT_TAB_UID,
  SCRIPT_SIDEPANEL_INIT,
  SCRIPT_SIDEBUTTON_SWITCH,
  content,
  boatType,
  setVarbit,
} = require("./sailingContent");

function boardedVarbits(type) {
  return {
    [VARBIT.BOARDED_BOAT]: 1,
    [VARBIT.BOARDED_BOAT_WORLD]: 1,
    [VARBIT.PLAYER_IS_ON_PLAYER_BOAT]: 1,
    [VARBIT.BOAT_SPAWNED]: 1,
    [VARBIT.BOARDED_BOAT_LAST_DOCK]: 1,
    [VARBIT.PRELOADED_ANIMS]: 1,
    [VARBIT.SIDEPANEL_PLAYER_ROLE]: ROLE_CAPTAIN,
    [VARBIT.SIDEPANEL_PLAYERS_ON_BOARD_TOTAL]: 1,
    [VARBIT.SIDEPANEL_FACILITY_HOTSPOT0]: type.facilityHotspot,
    [VARBIT.SIDEPANEL_BOAT_HP_MAX]: type.hitpoints,
    [VARBIT.SIDEPANEL_BOAT_HP]: type.hitpoints,
    [VARBIT.SIDEPANEL_HELM_STATUS]: HELM_STATUS.FREE,
    [VARBIT.SIDEPANEL_REPAIRKITS]: type.repairKits,
    [VARBIT.SIDEPANEL_VISIBLE]: 1,
    [VARBIT.SIDEPANEL_VISIBLE_FROM_COMBAT_TAB]: 1,
    [VARBIT.SIDEPANEL_BOAT_MOVE_MODE]: MOVE_MODE.MOORED,
  };
}

/** Everything reset when leaving a boat, whatever set it. */
const LEFT_VARBITS = [
  VARBIT.BOARDED_BOAT,
  VARBIT.BOARDED_BOAT_WORLD,
  VARBIT.PLAYER_IS_ON_PLAYER_BOAT,
  VARBIT.BOAT_SPAWNED,
  VARBIT.FACILITY_LOCKEDIN,
  VARBIT.SIDEPANEL_VISIBLE,
  VARBIT.SIDEPANEL_VISIBLE_FROM_COMBAT_TAB,
  VARBIT.SIDEPANEL_BOAT_MOVE_MODE,
  VARBIT.SIDEPANEL_SAIL_BUTTON_TOGGLED,
  VARBIT.SIDEPANEL_PLAYER_AT_HELM,
];

function applyBoarded(player, owned) {
  const type = boatType(owned.type);
  if (!type) return;
  const varbits = boardedVarbits(type);
  for (const [id, value] of Object.entries(varbits)) setVarbit(player, Number(id), value);
  const sender = player.getPacketSender();
  sender.sendConfig(VARP_SIDEPANEL_BOAT_TYPE, type.sidepanelBoatType);
  sender.sendInterfaceScript(SCRIPT_SIDEPANEL_INIT, [player.getUsername(), 1, "", 1]);
  sender.sendInterfaceScript(SCRIPT_SIDEBUTTON_SWITCH, [0]);
  // Bundle the varbits with the open so the sidepanel's onLoad scripts see them.
  sender.sendSubInterface(COMBAT_TAB_UID, SIDEPANEL_GROUP, 1, {
    varbits,
    varps: { [VARP_SIDEPANEL_BOAT_TYPE]: type.sidepanelBoatType },
  });
}

/** A tick after boarding, once the deck scene (or, on login, the gameframe) is in place. */
function onBoarded({ player, boat, owned }) {
  TaskManager.submit(new (class extends Task {
    constructor() { super(1, player); }
    execute() {
      if (player.getArea()?.boat === boat) applyBoarded(player, owned);
      this.stop();
    }
  })());
}

function onLeft({ player, reason }) {
  // A player logging out has no client left to update.
  if (reason === "logout") return;
  for (const id of LEFT_VARBITS) setVarbit(player, id, 0);
  player.performAnimation(Animation.DEFAULT_RESET_ANIMATION);
  player.getPacketSender().sendTabInterface(0, 0);
}

module.exports = {
  name: "Sailing",
  register(api) {
    content();
    api.onCustomEvent("sailing:boarded", onBoarded);
    api.onCustomEvent("sailing:left", onLeft);
  },
};
