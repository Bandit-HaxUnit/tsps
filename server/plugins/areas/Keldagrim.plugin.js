/**
 * Keldagrim access: the entrance cave's way back out to Rellekka, the passage between the cave
 * and the city, and the city's house stairs. The way in from Rellekka is in Rellekka.plugin.js
 * and the Blast Furnace stairs are in minigames/BlastFurnace.plugin.js.
 *
 * Tiles are Offline_Scape's (RSPS); the locs are the cache's. OSRS needs The Giant Dwarf started
 * to get in, but that quest isn't in this server, so nothing here is gated.
 */

/** Loc id -> where it takes you. */
let PASSAGES = new Map();
/** The city's house stairs: each has its pair on the floor above or below. */
let HOUSE_STAIRS = new Set();

let core;
let pluginApi;

function init(api) {
  pluginApi = api;
  core = api.core;
  const Objects = core.ObjectIdentifiers;
  PASSAGES = new Map([
    [Objects.TUNNEL_10, [2730, 3713]], // entrance cave > Rellekka
    [Objects.CAVE_ENTRANCE_29, [2838, 10124]], // entrance cave > city
    [Objects.ENTRANCE_8, [2780, 10161]], // city > entrance cave
  ]);
  HOUSE_STAIRS = new Set([Objects.STAIRS_32, Objects.STAIRS_33, Objects.STAIRS_34, Objects.STAIRS_35, Objects.STAIRS_36]);
}

function goThrough(event) {
  const to = PASSAGES.get(event.objectId);
  if (!to) return false;
  event.player.moveTo(new core.Location(to[0], to[1], 0));
}

/** Hands the stairs to the generic ladder climb, which needs their pair on the next floor. */
function climbStairsUp(event) {
  if (!HOUSE_STAIRS.has(event.objectId)) return false;
  pluginApi.emitCustomEvent("ladders:climbUp", event);
}

function climbStairsDown(event) {
  if (!HOUSE_STAIRS.has(event.objectId)) return false;
  pluginApi.emitCustomEvent("ladders:climbDown", event);
}

module.exports = {
  name: "Keldagrim",
  register(api) {
    init(api);
    api.onObjectInteraction("Tunnel", { Enter: goThrough });
    api.onObjectInteraction("Cave entrance", { "Go-through": goThrough });
    api.onObjectInteraction("Entrance", { "Go-through": goThrough });
    api.onObjectInteraction("Stairs", { "Climb-up": climbStairsUp, "Climb-down": climbStairsDown });
  },
};
