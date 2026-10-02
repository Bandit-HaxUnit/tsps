"use strict";

/**
 * One player's run through the Gauntlet: the maze, the preparation timer, the boss phase and
 * the way out. The run owns everything the player carries inside; leaving it - by the exit,
 * the barrier's Escape, death, a disconnect, or the timer running out on the Hunllef - takes
 * all of it and puts them back in the lobby.
 *
 * Wiki: you start with a crystal sceptre (wielded), axe, pickaxe, harpoon, pestle and mortar
 * and a teleport crystal; you have 10 minutes (Corrupted 7:30) to prepare, then you are taken
 * into the boss room.
 */

const Shared = require("./GauntletShared");
const GauntletMap = require("./GauntletMap");

const ATTR_RUN = "gauntlet:run";
const ATTR_STATS = "gauntlet:stats";

const runs = new Map();

function items() {
  const I = Shared.core().ItemIdentifiers;
  return {
    regular: {
      sceptre: I.CRYSTAL_SCEPTRE,
      tools: [I.CRYSTAL_AXE_3, I.CRYSTAL_PICKAXE_3, I.CRYSTAL_HARPOON_3, I.PESTLE_AND_MORTAR_3, I.TELEPORT_CRYSTAL],
      teleportCrystal: I.TELEPORT_CRYSTAL,
    },
    corrupted: {
      sceptre: I.CORRUPTED_SCEPTRE,
      tools: [I.CORRUPTED_AXE, I.CORRUPTED_PICKAXE, I.CORRUPTED_HARPOON, I.PESTLE_AND_MORTAR_3, I.CORRUPTED_TELEPORT_CRYSTAL],
      teleportCrystal: I.CORRUPTED_TELEPORT_CRYSTAL,
    },
  };
}

function runOf(player) {
  return runs.get(player.getUsername?.()) ?? null;
}

function statsOf(player) {
  const saved = player.getAttribute(ATTR_STATS);
  return {
    completions: { regular: 0, corrupted: 0, ...(saved?.completions ?? {}) },
    deaths: { regular: 0, corrupted: 0, ...(saved?.deaths ?? {}) },
  };
}

function recordStat(player, kind, mode) {
  const stats = statsOf(player);
  stats[kind][mode]++;
  player.setAttribute(ATTR_STATS, stats);
}

function hasCompleted(player) {
  const { completions } = statsOf(player);
  return completions.regular + completions.corrupted > 0;
}

/** The entrance offers Enter-corrupted once any Gauntlet is completed (varp 2353). */
function sendCompletionVarp(player) {
  player.getPacketSender().sendConfig(Shared.VARP.COMPLETED, hasCompleted(player) ? 1 : 0);
}

class GauntletRun {
  constructor(player, { corrupted = false, random = Math.random } = {}) {
    this.player = player;
    this.corrupted = corrupted;
    this.mode = corrupted ? "corrupted" : "regular";
    this.random = random;
    this.map = GauntletMap.createMap({ corrupted, random });
    this.map.run = this;
    this.stage = "prep";
    this.prepTicks = Shared.PREP_TICKS[this.mode];
    this.prepLeft = this.prepTicks;
    this.startCycle = 0;
    this.bossCycle = 0;
    this.timer = null;
    this.room = null;
    runs.set(player.getUsername(), this);
  }

  /** Takes the player in: fade, starting kit, the timer, and the maze varbits. */
  start() {
    const player = this.player;
    player.setAttribute(ATTR_RUN, this.mode);
    Shared.fadeMove(player, () => {
      if (this.stage === "ended") return;
      Shared.clearItems(player);
      this.giveStartingItems();
      player.resetAttributes();
      this.map.enter(player);
      player.moveTo(this.map.startTile(this.random));
      player.sendMessage("You enter the Gauntlet.");
      this.startCycle = Shared.core().World.getProcessCycle();
      this.sendMazeVarbits();
      const sender = player.getPacketSender();
      sender.sendSubInterface(Shared.OVERLAY_HUD_UID, Shared.INTERFACE.TIMER, 1);
      sender.sendClientScript(Shared.SCRIPT.TIMER_START, this.prepLeft);
      this.timer = Shared.repeat(this, 1, () => this.tick());
    });
  }

  giveStartingItems() {
    const { Item, Equipment } = Shared.core();
    const kit = items()[this.mode];
    const equipment = this.player.getEquipment();
    equipment.setItem(Equipment.WEAPON_SLOT, new Item(kit.sceptre));
    equipment.refreshItems();
    for (const id of kit.tools) this.player.getInventory().adds(id, 1);
    this.player.getInventory().refreshItems();
  }

  sendMazeVarbits() {
    const sender = this.player.getPacketSender();
    sender.sendVarbit(Shared.VARBIT.CORRUPTED, this.corrupted ? 1 : 0);
    sender.sendVarbit(Shared.VARBIT.MAZE_MAP, 1);
    sender.sendVarbit(Shared.VARBIT.BOSS_PHASE, 0);
    sender.sendVarbit(Shared.VARBIT.START_ROOM, this.map.start.y * GauntletMap.GRID + this.map.start.x);
    for (const room of this.map.rooms.flat()) {
      sender.sendVarbit(Shared.VARBIT.ROOM_LIT_FIRST + room.gridY * GauntletMap.GRID + room.gridX, room.lit ? 1 : 0);
    }
    this.updateRoom();
  }

  /** The maze map marks the room the player stands in. */
  updateRoom() {
    const room = this.map.roomAt(this.player.getLocation());
    if (!room || room === this.room) return;
    this.room = room;
    const sender = this.player.getPacketSender();
    sender.sendVarbit(Shared.VARBIT.CURRENT_ROOM_X, room.gridX);
    sender.sendVarbit(Shared.VARBIT.CURRENT_ROOM_Y, room.gridY);
  }

  tick() {
    if (this.stage !== "prep") return false;
    this.prepLeft--;
    // The overlay counts down on its own; keep it in step now and then, and closely at the end.
    if (this.prepLeft % 50 === 0 || this.prepLeft < 15) {
      this.player.getPacketSender().sendClientScript(Shared.SCRIPT.TIMER_START, Math.max(0, this.prepLeft));
    }
    if (this.prepLeft <= 0) {
      this.startBossPhase({ forced: true });
      return false;
    }
    return true;
  }

  /** Lights the room next to a node; false when there is none or it is already lit. */
  lightRoom(gridX, gridY) {
    if (this.stage !== "prep") return false;
    if (!this.map.lightRoom(gridX, gridY)) return false;
    this.player.getPacketSender().sendVarbit(Shared.VARBIT.ROOM_LIT_FIRST + gridY * GauntletMap.GRID + gridX, 1);
    return true;
  }

  /** Back to the start room, as the teleport crystal does. */
  teleportToStart() {
    if (this.stage !== "prep") return false;
    this.player.moveTo(this.map.startTile(this.random));
    return true;
  }

  /** Through the barrier, or dragged in when the timer runs out. */
  startBossPhase({ forced = false } = {}) {
    if (this.stage !== "prep") return false;
    this.stage = "boss";
    this.bossCycle = Shared.core().World.getProcessCycle();
    this.timer?.stop?.();
    const player = this.player;
    const sender = player.getPacketSender();
    sender.sendVarbit(Shared.VARBIT.BOSS_PHASE, 1);
    sender.sendClientScript(Shared.SCRIPT.TIMER_BOSS);
    if (forced) {
      player.getCombat().reset();
      player.getMovementQueue().reset();
      player.moveTo(this.map.roomTile(this.map.room(GauntletMap.CENTRE, GauntletMap.CENTRE), 4, 4));
      player.sendMessage("You have run out of time, and are taken to face the Hunllef.");
    }
    Shared.api()?.emitCustomEvent?.("gauntlet:boss-phase", { run: this, player, forced });
    return true;
  }

  /** The Hunllef's 12x12 floor, inside the boss room's walls and barriers. */
  inArena(location) {
    const corner = this.map.roomTile(this.map.room(GauntletMap.CENTRE, GauntletMap.CENTRE), 0, 0);
    const x = location.getX() - corner.getX();
    const y = location.getY() - corner.getY();
    return location.getZ() === corner.getZ() && x >= 2 && x <= 13 && y >= 2 && y <= 13;
  }

  /**
   * Ends the run. `reason`: "exit", "escape", "death", "logout", "left", "completed".
   * Everything carried is taken; the player is put back in the lobby. `fromArea` when the maze
   * itself is being left (a logout), which then needs no leaving.
   */
  end(reason, { fade = reason === "exit" || reason === "escape" || reason === "completed", fromArea = false } = {}) {
    if (this.stage === "ended") return;
    this.stage = "ended";
    this.timer?.stop?.();
    runs.delete(this.player.getUsername());
    const player = this.player;
    player.setAttribute(ATTR_RUN, null);
    if (reason === "death") recordStat(player, "deaths", this.mode);
    if (reason === "completed") recordStat(player, "completions", this.mode);
    Shared.api()?.emitCustomEvent?.("gauntlet:end", { run: this, player, reason });

    const leave = () => {
      Shared.clearItems(player);
      player.resetAttributes();
      const sender = player.getPacketSender();
      sender.closeSubInterface(Shared.OVERLAY_HUD_UID);
      sender.sendVarbit(Shared.VARBIT.BOSS_PHASE, 0);
      sender.sendVarbit(Shared.VARBIT.MAZE_MAP, 0);
      sendCompletionVarp(player);
      // Leave before moving, so the scene goes straight back to the normal map.
      if (!fromArea && player.getArea?.() === this.map) this.map.leave(player, reason === "logout");
      player.moveTo(Shared.loc(Shared.LOBBY));
      if (reason === "death") player.sendMessage("Oh dear, you are dead!");
      else if (reason !== "logout") player.sendMessage("You leave the Gauntlet.");
    };
    if (fade) Shared.fadeMove(player, leave);
    else leave();
  }
}

function startRun(player, options) {
  const run = new GauntletRun(player, options);
  run.start();
  return run;
}

module.exports = {
  ATTR_RUN, ATTR_STATS, GauntletRun, runOf, startRun, statsOf, hasCompleted, sendCompletionVarp, items,
};
