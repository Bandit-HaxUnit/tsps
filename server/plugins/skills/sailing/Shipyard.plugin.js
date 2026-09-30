// The shipyard: a shipwright's Customise-boat takes the player there with the chosen boat, the
// boat schematics (interface 939) swap its hull, keel, sails or helm for another tier, and the
// portal returns them to the dock. Upgrades and downgrades cost the part's materials and give
// Construction XP; the old part isn't refunded. The flow follows a live capture of Junior Jim
// (docs/sailing-osrs-reference.md); part options, levels and materials are the cache's.
const { Sailing } = require("../../../src/main/typescript/elvarg/game/content/sailing/Sailing");
const { BoatManager } = require("../../../src/main/typescript/elvarg/game/content/sailing/BoatManager");
const { Mobile } = require("../../../src/main/typescript/elvarg/game/entity/impl/Mobile");
const { Location } = require("../../../src/main/typescript/elvarg/game/model/Location");
const { Skill } = require("../../../src/main/typescript/elvarg/game/model/Skill");
const { Task } = require("../../../src/main/typescript/elvarg/game/task/Task");
const { TaskManager } = require("../../../src/main/typescript/elvarg/game/task/TaskManager");
const { DialogueChainBuilder } = require("../../../src/main/typescript/elvarg/game/model/dialogues/builders/DialogueChainBuilder");
const { StatementDialogue } = require("../../../src/main/typescript/elvarg/game/model/dialogues/entries/impl/StatementDialogue");
const { EndDialogue } = require("../../../src/main/typescript/elvarg/game/model/dialogues/entries/impl/EndDialogue");
const { VARBIT, content, boatType, setVarbit, fade } = require("./sailingContent");
const { describeBoat, boatVarps, clearBoatVarps, openSidepanel, DESCRIPTION_VARBITS } = require("./sidepanel");
const { sendBoatVarbits } = require("./boatVarbits");
const { sendToolUnlocks } = require("./cargo");
const parts = require("./boatParts");
const { MODE, openBoatSelection } = require("./BoatSelection.plugin");

/** Where the player and their boat stand in the shipyard (map square 32, 42), as captured. */
const SHIPYARD = {
  arrival: { x: 2084, y: 2730, z: 0 },
  boat: { fineX: 2091 * 128 + 64, fineY: 2724 * 128, level: 0, angle: 1536 },
  bounds: { minX: 2048, maxX: 2111, minY: 2688, maxY: 2751 },
};
const VARBIT_SHIPYARD_MODE = 19173;
const VARBIT_SHIPYARD_BOAT_ANGLE = 19519;
const VARBIT_SHIPYARD_BOAT_OFFSET_FINEX = 19520;
const VARBIT_CUSTOMISATION_SLOT = 19525;
const VARP_CUSTOMISATION_BOAT = 5190;
const CUSTOMISATION = 939;
const CUSTOMISATION_OPTIONS = 17;
const MAIN_MODAL = (161 << 16) | 16;
const SCRIPT_MAINMODAL_OPEN = 2524;
const SCRIPT_CUSTOMISATION_INIT = 8809;
const IF_EVENT_OP1 = 1 << 1;
/** Ticks from a build's fade out to its fade in, as captured. */
const REBUILD_FADE_TICKS = 4;
/** How each part is named when swapped ("…you swap out the hull of your boat."). */
const PART_NAMES = { hull: "hull", keel: "keel", sails: "mast and sails", helm: "helm" };

/** Per player in the shipyard: the boat slot being customised and the boat shown. */
const visits = new Map();

function later(player, ticks, action) {
  TaskManager.submit(new (class extends Task {
    constructor() { super(ticks, player); }
    execute() {
      action();
      this.stop();
    }
  })());
}

function inShipyard(location) {
  const { minX, maxX, minY, maxY } = SHIPYARD.bounds;
  return location.x >= minX && location.x <= maxX && location.y >= minY && location.y <= maxY;
}

function ownedBoat(player, slot) {
  return player.getSailing().boats.find((boat) => boat.slot === slot);
}

/** Shows the boat in the shipyard, built from its parts, and describes it on the sidepanel. */
function showBoat(player, visit) {
  if (visit.shown) BoatManager.dispose(visit.shown);
  const boat = ownedBoat(player, visit.slot);
  const spec = boat && Sailing.specFor(boat);
  visit.shown = spec ? BoatManager.spawn(player.getIndex(), spec, SHIPYARD.boat) : undefined;
  const type = boatType(boat?.type);
  if (!type) return;
  const varbits = {
    ...describeBoat(type, boat),
    [VARBIT_SHIPYARD_MODE]: 1,
    [VARBIT_SHIPYARD_BOAT_ANGLE]: SHIPYARD.boat.angle,
    [VARBIT_SHIPYARD_BOAT_OFFSET_FINEX]: 1,
    [VARBIT.SIDEPANEL_VISIBLE]: 1,
  };
  const varps = boatVarps(type, boat);
  for (const [id, value] of Object.entries(varbits)) setVarbit(player, Number(id), value);
  for (const [id, value] of Object.entries(varps)) player.getPacketSender().sendConfig(Number(id), value);
  openSidepanel(player, type, varbits, varps);
  sendBoatVarbits(player);
}

/** Ends a shipyard visit: the shown boat goes and the sidepanel stops describing it. */
function endVisit(player) {
  const visit = visits.get(player);
  if (!visit) return;
  visits.delete(player);
  if (visit.shown) BoatManager.dispose(visit.shown);
  for (const id of [...DESCRIPTION_VARBITS, VARBIT_SHIPYARD_MODE, VARBIT_SHIPYARD_BOAT_ANGLE,
    VARBIT_SHIPYARD_BOAT_OFFSET_FINEX, VARBIT.SIDEPANEL_VISIBLE]) {
    setVarbit(player, id, 0);
  }
  // Back to what the tools unlock says (::sailingtools).
  setVarbit(player, VARBIT.SAILING_INTRO, 0);
  sendToolUnlocks(player);
  clearBoatVarps(player);
  player.getPacketSender().sendTabInterface(0, 0);
}

function enterShipyard(player, dock, slot) {
  const boat = ownedBoat(player, slot);
  if (!boat || boat.location.kind !== "docked" || boat.location.dock !== dock.id) {
    player.sendMessage("You can't choose that boat at the moment.");
    return;
  }
  fade(player, true);
  later(player, 1, () => {
    beginVisit(player, dock, slot);
    later(player, 1, () => fade(player, false));
  });
}

/** Puts the player in the shipyard with the boat in `slot` shown. */
function beginVisit(player, dock, slot) {
  player.moveTo(new Location(SHIPYARD.arrival.x, SHIPYARD.arrival.y, SHIPYARD.arrival.z));
  const visit = { slot, dock: dock.id, shown: undefined };
  visits.set(player, visit);
  // Owning a boat means The Pandemonium is done; the customisation refuses every build without
  // it (script 8807 via 9022). Only for the visit, so the tools stay behind ::sailingtools.
  setVarbit(player, VARBIT.SAILING_INTRO, 50);
  showBoat(player, visit);
}

/** A shipwright's Customise-boat: choose the boat, then go to the shipyard with it. */
function customiseBoat({ player, npc }) {
  const name = npc.getDefinition?.()?.getName?.() ?? "";
  const dock = content().docks.find((candidate) => candidate.shipwright === name);
  if (!dock) return false;
  openBoatSelection(player, MODE.CUSTOMISE, dock, (slot) => enterShipyard(player, dock, slot));
}

/** The boat schematics' Modify: the customisation interface for the boat in the shipyard. */
function openSchematics({ player }) {
  const visit = visits.get(player);
  const boat = visit && ownedBoat(player, visit.slot);
  const type = boatType(boat?.type);
  if (!type) return;
  const sender = player.getPacketSender();
  sender.sendConfig(VARP_CUSTOMISATION_BOAT, type.sidepanelBoatType);
  setVarbit(player, VARBIT_CUSTOMISATION_SLOT, visit.slot + 1);
  sender.sendInterfaceScript(SCRIPT_MAINMODAL_OPEN, [-1, -3]);
  player.setInterfaceId(CUSTOMISATION);
  sender.sendSubInterface(MAIN_MODAL, CUSTOMISATION, 0);
  sender.sendInterfaceScript(SCRIPT_CUSTOMISATION_INIT);
  sender.sendInterfaceFlagsRange((CUSTOMISATION << 16) | CUSTOMISATION_OPTIONS, 0, 50, IF_EVENT_OP1);
}

/** The Build trigger's argument: the option's db row, as our client sends an int (zigzag varint). */
function readOptionRow(argsData) {
  if (!argsData?.length) return undefined;
  let value = 0;
  let shift = 0;
  for (const byte of argsData) {
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return (value >>> 1) ^ -(value & 1);
    shift += 7;
  }
  return undefined;
}

function refusal(player, requirements) {
  const skills = player.getSkillManager();
  if (skills.getMaxLevel(Skill.SAILING) < requirements.sailing
    || skills.getMaxLevel(Skill.CONSTRUCTION) < requirements.construction) {
    return `You need a Sailing level of ${requirements.sailing} and a Construction level of ${requirements.construction} to build that.`;
  }
  const inventory = player.getInventory();
  if (requirements.materials.some(([item, count]) => inventory.getAmount(item) < count)) {
    return "You don't have the materials needed to build that.";
  }
  return null;
}

/** Builds the chosen option on the boat: its part becomes that tier. */
function build(player, optionRow) {
  const visit = visits.get(player);
  const boat = visit && ownedBoat(player, visit.slot);
  const option = boat && parts.optionFor(boat, optionRow);
  if (!option) return;
  if ((boat.parts?.[option.part] ?? 0) === option.tier) {
    player.sendMessage("Your boat already has that.");
    return;
  }
  const requirements = parts.requirementsOf(option.part, optionRow);
  const refused = refusal(player, requirements);
  if (refused) {
    player.sendMessage(refused);
    return;
  }
  for (const [item, count] of requirements.materials) player.getInventory().delete(item, count);
  boat.parts = { ...boat.parts, [option.part]: option.tier };
  player.getSkillManager().addExperience(Skill.CONSTRUCTION, parts.constructionXp(boat.type, option.part, option.tier), true);
  player.getPacketSender().sendInterfaceRemoval();
  player.getPacketSender().sendConfig(VARP_CUSTOMISATION_BOAT, -1);
  setVarbit(player, VARBIT_CUSTOMISATION_SLOT, 0);
  // As captured: the message shows while the screen fades and the boat is rebuilt, and can be
  // continued once it fades back in.
  const message = `With the help of some workers, you swap out the ${PART_NAMES[option.part]} of your boat.`;
  StatementDialogue.send(player, message, false);
  fade(player, true);
  later(player, 1, () => showBoat(player, visit));
  later(player, REBUILD_FADE_TICKS, () => {
    fade(player, false);
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
      new StatementDialogue(0, message),
      new EndDialogue(1),
    ));
  });
}

function clickCustomisation(event) {
  if (event.groupId !== CUSTOMISATION || event.childId !== CUSTOMISATION_OPTIONS || !event.scriptTrigger) return;
  event.handled = true;
  const optionRow = readOptionRow(event.argsData);
  if (optionRow !== undefined) build(event.player, optionRow);
}

/** The Shipyard Portal's Exit: back to the dock the visit started from. */
function exitShipyard({ player }) {
  const dock = content().docks.find((candidate) => candidate.id === visits.get(player)?.dock)
    ?? content().docks.find((candidate) => candidate.shipyardReturn);
  const spot = dock?.shipyardReturn;
  if (!spot) return;
  fade(player, true);
  later(player, 1, () => {
    endVisit(player);
    player.moveTo(new Location(spot.x, spot.y, spot.z));
    later(player, 1, () => fade(player, false));
  });
}

/** Any move out of the shipyard (a teleport, the portal) ends the visit. */
function leaveOnMove(mobile, target) {
  if (!mobile.isPlayer?.() || !visits.has(mobile)) return;
  if (!inShipyard(target)) endVisit(mobile);
}

/** The boat a player is customising in the shipyard, if any. */
function visitedBoat(player) {
  const visit = visits.get(player);
  return visit ? ownedBoat(player, visit.slot) : undefined;
}

function forgetVisit({ player }) {
  const visit = visits.get(player);
  if (visit?.shown) BoatManager.dispose(visit.shown);
  visits.delete(player);
}

/** A player saved in the shipyard (logged out there) comes back at the dock's return spot. */
function returnFromShipyard({ player }) {
  if (!inShipyard(player.getLocation())) return;
  const spot = content().docks.find((dock) => dock.shipyardReturn)?.shipyardReturn;
  if (spot) player.moveTo(new Location(spot.x, spot.y, spot.z));
}

module.exports = {
  name: "SailingShipyard",
  readOptionRow,
  beginVisit,
  visitedBoat,
  register(api) {
    content();
    const { docks } = content();
    for (const shipwright of new Set(docks.map((dock) => dock.shipwright).filter(Boolean))) {
      api.onNpcInteraction(shipwright, { "Customise-boat": customiseBoat });
    }
    api.onObjectInteraction("Boat schematics", { Modify: openSchematics });
    api.onObjectInteraction("Shipyard Portal", { Exit: exitShipyard });
    api.onInterfaceActionClick(clickCustomisation);
    api.onPlayerLogout(forgetVisit);
    api.onPlayerLogin(returnFromShipyard);
    Mobile.onBeforeTeleport(leaveOnMove);
  },
};
