// The client side of being on a boat: the boarded varbits and the sailing sidepanel on the
// combat tab, applied whenever Sailing puts a player aboard and cleared whenever they leave
// (disembarking, sinking or logging out). Values follow xrsps's raft port, taken from rsmod's
// `applyBoardedState` (https://github.com/rsmod/rsmod, ISC).
const { Task } = require("../../../src/main/typescript/elvarg/game/task/Task");
const { TaskManager } = require("../../../src/main/typescript/elvarg/game/task/TaskManager");
const { Animation } = require("../../../src/main/typescript/elvarg/game/model/Animation");
const { Sailing } = require("../../../src/main/typescript/elvarg/game/content/sailing/Sailing");
const { WeaponInterfaceManager } = require("../../../src/main/typescript/elvarg/game/content/combat/WeaponInterfaceManager");
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

const COMBAT_OPTIONS_GROUP = 593;
const VIEW_SAILING_OPTIONS_CHILD = 46;
/**
 * The sidepanel's "View Combat Options" is built at runtime inside 937:1 (script 8715, from
 * the panel's onLoad 8710 via 8712). 8748 draws it from several pieces and the op goes on the
 * last one, so its child index isn't fixed: enable op 1 across 937:1's children. Children
 * without an op still show no menu entry.
 */
const VIEW_COMBAT_OPTIONS_CHILD = 1;
const VIEW_COMBAT_OPTIONS_MAX_SLOT = 31;
const IF_EVENT_OP1 = 1 << 1;

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
  sender.sendInterfaceFlagsRange(
    (SIDEPANEL_GROUP << 16) | VIEW_COMBAT_OPTIONS_CHILD, 0, VIEW_COMBAT_OPTIONS_MAX_SLOT, IF_EVENT_OP1);
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

/**
 * The combat tab's "View" button (593:46) and the sidepanel's "Combat Options" (937:33) swap
 * the combat tab between the combat options and the sailing sidepanel while aboard; the
 * client only plays a click (script 489), the server remounts the tab.
 */
function switchCombatTab(event) {
  const { player } = event;
  if (event.groupId === COMBAT_OPTIONS_GROUP && event.childId === VIEW_SAILING_OPTIONS_CHILD) {
    event.handled = true;
    const owned = Sailing.instanceAboard(player) && Sailing.activeBoat(player);
    if (owned) applyBoarded(player, owned);
  } else if (event.groupId === SIDEPANEL_GROUP && event.childId === VIEW_COMBAT_OPTIONS_CHILD) {
    event.handled = true;
    WeaponInterfaceManager.assign(player);
  }
}

module.exports = {
  name: "Sailing",
  register(api) {
    content();
    api.onCustomEvent("sailing:boarded", onBoarded);
    api.onCustomEvent("sailing:left", onLeft);
    api.onInterfaceActionClick(switchCombatTab);
  },
};
