"use strict";

/**
 * The Mage Arena levers and sparkling pools. The bank pair (5959 outside, 5960 inside) is
 * already handled by plugins/areas/Wilderness.plugin.js, so only the arena pair and the pools
 * live here (https://oldschool.runescape.wiki/w/Lever_(Mage_Arena), /w/Sparkling_pool):
 *
 * - 9706, the broken-down house's lever, teleports through the wall into the arena corridor.
 * - 9707, the arena-side lever, teleports back into the house.
 * - 2878 (bank) and 2879 (statue chamber) move the player to the tile beside the counterpart
 *   pool. The Wiki records the pools but not their landing tiles; the two destinations here
 *   are the walkable tiles just south of each pool, taken from Lost City's port (the only
 *   source found for them). Pools use a plain move, not the teleport lever path, so teleblock
 *   does not bar them.
 *
 * Lever teleports reuse the shared `lever:teleport` event (plugins/objects/Levers.plugin.js),
 * which keeps teleblock blocking and the usual teleport visuals for every lever.
 */

const ARENA_LEVER_TO_INSIDE = 9706;
const ARENA_LEVER_TO_OUTSIDE = 9707;
const BANK_POOL = 2878;
const CHAMBER_POOL = 2879;

const LEVER_DESTINATIONS = Object.freeze({
  [ARENA_LEVER_TO_INSIDE]: Object.freeze([3106, 3952]),
  [ARENA_LEVER_TO_OUTSIDE]: Object.freeze([3105, 3956]),
});
const POOL_DESTINATIONS = Object.freeze({
  [BANK_POOL]: Object.freeze([2509, 4689]),
  [CHAMBER_POOL]: Object.freeze([2542, 4718]),
});

let api;
let core;

function pullLever(event) {
  const to = LEVER_DESTINATIONS[event.objectId];
  if (!to) return false;
  api.emitCustomEvent("lever:teleport", {
    player: event.player,
    destination: new core.Location(to[0], to[1], 0),
  });
}

function stepIntoPool({ player, objectId }) {
  const to = POOL_DESTINATIONS[objectId];
  if (!to) return false;
  player.moveTo(new core.Location(to[0], to[1], 0));
}

module.exports = function registerLevers(pluginApi) {
  api = pluginApi;
  core = api.core;
  api.onObjectInteraction("Lever", { Pull: pullLever });
  api.onObjectInteraction("Sparkling pool", { "Step-into": stepIntoPool });
};

Object.assign(module.exports, {
  _test: {
    LEVER_DESTINATIONS,
    POOL_DESTINATIONS,
    pullLever,
    stepIntoPool,
    setApi(value) { api = value; },
    setCore(value) { core = value; },
  },
});
