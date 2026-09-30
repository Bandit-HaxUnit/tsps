"use strict";

const C = require("./Context");
const { H } = C;
const Traps = require("./Traps");
const Catching = require("./Catching");
const Birdhouses = require("./Birdhouses");
const Tracking = require("./Tracking");
const Pitfalls = require("./Pitfalls");
const Aerial = require("./Aerial");
const MagicBoxes = require("./MagicBoxes");
let task;

function start(api) {
  H.api = api; H.core = api.core; H.data = require("./Data").build(api.core); H.tick = 0;
  Birdhouses.initialize(); Tracking.initialize();
  class HunterTask extends H.core.Task { execute() { tick(); } }
  task = new HunterTask(1);
  H.core.TaskManager.submit(task);
}

function tick() {
  H.tick++;
  C.processActions(); Traps.process(); C.processHidden(); Catching.process(); Tracking.process(); Pitfalls.process();
}

function cleanup(event) {
  C.cancel(event.player); Traps.cleanup(event); Catching.cleanup(event); Tracking.clear(event); Pitfalls.clear(event); Aerial.cleanup(event);
  H.players.delete(event.player);
}

function shutdown() {
  task?.stop();
  for (const player of H.players) cleanup({ player });
  for (const npc of H.hidden.keys()) C.reveal(npc);
}

function processPlayer(event) {
  Birdhouses.sync(event); Catching.processPlayer(event); Aerial.processPlayer(event);
  for (const trap of H.traps) if (trap.player === event.player && trap.area !== event.player.getPrivateArea()) {
    // Recover reusable tools before changing instances, rather than leave them in an inaccessible area.
    for (const item of Traps.returnedItems(trap)) if (!C.exchange(event.player, [], [item])) C.drop(event.player, [item], event.player.getLocation());
    Traps.remove(trap);
  }
}

function catchNpc(event) { return Aerial.fish(event) || Catching.catchNpc(event); }
function npcRoute(event) {
  if (event.definition?.getActions()?.[event.clickType - 1] !== "Catch") return;
  if (event.npcId === H.core.NpcIdentifiers.FISHING_SPOT_12) event.range = 9;
  else if (H.data.falconry.some(c => c.npc === event.npcId)) event.range = 8;
}
function objectUse(event) { Birdhouses.use(event); if (!event.handled) Traps.bait(event); }
function itemUse(event) { Birdhouses.craft(event); if (!event.handled) MagicBoxes.use(event); }
function equipment(event) { Catching.equipment(event); Aerial.equipment(event); }

function release({ player, itemId }) {
  const I = H.core.ItemIdentifiers;
  if (![I.FERRET, I.SWAMP_LIZARD, I.ORANGE_SALAMANDER, I.RED_SALAMANDER, I.BLACK_SALAMANDER].includes(itemId)) return false;
  if (C.exchange(player, [[itemId, 1]], [])) player.sendMessage("You release the creature.");
  return true;
}

module.exports = { start, tick, shutdown, cleanup, processPlayer, catchNpc, npcRoute, objectUse, itemUse, equipment, release };
