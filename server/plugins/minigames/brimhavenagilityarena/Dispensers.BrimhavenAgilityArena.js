"use strict";

/**
 * The world's ticket cycle, the two ways in and out, Cap'n Izzy's fee and the dispensers'
 * Tag option. The cycle is one module-level object in the shared unit: every 100 ticks a new
 * dispenser becomes active, the native hint arrow is moved over it, and each player may tag
 * once per cycle.
 */

const Shared = require("./Shared.BrimhavenAgilityArena");

/** Pays the fee and drops the player on the arena's entry platform. */
function enterArena(player) {
  const core = Shared.core();
  const inventory = player.getInventory();
  if (inventory.getAmount(core.ItemIdentifiers.COINS) < Shared.ENTRY_FEE) {
    player.sendMessage(Shared.NO_COINS_MESSAGE);
    return false;
  }
  inventory.deleteNumber(core.ItemIdentifiers.COINS, Shared.ENTRY_FEE);
  player.sendMessage(Shared.FEE_MESSAGE);
  player.moveTo(new core.Location(Shared.ENTRY.x, Shared.ENTRY.y, Shared.ENTRY.z));
  return true;
}

function leaveArena(player) {
  const core = Shared.core();
  player.moveTo(new core.Location(Shared.HUT.x, Shared.HUT.y, Shared.HUT.z));
  player.getPacketSender().clearHintArrow?.();
}

function payIzzy({ player }) {
  enterArena(player);
}

function talkIzzy({ player }) {
  const { DialogueChainBuilder, NpcDialogue, EndDialogue, NpcIdentifiers } = Shared.core();
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new NpcDialogue(0, NpcIdentifiers.CAPN_IZZY_NO_BEARD, "Pay the 200 coin fee if you want to enter the arena."),
    new EndDialogue(1),
  ));
}

/** The hut ladder and the arena's exit ladder, claimed before the generic Ladders plugin moves anyone. */
function claimLadder(request) {
  const { player, objectId } = request;
  if (objectId === Shared.OBJECTS.ENTRANCE_LADDER) {
    enterArena(player);
    request.handled = true;
  } else if (objectId === Shared.OBJECTS.EXIT_LADDER) {
    leaveArena(player);
    request.handled = true;
  }
}

/**
 * Tagging a dispenser: the active one pays a ticket, a voucher and the level-scaled XP; the
 * darts version dodges first (level 40, damage and a two-level drain on a miss), then pays the
 * darts obstacle's 30 XP. An inactive one only complains, and a second tag in the same cycle
 * is refused.
 */
function tagDispenser(event) {
  const { player, objectId, location } = event;
  if (objectId !== Shared.OBJECTS.TICKET_DISPENSER && objectId !== Shared.OBJECTS.DARTS_DISPENSER) return false;
  if (!location) return false;
  const active = Shared.activeTile();
  if (!active || location.x !== active.x || location.y !== active.y) {
    player.sendMessage(Shared.INACTIVE_MESSAGE);
    return;
  }
  if (Shared.stateOf(player).taggedCycle === Shared.cycle.index) {
    player.sendMessage(Shared.REPEAT_MESSAGE);
    return;
  }
  if (objectId === Shared.OBJECTS.DARTS_DISPENSER) {
    const level = Shared.agilityLevel(player);
    if (level < Shared.OBSTACLE_LEVEL.DARTS) {
      player.sendMessage(Shared.levelRefusal(Shared.OBSTACLE_LEVEL.DARTS));
      return;
    }
    if (!Shared.roll(Shared.successChance(Shared.DARTS_SUCCESS.low, Shared.DARTS_SUCCESS.high, level))) {
      player.sendMessage(Shared.DARTS_FAIL_MESSAGE);
      Shared.drainAgility(player, 2);
      Shared.hit(player, Shared.trapDamage(player.getHitpoints()));
      return;
    }
    Shared.addXp(player, Shared.OBSTACLE_XP.DARTS);
  }
  Shared.rewardTag(player);
}

/** The world cycle: ticked once a server tick, advanced every minute. */
let cycleTask = null;

function startCycle() {
  const { Task, TaskManager } = Shared.core();
  Shared.advanceCycle();
  cycleTask = new (class extends Task {
    constructor() {
      super(1, Shared.CYCLE_TASK_KEY, false);
    }
    execute() {
      Shared.tick();
    }
  })();
  TaskManager.submit(cycleTask);
}

function shutdown() {
  cycleTask?.stop();
  cycleTask = null;
}

/** Logging out inside the arena throws the player into the entrance hut and forgets them. */
function logout({ player }) {
  if (!player) return;
  const core = Shared.core();
  if (Shared.isInArena(player)) {
    player.setLocation(new core.Location(Shared.HUT.x, Shared.HUT.y, Shared.HUT.z));
    player.getPacketSender().clearHintArrow?.();
  }
  Shared.clearState(player);
}

/** Any login that still thinks it is in the arena starts outside. */
function login({ player }) {
  if (!player || !Shared.isInArena(player)) return;
  const core = Shared.core();
  Shared.clearState(player);
  player.moveTo(new core.Location(Shared.HUT.x, Shared.HUT.y, Shared.HUT.z));
}

/** Death respawns outside; the world cycle keeps running. */
function death(event) {
  const player = event?.player;
  if (!player || !Shared.isInArena(player)) return;
  const core = Shared.core();
  Shared.clearState(player);
  player.getPacketSender().clearHintArrow?.();
  player.moveTo(new core.Location(Shared.HUT.x, Shared.HUT.y, Shared.HUT.z));
  event.handled = true;
}

module.exports = (api) => {
  api.onNpcInteraction(Shared.NPC.IZZY, { Pay: payIzzy, "Talk-to": talkIzzy });
  api.onObjectInteraction("Ticket Dispenser", { Tag: tagDispenser });
  api.onCustomEvent("ladders:climb", claimLadder);
  api.onServerStartup(startCycle);
  api.onServerShutdown(shutdown);
  api.onPlayerLogout(logout);
  api.onPlayerLogin(login);
  api.onPlayerDeath(death);
};

module.exports.enterArena = enterArena;
module.exports.leaveArena = leaveArena;
module.exports.payIzzy = payIzzy;
module.exports.talkIzzy = talkIzzy;
module.exports.tagDispenser = tagDispenser;
module.exports.startCycle = startCycle;
module.exports.shutdown = shutdown;
module.exports.logout = logout;
module.exports.login = login;
module.exports.death = death;
module.exports.claimLadder = claimLadder;
