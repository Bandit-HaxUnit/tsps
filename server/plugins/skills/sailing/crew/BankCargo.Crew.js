// A dock crewmate banking a boat's cargo hold. Live (rsprox, Cabin Boy Jenkins on the
// Pandemonium's dock): "Can you help bank my cargo hold contents?" opens the boat selection in
// its bank cargo mode (11) with the dock's row; the Bank-cargo option does the same at once.
// After the choice the crewmate's transcript carries on from there (not captured: the Wiki's
// "Move all available items from your cargo hold to your bank?", their lines, "Your crew start
// moving the contents of the cargo hold...", and whether the bank had room). Everything in the
// chosen boat's hold that fits goes to the bank.
const common = require("./Common.Crew");
const lines = require("./Lines.Crew");
const cargo = require("../Cargo.Sailing");
const { openBoatSelection, MODE } = require("../BoatSelection.plugin");
const { dockNear } = require("../SailingContent.Sailing");

const MOVE_CARGO = "Move Cargo to Bank";
/** Where the dock crewmates stand: next to the boat's dock. */
const DOCK_RANGE = 16;
/** The message steps that start the move (Jenkins, without a ghostspeak amulet, has his own). */
const MOVING = /^(Your crew start moving the contents of the cargo hold|With a confusing mixture of flailing and hand gestures)/;

/** Per player: the dock, the boat chosen and whether everything fitted, for the conversation's conditions. */
const banking = new WeakMap();

function cache() {
  return common.core();
}

/** The player's boats docked at a dock. */
function boatsAt(player, dock) {
  return player.getSailing().boats.filter((boat) => boat.location.kind === "docked" && boat.location.dock === dock.id);
}

function holdEmpty(boat) {
  return !boat || boat.cargo.every((slot) => !slot || slot.amount <= 0);
}

/** Moves a boat's cargo into the bank, as much as fits; true if all of it did. */
function moveToBank(player, boat) {
  const { Bank, Item } = cache();
  let all = true;
  boat.cargo.forEach((slot, index) => {
    if (!slot || slot.amount <= 0) return;
    const tab = Bank.getTabForItem(player, slot.id);
    const bank = player.getBank(tab);
    if (!bank.contains(slot.id) && bank.getFreeSlots() <= 0) {
      all = false;
      return;
    }
    bank.add(new Item(slot.id, slot.amount), false);
    boat.cargo[index] = null;
  });
  if (Bank.isOpen(player)) player.getBank(player.getCurrentBankTab()).refreshItems();
  return all;
}

/** The crewmate's at-port variant: where their bank-cargo conversation lives, if they have one. */
function portVariant(player, crew) {
  return crew.variants.find((rule) => rule.at === "dock"
    && (rule.ghostspeak === undefined || rule.ghostspeak === common.hearsGhosts(player)))?.variant;
}

/**
 * Opens the boat selection for banking. The chosen boat's cargo is moved once the conversation
 * reaches its "moving the contents" message; a crewmate with no such conversation moves it at once.
 */
function chooseBoat(player, npc, crew) {
  const dock = dockNear(player, DOCK_RANGE);
  if (!dock) return;
  openBoatSelection(player, MODE.BANK_CARGO, dock, (slot) => {
    const boat = player.getSailing().boats.find((candidate) => candidate.slot === slot);
    if (!boat || !boatsAt(player, dock).includes(boat)) return;
    banking.set(player, { dock, boat, fitted: undefined });
    if (!continueConversation(player, npc, crew)) moved(player);
  });
}

/** Plays the crewmate's conversation from after the "Move Cargo to Bank" interface. */
function continueConversation(player, npc, crew) {
  const variant = portVariant(player, crew);
  const steps = variant && lines.variantSteps(crew.page, variant);
  const opens = lines.findStep(steps, (step) => step?.action === "open_interface" && step?.target === MOVE_CARGO);
  if (!opens) return false;
  const request = {
    player, npc, npcId: crew.npcs.dock, variant, exact: true, handled: false,
    select: (all) => lines.stepsAfter(all, opens.id),
  };
  cache().PluginManager.emitCustomEvent("npc-dialogue:start", request);
  return request.handled;
}

function moved(player) {
  const state = banking.get(player);
  if (!state || state.fitted !== undefined) return;
  state.fitted = moveToBank(player, state.boat);
}

function crewOnDock(player, npcId) {
  const found = common.byNpc(npcId);
  return found?.at === "dock" ? found.crew : undefined;
}

/** The transcript's "Move Cargo to Bank" interface: the boat selection, a tick later (the chat closes first). */
function onAction(event) {
  const crew = crewOnDock(event.player, event.npcId);
  if (!crew) return;
  if (event.action === "open_interface" && event.target === MOVE_CARGO) {
    event.handled = true;
    event.end = true;
    const { player, npc } = event;
    const { CountdownTask, TaskManager } = cache();
    TaskManager.submit(new CountdownTask(player, 1, () => chooseBoat(player, npc, crew)));
    return;
  }
  if (event.kind === "message" && MOVING.test(String(event.text ?? ""))) moved(event.player);
}

/** "If cargo hold is already empty:" (every boat docked here) and whether the bank had room. */
function answerCondition({ player, npcId, text }) {
  if (!crewOnDock(player, npcId)) return null;
  const condition = String(text ?? "").toLowerCase();
  if (/cargo hold is already empty/.test(condition)) {
    const dock = dockNear(player, DOCK_RANGE);
    return dock ? boatsAt(player, dock).every(holdEmpty) : true;
  }
  if (/items in the cargo hold/.test(condition)) {
    const dock = dockNear(player, DOCK_RANGE);
    return dock ? !boatsAt(player, dock).every(holdEmpty) : false;
  }
  if (/bank (has|doesn't have) space|(sufficient|insufficient) room in your bank/.test(condition)) {
    const fitted = banking.get(player)?.fitted;
    if (fitted === undefined) return null;
    return /doesn't have|insufficient/.test(condition) ? !fitted : fitted;
  }
  return null;
}

/** The Bank-cargo option: the boat selection straight away. */
function bankCargo({ player, npc, npcId }) {
  const crew = crewOnDock(player, npcId);
  if (!crew) return false;
  chooseBoat(player, npc, crew);
  return true;
}

function attach(api) {
  common.init(api);
  api.onNpcsInteraction(common.all().map((crew) => crew.name), { "Bank-cargo": bankCargo });
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:action", onAction);
}

module.exports = attach;
module.exports.moveToBank = moveToBank;
module.exports.answerCondition = answerCondition;
