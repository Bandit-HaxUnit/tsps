/**
 * What the relics' teleport items share: a paged destination menu, the teleport itself (the
 * standard animation, the Wilderness limit of the item, and only to areas the league character
 * has unlocked), and the item's last destination.
 *
 * Areas: `league:area-at` { player, x, y } -> area (null when open) and `league:areas` { player } ->
 * unlocked, from the league's area unlocks; with nobody answering, every area is open.
 */
const Common = require("./Common.LeagueRelics");

/** Four destinations a page and "More...", as the jewellery's own menus. */
const PAGE_SIZE = 5;
/** "Ignores Wilderness teleport restrictions" (Wiki): no level stops it. */
const ANY_WILDERNESS_LEVEL = 60;

function lastAttribute(key) {
  return `league:last-destination:${key}`;
}

/** Whether the tile is in an area the league character has unlocked (or no area at all). */
function areaOpen(player, location) {
  const at = { player, x: location.getX(), y: location.getY(), area: null };
  Common.api.emitCustomEvent("league:area-at", at);
  if (at.area === null || at.area === undefined) return true;
  const areas = { player, unlocked: null };
  Common.api.emitCustomEvent("league:areas", areas);
  return !Array.isArray(areas.unlocked) || areas.unlocked.includes(at.area);
}

/** The tile itself, or the nearest open one within 3 tiles when it is blocked (a STASH unit, a clue's loc). */
function landing(location) {
  const { RegionManager, Location } = Common.core;
  if (!RegionManager?.blocked || !RegionManager.blocked(location, null)) return location;
  for (let radius = 1; radius <= 3; radius++) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const tile = new Location(location.getX() + dx, location.getY() + dy, location.getZ());
        if (!RegionManager.blocked(tile, null)) return tile;
      }
    }
  }
  return location;
}

/**
 * Teleports to `destination` { label, location, wildernessLevel?, remember? } for item `key`,
 * remembering it as the item's last destination on arrival (not with `remember: false`, a
 * destination that needs its own arrival, the house). `onArrival` runs after.
 */
function go(player, key, destination, { wildernessLevel = ANY_WILDERNESS_LEVEL, onArrival = null } = {}) {
  const { TeleportHandler, TeleportType } = Common.core;
  const location = landing(destination.location);
  if (!areaOpen(player, location)) {
    player.sendMessage(Common.message("areaLocked"));
    return false;
  }
  const limit = destination.wildernessLevel ?? wildernessLevel;
  if (!TeleportHandler.checkReqs(player, location, limit)) return false;
  TeleportHandler.teleport(player, location, TeleportType.NORMAL, false, () => {
    if (destination.remember !== false) {
      player.setAttribute(lastAttribute(key), {
        label: destination.label, x: location.getX(), y: location.getY(), z: location.getZ(), wildernessLevel: limit,
      });
    }
    onArrival?.();
  });
  return true;
}

/** The item's last destination, or a message when there is none yet. */
function goLast(player, key) {
  const last = player.getAttribute(lastAttribute(key));
  if (!last || !Number.isInteger(last.x)) {
    player.sendMessage(Common.message("noLastDestination"));
    return false;
  }
  const location = new Common.core.Location(last.x, last.y, last.z ?? 0);
  return go(player, key, { label: last.label, location, wildernessLevel: last.wildernessLevel });
}

/** A paged chatbox menu of [label, action] entries. */
function menu(player, title, entries) {
  if (entries.length === 0) {
    player.sendMessage(Common.message("noDestinations"));
    return;
  }
  let page = entries;
  if (entries.length > PAGE_SIZE) {
    const rest = entries.slice(PAGE_SIZE - 1);
    page = [...entries.slice(0, PAGE_SIZE - 1), ["More...", () => menu(player, title, rest)]];
  }
  Common.api.sendMultiChatboxPrompt(player, title, ...page.flat());
}

/** A menu of destinations, each teleporting with `options`. */
function destinations(player, key, title, list, options = {}) {
  menu(player, title, list.map((destination) => [destination.label, () => go(player, key, destination, options)]));
}

/** Asks an owner for a list (`{ ...request, list: [] }`) and returns it. */
function ask(name, request = {}) {
  const query = { ...request, list: [] };
  Common.api.emitCustomEvent(name, query);
  return query.list;
}

/** NPC spawns with this name, one per tile (data/definitions/npc-spawns.json). */
function spawnsNamed(name) {
  const spawns = require("../../../data/definitions/npc-spawns.json");
  const all = Array.isArray(spawns) ? spawns : spawns.spawns ?? Object.values(spawns);
  const seen = new Set();
  return all.filter((spawn) => {
    if (spawn?.name !== name) return false;
    const key = `${spawn.x},${spawn.y},${spawn.level ?? 0}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

module.exports = { areaOpen, landing, go, goLast, menu, destinations, ask, spawnsNamed, lastAttribute, ANY_WILDERNESS_LEVEL };
