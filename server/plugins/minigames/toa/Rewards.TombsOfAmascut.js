"use strict";

/**
 * Tombs of Amascut: Osmumten's burial chamber. Loot is rolled as the party arrives; each
 * player's chest opens the reward interface (771) to take, bank or discard it, and the
 * spirit sees them out. Loot left behind waits in the lobby's retrieval chest.
 */

const Shared = require("./ToaShared");
const Raid = require("./ToaRaid");
const Rewards = require("./ToaRewards");

/** The departing spirit and the burial chamber's chests: unnamed in the cache, no constants. */
const SPIRIT = 11829;
const SPIRIT_SPOT = { x: 3680, y: 5143, z: 0 };
const CHEST_IDS = new Set([46217, 44545, 46215, 46219, 46218, 44547, 29994, 46216, 46224]);

const LOOT_INVENTORY = 811;
const LOOT_COMPONENT = { BANK_ALL: 4, INVENTORY_ALL: 6, DISCARD_ALL: 8, ITEMS: 10 };
const LOOT_ITEMS_UID = (Shared.INTERFACE.LOOT << 16) | LOOT_COMPONENT.ITEMS;
const SCRIPT_ITEM_OPS = 149;
/**
 * TOA_SHOULD_HAVE_LOOT: chest 46224 is a False Door at 0 and a Rewards Niche (Claim) at 1.
 * (14139, used before, is a PvP Arena loadout varbit.)
 */
const VARBIT_CHEST_FULL = 14319;
const OP10 = 1 << 10;

class RewardRoom extends Raid.Room {
  build() {
    const spirit = this.spawn(SPIRIT, SPIRIT_SPOT, { scale: false, points: 0, face: 1 });
    if (spirit) {
      spirit.__toaScripted = true;
      spirit.getMovementQueue().setBlockMovement(true);
    }
    const raid = this.raid;
    if (raid.lootRolled) return;
    raid.lootRolled = true;
    const { uniqueWinner, uniqueId, petWinner } = Rewards.rollRaidLoot(raid);
    const { ItemDefinition } = Shared.core();
    if (uniqueWinner) {
      const name = ItemDefinition.forId(uniqueId)?.getName?.() ?? "a unique";
      raid.broadcast(`<col=a53fff>Special loot:</col> ${Shared.displayName(uniqueWinner)} found ${name}!`);
    }
    if (petWinner) raid.broadcast(`<col=ff0000>${Shared.displayName(petWinner)} has a funny feeling like they would have been followed...</col>`);
  }

  onPlayerArrive(player) {
    const loot = Rewards.lootOf(player);
    player.getPacketSender().sendVarbit(VARBIT_CHEST_FULL, loot.length > 0 ? 1 : 0);
    if (loot.length > 0) player.sendMessage("Your rewards await you in the chest.");
  }
}

// ------------------------------------------------------------------ the loot interface

function openLoot(player) {
  const loot = Rewards.lootOf(player);
  if (loot.length === 0) {
    Shared.statement(player, "There is nothing to claim.");
    player.getPacketSender().sendVarbit(VARBIT_CHEST_FULL, 0);
    return;
  }
  const sender = player.getPacketSender();
  sendLoot(player, loot);
  sender.sendInterface(Shared.INTERFACE.LOOT);
  sender.sendClientScript(SCRIPT_ITEM_OPS, LOOT_ITEMS_UID, LOOT_INVENTORY, 2, 3, 0, -1, "Take", "Take-5", "Take-10", "Take-All", "");
  sender.sendInterfaceFlagsRange(LOOT_ITEMS_UID, 0, Rewards.LOOT_SLOTS - 1,
    Shared.EVENT.OP1 | Shared.EVENT.OP2 | Shared.EVENT.OP3 | Shared.EVENT.OP4 | OP10);
}

function sendLoot(player, loot) {
  player.getPacketSender().sendInventory(LOOT_INVENTORY, Rewards.LOOT_SLOTS, loot.map(({ id, amount }) => ({ id, amount })));
  if (loot.length === 0) player.getPacketSender().sendVarbit(VARBIT_CHEST_FULL, 0);
}

function bankFor(player, id) {
  const { Bank } = Shared.core();
  for (let tab = 0; tab < Bank.TOTAL_BANK_TABS; tab++) {
    if (tab !== Bank.BANK_SEARCH_TAB_INDEX && player.getBank(tab).contains(id)) return player.getBank(tab);
  }
  const preferred = player.getBank(Bank.getTabForItem(player, id));
  if (preferred.getFreeSlots() > 0) return preferred;
  for (let tab = 0; tab < Bank.TOTAL_BANK_TABS; tab++) {
    if (tab !== Bank.BANK_SEARCH_TAB_INDEX && player.getBank(tab).getFreeSlots() > 0) return player.getBank(tab);
  }
  return null;
}

/** Moves up to `amount` of one loot slot into the inventory or bank; returns how many moved. */
function take(player, entry, amount, destination) {
  const { Item, ItemDefinition } = Shared.core();
  const wanted = Math.max(0, Math.min(entry.amount, amount));
  if (wanted === 0) return 0;
  if (destination === "bank") {
    const bank = bankFor(player, entry.id);
    if (!bank) {
      player.sendMessage("You need more space in your bank.");
      return 0;
    }
    bank.add(new Item(entry.id, wanted), false);
    return wanted;
  }
  const inventory = player.getInventory();
  const stackable = ItemDefinition.forId(entry.id)?.isStackable?.() === true;
  const moved = stackable ? (inventory.contains(entry.id) || inventory.getFreeSlots() > 0 ? wanted : 0)
    : Math.min(wanted, inventory.getFreeSlots());
  if (moved <= 0) {
    player.sendMessage("You don't have enough inventory space.");
    return 0;
  }
  inventory.add(new Item(entry.id, moved), false);
  inventory.refreshItems();
  return moved;
}

function takeAll(player, destination) {
  const loot = Rewards.lootOf(player);
  if (loot.length === 0) {
    player.sendMessage(`There is nothing to ${destination === "bank" ? "bank" : "put in your inventory"}.`);
    return;
  }
  const left = [];
  for (const entry of loot) {
    entry.amount -= take(player, entry, entry.amount, destination);
    if (entry.amount > 0) left.push(entry);
  }
  Rewards.setLoot(player, left);
  sendLoot(player, left);
}

function clickBankAll({ player }) {
  takeAll(player, "bank");
}

function clickInventoryAll({ player }) {
  takeAll(player, "inventory");
}

function clickDiscardAll({ player }) {
  if (!Rewards.hasLoot(player)) {
    player.sendMessage("There is nothing to discard.");
    return;
  }
  Shared.options(player, "Are you sure you want to discard everything?",
    "No.", () => openLoot(player),
    "Yes.", () => {
      Rewards.setLoot(player, []);
      sendLoot(player, []);
    });
}

/** Take / Take-5 / Take-10 / Take-All on one slot. */
function clickLootItem(event) {
  const { player } = event;
  const loot = Rewards.lootOf(player);
  const slot = Number.isInteger(event.slot) ? event.slot : -1;
  const entry = loot[slot];
  if (!entry) return;
  const op = event.opId ?? event.action;
  const amount = op === 2 ? 5 : op === 3 ? 10 : op === 4 ? entry.amount : 1;
  entry.amount -= take(player, entry, amount, "inventory");
  if (entry.amount <= 0) loot.splice(slot, 1);
  Rewards.setLoot(player, loot);
  sendLoot(player, loot);
}

// ------------------------------------------------------------------ objects and the spirit

function openChest(event) {
  const { player } = event;
  const id = event.objectId;
  const inReward = Raid.raidOf(player)?.roomFor(player)?.key === "REWARD";
  const atLobby = id === Shared.core().ObjectIdentifiers.CHEST_155 && Shared.inLobby(player.getLocation());
  if (!((CHEST_IDS.has(id) || id === Shared.core().ObjectIdentifiers.REWARDS_NICHE) && inReward) && !atLobby) return;
  event.handled = true;
  if (atLobby && !Rewards.hasLoot(player)) {
    Shared.statement(player, "There is nothing to collect.");
    return;
  }
  openLoot(player);
}

function talkToSpirit(event) {
  if (event.handled || event.npcId !== SPIRIT) return;
  const { player } = event;
  const raid = Raid.raidOf(player);
  if (!raid) return;
  event.handled = true;
  Shared.options(player, "Are you ready to leave the Tombs of Amascut?",
    "Yes.", () => {
      if (!Raid.raidOf(player)) return;
      player.sendMessage("You leave the Tombs of Amascut.");
      if (Rewards.hasLoot(player)) player.sendMessage("Your unclaimed rewards can be collected from the chest in the lobby.");
      raid.leave(player, { teleport: true });
    },
    "No.", () => {});
}

module.exports = function registerTombsRewards(api) {
  Shared.bind(api);
  Raid.registerRoom("REWARD", RewardRoom);
  api.onObjectInteraction(openChest);
  api.onNpcInteraction(talkToSpirit);
  api.onInterfaceActionButton((Shared.INTERFACE.LOOT << 16) | LOOT_COMPONENT.BANK_ALL, clickBankAll);
  api.onInterfaceActionButton((Shared.INTERFACE.LOOT << 16) | LOOT_COMPONENT.INVENTORY_ALL, clickInventoryAll);
  api.onInterfaceActionButton((Shared.INTERFACE.LOOT << 16) | LOOT_COMPONENT.DISCARD_ALL, clickDiscardAll);
  api.onInterfaceActionButton(LOOT_ITEMS_UID, clickLootItem);
  api.persistAttribute(Rewards.ATTR_LOOT);
};
