// Bounty tasks (Wiki: Bounty tasks; rsprox: the user's crew-combat capture of the Pandemonium tern
// bounty). Taken at a notice board as couriers are: the slot's bounty_task_item_counter_n holds the
// parts still to collect (5 for the tern beaks). Harvesting the task's creature
// (seacombat/Loot.SeaCombat.js) rolls its part at 1 in the task's rarity (cache table 197:
// bounty_target_alive, bounty_object, bounty_object_amount, bounty_object_rarity) while parts are
// still needed: "<name> has harvested 1x Tern beak.", "Untradeable drop: Tern beak" and a jingle,
// the counter going down. A second bounty on the same creature waits for the first (Wiki). With all
// the parts, any port master's Claim-rewards hands them in (from the inventory, then the boat's
// hold): the creature's bounty XP and as many coins (Wiki; the cache leaves xp_reward empty),
// rarely shark paint. Cancelling keeps the parts (Wiki).
const common = require("./Common.PortTasks");
const cargo = require("../Cargo.Sailing");
const seaData = require("../data/sea-combat.json");

const TASK_TABLE = 197;
/** bounty_task_item_counter_1..5, one per task slot (gamevals). */
const COUNTER_VARBITS = [14662, 14663, 14819, 15370, 15397];
const COINS = 995;
const JINGLE = 6765;
const JINGLE_DELAY = 30;

/** A bounty task's creature, part, how many and how rare, from its cache row. */
function bountyOf(task) {
  if (task?.type !== "bounty") return undefined;
  const { CacheDefinitions } = common.core();
  const row = CacheDefinitions.getDbRow(task.row);
  const column = (name) => CacheDefinitions.getDbColumn(TASK_TABLE, name);
  const value = (name) => {
    const index = column(name);
    return index === null ? -1 : row?.int(index, -1) ?? -1;
  };
  const creature = value("bounty_target_alive");
  return {
    creature,
    part: value("bounty_object"),
    amount: Math.max(1, value("bounty_object_amount")),
    rarity: Math.max(1, value("bounty_object_rarity")),
    xp: seaData.creatures.find((candidate) => candidate.npc === creature)?.bountyXp ?? 0,
  };
}

/** Parts still to collect for a held bounty slot. */
function remaining(slot, bounty) {
  return Math.max(0, bounty.amount - (slot.collected ?? 0));
}

function sendCounters(player) {
  const sender = player.getPacketSender();
  common.slots(player).forEach((slot, index) => {
    const bounty = slot && bountyOf(common.taskById(slot.id));
    sender.sendVarbit(COUNTER_VARBITS[index], bounty ? remaining(slot, bounty) : 0);
  });
}

function itemName(itemId) {
  return common.core().ItemDefinition.forId(itemId)?.getName?.() ?? "item";
}

/** Each creature's bounty parts, from every bounty task (cache table 197). */
let partsByCreature;
function bountyParts(creatureId) {
  if (!partsByCreature) {
    partsByCreature = new Map();
    for (const task of common.DATA.tasks) {
      const bounty = bountyOf(task);
      if (!bounty || bounty.part < 0) continue;
      if (!partsByCreature.has(bounty.creature)) partsByCreature.set(bounty.creature, new Set());
      partsByCreature.get(bounty.creature).add(bounty.part);
    }
  }
  return partsByCreature.get(creatureId) ?? new Set();
}

/**
 * A harvest of a bounty's creature may give its part (only the first such bounty's). The drop
 * tables list the parts as tertiary drops (Wiki: only while on a bounty task); they come only
 * from here, so the table's own rolls of them go.
 */
function onHarvest(harvest, random = Math.random) {
  const { player, creature, extra } = harvest;
  const parts = bountyParts(creature.npc);
  if (Array.isArray(harvest.drops) && parts.size) {
    for (let i = harvest.drops.length - 1; i >= 0; i--) if (parts.has(harvest.drops[i].itemId)) harvest.drops.splice(i, 1);
  }
  const held = common.slots(player);
  const index = held.findIndex((slot) => {
    const bounty = slot && bountyOf(common.taskById(slot.id));
    return bounty?.creature === creature.npc && remaining(slot, bounty) > 0;
  });
  if (index < 0) return;
  const bounty = bountyOf(common.taskById(held[index].id));
  if (random() >= 1 / bounty.rarity) return;
  held[index] = { ...held[index], collected: (held[index].collected ?? 0) + 1 };
  player.setAttribute(common.SLOTS_ATTRIBUTE, held);
  player.getPacketSender().sendVarbit(COUNTER_VARBITS[index], remaining(held[index], bounty));
  const name = itemName(bounty.part);
  player.sendMessage(`${player.getUsername()} has harvested 1x ${name}.`);
  player.sendMessage(`<col=ef1020>Untradeable drop: ${name}</col>`);
  player.getPacketSender().sendSoundEffect(JINGLE, 1, JINGLE_DELAY, 10);
  extra.push({ itemId: bounty.part, amount: 1 });
}

/** Parts kept from a cancelled bounty of the same kind count towards a new one (Wiki). */
function harvested(harvest) {
  onHarvest(harvest);
}

function onAccepted({ player, index, task }) {
  const bounty = bountyOf(task);
  const held = common.slots(player);
  if (bounty && held[index]) {
    const owned = common.core().Sailing.activeBoat(player);
    const kept = player.getInventory().getAmount(bounty.part) + (owned ? cargo.countIn(owned, bounty.part) : 0);
    // Parts another held bounty already counts stay with that one.
    const counted = held.reduce((total, slot, other) => {
      const otherBounty = other !== index && slot ? bountyOf(common.taskById(slot.id)) : undefined;
      return total + (otherBounty?.part === bounty.part ? slot.collected ?? 0 : 0);
    }, 0);
    held[index] = { ...held[index], collected: Math.min(bounty.amount, Math.max(0, kept - counted)) };
    player.setAttribute(common.SLOTS_ATTRIBUTE, held);
  }
  sendCounters(player);
}

/** Takes a bounty's parts from the inventory, then the active boat's hold; false when short. */
function handIn(player, bounty) {
  const inventory = player.getInventory();
  const owned = common.core().Sailing.activeBoat(player);
  const inHold = owned ? cargo.countIn(owned, bounty.part) : 0;
  const carried = inventory.getAmount(bounty.part);
  if (carried + inHold < bounty.amount) return false;
  const fromInventory = Math.min(carried, bounty.amount);
  if (fromInventory > 0) inventory.deleteNumber(bounty.part, fromInventory);
  if (bounty.amount > fromInventory && owned) cargo.take(owned, 0, bounty.part, bounty.amount - fromInventory);
  return true;
}

/** The coins: in the inventory, or the bank when it has no room for them. */
function payCoins(player, amount) {
  const { Item, Bank } = common.core();
  const inventory = player.getInventory();
  if (inventory.getAmount(COINS) > 0 || inventory.getFreeSlots() > 0) {
    inventory.add(new Item(COINS, amount), true);
    return;
  }
  player.getBank(Bank.getTabForItem(player, COINS)).add(new Item(COINS, amount), true);
  player.sendMessage("The coins have been sent to your bank.");
}

function onCancelled({ player }) {
  sendCounters(player);
}

function onLogin({ player }) {
  sendCounters(player);
}

/**
 * Completed bounties handed in at a port master's Claim-rewards (before the unclaimed rewards).
 * Sets `handedIn` when any was.
 */
function claim(event, random = Math.random) {
  const { player } = event;
  const ledger = require("./Ledger.PortTasks");
  const board = require("./Board.PortTasks");
  const { Skill } = common.core();
  const held = common.slots(player);
  held.forEach((slot, index) => {
    const task = slot && common.taskById(slot.id);
    const bounty = bountyOf(task);
    if (!bounty || remaining(slot, bounty) > 0 || !handIn(player, bounty)) return;
    const now = common.slots(player);
    now[index] = null;
    common.setSlots(player, now);
    player.getPacketSender().sendVarbit(COUNTER_VARBITS[index], 0);
    player.getSkillManager().addExperiences(Skill.SAILING, bounty.xp);
    if (bounty.xp > 0) payCoins(player, bounty.xp);
    if (random() < ledger.SHARK_PAINT_CHANCE) ledger.give(player, ledger.SHARK_PAINT);
    ledger.countCompletion(player);
    board.replaceOnBoard(player, task);
    player.sendMessage(`You have finished the ${common.blue(task.name)} port task.`);
    event.handedIn = true;
  });
}

function attach(api) {
  common.init(api);
  api.onCustomEvent("sea-combat:harvest", harvested);
  api.onCustomEvent("port-tasks:bounty-accepted", onAccepted);
  api.onCustomEvent("port-tasks:cancelled", onCancelled);
  api.onPlayerLogin(onLogin);
}

module.exports = attach;
module.exports.bountyOf = bountyOf;
module.exports.onHarvest = onHarvest;
module.exports.claim = claim;
module.exports.sendCounters = sendCounters;
module.exports.COUNTER_VARBITS = COUNTER_VARBITS;
