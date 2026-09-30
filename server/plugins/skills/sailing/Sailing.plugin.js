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
  VARP_SIDEPANEL_DEFENCE,
  MOVE_MODE,
  HELM_STATUS,
  ROLE_CAPTAIN,
  SIDEPANEL_GROUP,
  SIDEPANEL_FACILITIES_CHILD,
  COMBAT_TAB_UID,
  SCRIPT_SIDEPANEL_INIT,
  SCRIPT_SIDEBUTTON_SWITCH,
  content,
  boatType,
  setVarbit,
  animateDeckLocs,
  isSail,
} = require("./sailingContent");

const SEQ_SAIL_DOWN = 13367;

/** Values from live OSRS boarding traces (docs/sailing-osrs-reference.md). */
function boardedVarbits(type, owned) {
  const slot = owned.slot + 1;
  const stats = type.stats ?? {};
  return {
    [VARBIT.BOARDED_BOAT]: 1,
    [VARBIT.BOARDED_BOAT_WORLD]: 1,
    [VARBIT.BOARDED_BOAT_TYPE]: type.typeId,
    [VARBIT.PLAYER_IS_ON_PLAYER_BOAT]: 1,
    [VARBIT.BOAT_SPAWNED]: slot,
    [VARBIT.LAST_PERSONAL_BOAT_BOARDED]: slot,
    [VARBIT.PREVIOUS_BOAT_DATA_SLOT]: slot,
    [VARBIT.PREVIOUS_BOAT_TYPE_ID]: type.typeId,
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
    [VARBIT.SIDEPANEL_BOAT_BASESPEED]: stats.baseSpeed ?? 0,
    [VARBIT.SIDEPANEL_BOAT_SPEEDCAP]: stats.speedCap ?? 0,
    [VARBIT.SIDEPANEL_BOAT_SPEEDBOOST_DURATION]: stats.speedBoostDuration ?? 0,
    [VARBIT.SIDEPANEL_BOAT_ACCELERATION]: stats.acceleration ?? 0,
  };
}

function boardedVarps(type) {
  const varps = { [VARP_SIDEPANEL_BOAT_TYPE]: type.sidepanelBoatType };
  for (const [stat, varp] of Object.entries(VARP_SIDEPANEL_DEFENCE)) varps[varp] = type.stats?.[stat] ?? 0;
  return varps;
}

const COMBAT_OPTIONS_GROUP = 593;
const VIEW_SAILING_OPTIONS_CHILD = 46;
/**
 * The sidepanel's "View Combat Options" is built at runtime inside 937:1 (script 8715, from
 * the panel's onLoad 8710 via 8712), from several pieces; OSRS enables op 1 on its slots 0-12.
 */
const VIEW_COMBAT_OPTIONS_CHILD = 1;
const VIEW_COMBAT_OPTIONS_MAX_SLOT = 12;
const IF_EVENT_OP1 = 1 << 1;
const IF_EVENT_OP1_TO_OP4 = IF_EVENT_OP1 | (1 << 2) | (1 << 3) | (1 << 4);

/** Everything reset when leaving a boat, whatever set it. */
const LEFT_VARBITS = [
  VARBIT.BOARDED_BOAT,
  VARBIT.BOARDED_BOAT_WORLD,
  VARBIT.BOARDED_BOAT_TYPE,
  VARBIT.PLAYER_IS_ON_PLAYER_BOAT,
  VARBIT.BOAT_SPAWNED,
  VARBIT.FACILITY_LOCKEDIN,
  VARBIT.SIDEPANEL_VISIBLE,
  VARBIT.SIDEPANEL_VISIBLE_FROM_COMBAT_TAB,
  VARBIT.SIDEPANEL_BOAT_MOVE_MODE,
  VARBIT.SIDEPANEL_SAIL_BUTTON_TOGGLED,
  VARBIT.SIDEPANEL_PLAYER_AT_HELM,
  VARBIT.SIDEPANEL_BOAT_BASESPEED,
  VARBIT.SIDEPANEL_BOAT_SPEEDCAP,
  VARBIT.SIDEPANEL_BOAT_SPEEDBOOST_DURATION,
  VARBIT.SIDEPANEL_BOAT_ACCELERATION,
];

function applyBoarded(player, owned) {
  const type = boatType(owned.type);
  if (!type) return;
  const varbits = boardedVarbits(type, owned);
  const varps = boardedVarps(type);
  for (const [id, value] of Object.entries(varbits)) setVarbit(player, Number(id), value);
  const sender = player.getPacketSender();
  for (const [id, value] of Object.entries(varps)) sender.sendConfig(Number(id), value);
  sender.sendInterfaceScript(SCRIPT_SIDEPANEL_INIT, [player.getUsername(), 1, "", 1]);
  sender.sendInterfaceScript(SCRIPT_SIDEBUTTON_SWITCH, [0]);
  // Bundle the varbits with the open so the sidepanel's onLoad scripts see them.
  sender.sendSubInterface(COMBAT_TAB_UID, SIDEPANEL_GROUP, 1, { varbits, varps });
  sender.sendInterfaceFlagsRange(
    (SIDEPANEL_GROUP << 16) | VIEW_COMBAT_OPTIONS_CHILD, 0, VIEW_COMBAT_OPTIONS_MAX_SLOT, IF_EVENT_OP1);
  sender.sendInterfaceFlagsRange(
    (SIDEPANEL_GROUP << 16) | SIDEPANEL_FACILITIES_CHILD, 0, type.sidepanelFacilitySlots, IF_EVENT_OP1_TO_OP4);
}

/** A tick after boarding, once the deck scene (or, on login, the gameframe) is in place. */
function onBoarded({ player, boat, owned }) {
  TaskManager.submit(new (class extends Task {
    constructor() { super(1, player); }
    execute() {
      if (player.getArea()?.boat !== boat) return this.stop();
      applyBoarded(player, owned);
      // Boarding lowers the sails to rest.
      animateDeckLocs(player, boat, isSail, SEQ_SAIL_DOWN);
      this.stop();
    }
  })());
}

function onLeft({ player, reason }) {
  // A player logging out has no client left to update.
  if (reason === "logout") return;
  for (const id of LEFT_VARBITS) setVarbit(player, id, 0);
  for (const varp of Object.values(VARP_SIDEPANEL_DEFENCE)) player.getPacketSender().sendConfig(varp, 0);
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
