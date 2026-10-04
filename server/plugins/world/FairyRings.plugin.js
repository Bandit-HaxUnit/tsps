/**
 * Fairy rings (https://oldschool.runescape.wiki/w/Fairy_ring).
 *
 * The cache's fairy ring objects open interface 398, whose three dials are
 * driven by varbits 3985/3986/3987 (0-3 over the letters A-D, I-L, P-S). This
 * plugin serves the Wiki code table from data/definitions/fairy-rings.json,
 * gates use on the Fairytale II - Cure a Queen quest and a dramen/lunar staff,
 * and teleports on Confirm. The last code is persisted per player.
 *
 * ponytail: Fairytale II - Cure a Queen is not implemented, so the quest check
 * passes when the quest is not registered rather than blocking every player.
 */
const fs = require("fs");
const path = require("path");
const { Location } = require("../../src/main/typescript/elvarg/game/model/Location");
const QuestRuntime = require("../quests/QuestRuntime");

const FAIRY_RING_INTERFACE_ID = 398;
const CONFIRM_CHILD_ID = 26;
const DIAL_VARBITS = [3985, 3986, 3987];
const DIAL_LETTERS = [["A", "B", "C", "D"], ["I", "J", "K", "L"], ["P", "Q", "R", "S"]];
const LAST_CODE_ATTRIBUTE = "fairy-rings:last";
const FAIRYQUEST_NAME = "Fairytale II - Cure a Queen";

let core = null;
let destinationsByCode = new Map();
let staffIds = new Set();

function loadDestinations() {
  const file = path.join(core.GameConstants.DEFINITIONS_DIRECTORY, "fairy-rings.json");
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const byCode = new Map();
  for (const entry of data.destinations ?? []) {
    const code = String(entry.code ?? "").toUpperCase();
    if (!/^[ABCDIJKLPQRS]{3}$/.test(code)) {
      throw new Error(`[fairy-rings] invalid code ${entry.code}`);
    }
    if (byCode.has(code)) {
      throw new Error(`[fairy-rings] duplicate code ${code}`);
    }
    byCode.set(code, new Location(entry.x, entry.y, entry.z ?? 0));
  }
  return byCode;
}

function hasStaff(player) {
  const equipment = player.getEquipment();
  const inventory = player.getInventory();
  for (const id of staffIds) {
    if (equipment.contains(id) || inventory.contains(id)) {
      return true;
    }
  }
  return false;
}

function questAllows(player) {
  const quest = QuestRuntime.getRegisteredQuests().find((entry) => entry.name === FAIRYQUEST_NAME);
  return quest ? quest.isComplete(player) : true;
}

function codeFromDials(player) {
  const sender = player.getPacketSender();
  return DIAL_VARBITS.map((varbit, index) => {
    const value = sender.getVarbit(varbit);
    return DIAL_LETTERS[index][Math.max(0, Math.min(3, value))];
  }).join("");
}

function setDials(player, code) {
  const sender = player.getPacketSender();
  for (let dial = 0; dial < DIAL_VARBITS.length; dial++) {
    const index = DIAL_LETTERS[dial].indexOf(code?.[dial] ?? "");
    sender.sendVarbit(DIAL_VARBITS[dial], index >= 0 ? index : 0);
  }
}

function canUse(player) {
  if (!hasStaff(player)) {
    player.sendMessage("You need a dramen or lunar staff to use the fairy rings.");
    return false;
  }
  if (!questAllows(player)) {
    player.sendMessage("You need to have started Fairytale II - Cure a Queen to use the fairy rings.");
    return false;
  }
  return true;
}

function openDial({ player }) {
  if (!player || !canUse(player)) {
    return;
  }
  setDials(player, String(player.getAttribute(LAST_CODE_ATTRIBUTE) ?? ""));
  player.getPacketSender().sendInterface(FAIRY_RING_INTERFACE_ID);
}

function lastDestination({ player }) {
  if (!player || !canUse(player)) {
    return;
  }
  const code = String(player.getAttribute(LAST_CODE_ATTRIBUTE) ?? "");
  const destination = destinationsByCode.get(code);
  if (!destination) {
    openDial({ player });
    return;
  }
  teleport(player, code, destination);
}

function teleport(player, code, destination) {
  if (!core.TeleportHandler.checkReqs(player, destination)) {
    return false;
  }
  player.getPacketSender().sendInterfaceRemoval();
  player.setAttribute(LAST_CODE_ATTRIBUTE, code);
  core.TeleportHandler.teleport(player, destination, core.TeleportType.NORMAL, false);
  return true;
}

function confirmDial(event) {
  const buttonId = Number(event.buttonId ?? 0);
  const groupId = event.groupId ?? (buttonId >> 16);
  const childId = event.childId ?? (buttonId & 0xffff);
  if (groupId !== FAIRY_RING_INTERFACE_ID || childId !== CONFIRM_CHILD_ID) {
    return;
  }
  const { player } = event;
  const code = codeFromDials(player);
  const destination = destinationsByCode.get(code);
  if (!destination) {
    player.sendMessage("The fairy ring combination is not a valid destination.");
    return;
  }
  teleport(player, code, destination);
}

function attach(pluginApi) {
  core = pluginApi.core;
  staffIds = new Set([
    core.ItemIdentifiers.DRAMEN_STAFF,
    core.ItemIdentifiers.LUNAR_STAFF,
  ]);
  destinationsByCode = loadDestinations();
}

module.exports = {
  name: "FairyRings",
  members: true,
  _test: {
    loadDestinations: () => loadDestinations(),
    codeFromDials,
    setDials,
    canUse,
    openDial,
    lastDestination,
    confirmDial,
    teleport,
    DIAL_VARBITS,
    DIAL_LETTERS,
    FAIRY_RING_INTERFACE_ID,
    CONFIRM_CHILD_ID,
    LAST_CODE_ATTRIBUTE,
  },
  register(api) {
    attach(api);
    api.persistAttribute(LAST_CODE_ATTRIBUTE);
    api.onObjectInteraction("Fairy ring", { Configure: openDial, "Last-destination": lastDestination });
    api.onInterfaceActionClick(confirmDial);
    api.log("registered", { destinations: destinationsByCode.size });
  },
};
