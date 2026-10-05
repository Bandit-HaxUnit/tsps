"use strict";

const { RegionManager } = require("../../../src/main/typescript/elvarg/game/collision/RegionManager");
const { MapObjects } = require("../../../src/main/typescript/elvarg/game/entity/impl/object/MapObjects");
const { ObjectDefinition } = require("../../../src/main/typescript/elvarg/game/definition/ObjectDefinition");
const { PathFinder } = require("../../../src/main/typescript/elvarg/game/model/movement/path/PathFinder");
const ClimbLinks = require("../../objects/ClimbLinks");

/**
 * Walks to another floor: a movement request whose `z` differs from the bot's plane
 * goes by the stairs/ladder nearest the way there, found in the map like the climb
 * handlers find the other end (ClimbLinks, cache backed, no coordinate lists).
 * The walk is pointed at the stairs (`request.climbVia`); once they are in reach
 * the bot clicks the climb option and the walk carries on from the new floor.
 */

// Stairs are looked for this far around the destination, on the bot's plane.
const SEARCH_RADIUS = 24;
const CLIMB_COOLDOWN_MS = 3000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const UP_OPTIONS = ["climb-up", "climb up", "walk-up", "ascend", "top-floor"];
const DOWN_OPTIONS = ["climb-down", "climb down", "walk-down", "descend", "bottom-floor"];

// "plane>goal area" -> { object, at }: stairs are map data, the same for every bot.
const stairsByGoal = new Map();

const chebyshev = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));

/** The 1-based option that climbs `direction`, preferring an explicit Climb-up/down over "Climb". */
function climbOption(objectId, direction) {
  const options = (ObjectDefinition.forId(objectId)?.getInteractions?.() ?? []).map((option) => String(option ?? "").toLowerCase());
  const wanted = direction === ClimbLinks.UP ? UP_OPTIONS : DOWN_OPTIONS;
  const exact = options.findIndex((option) => wanted.includes(option));
  const index = exact >= 0 ? exact : options.indexOf("climb");
  return index >= 0 ? index + 1 : 0;
}

/** Nearest stairs on `here`'s plane that climb toward `goal` (on the way, near it). */
function findStairs(here, goal, direction, nowMs) {
  const key = `${here.z}>${goal.x >> 3},${goal.y >> 3},${goal.z}`;
  const cached = stairsByGoal.get(key);
  if (cached && nowMs - cached.at < CACHE_TTL_MS) return cached.object;
  RegionManager.loadMapFiles(goal.x, goal.y);
  let best = null;
  let bestScore = Infinity;
  for (let dx = -SEARCH_RADIUS; dx <= SEARCH_RADIUS; dx++) {
    for (let dy = -SEARCH_RADIUS; dy <= SEARCH_RADIUS; dy++) {
      for (const object of MapObjects.mapObjects.get(MapObjects.getHash(goal.x + dx, goal.y + dy, here.z)) ?? []) {
        const loc = object.getLocation();
        if (loc.getX() !== goal.x + dx || loc.getY() !== goal.y + dy) continue;
        if (!ClimbLinks.climbs(object.getId(), direction) || climbOption(object.getId(), direction) === 0) continue;
        const score = chebyshev(here.x, here.y, loc.getX(), loc.getY()) + chebyshev(loc.getX(), loc.getY(), goal.x, goal.y);
        if (score >= bestScore) continue;
        const landing = ClimbLinks.destination(object, direction, loc, null);
        if (!landing || landing.getZ() !== here.z + direction) continue;
        best = object;
        bestScore = score;
      }
    }
  }
  stairsByGoal.set(key, { object: best, at: nowMs });
  return best;
}

function inReach(player, object) {
  const def = ObjectDefinition.forId(object.getId());
  const loc = object.getLocation();
  return PathFinder.reachedObject(player, loc.getX(), loc.getY(), def.getSizeX(), def.getSizeY(),
    object.getFace(), object.getType(), def.getBlockingMask()) === true;
}

/**
 * For a request on another floor: points the walk at the stairs (`request.climbVia`),
 * and climbs them once in reach. True when it clicked (the dispatch waits this tick).
 */
function maybeClimb({ player, state, world, request }) {
  const loc = player?.getLocation?.();
  if (!loc || !request || !Number.isFinite(request.z) || request.z === loc.getZ() || player.getPrivateArea?.()) {
    if (request) request.climbVia = undefined;
    return false;
  }
  const nowMs = Date.now();
  const here = { x: loc.getX(), y: loc.getY(), z: loc.getZ() };
  const direction = request.z > here.z ? ClimbLinks.UP : ClimbLinks.DOWN;
  const stairs = findStairs(here, { x: request.x, y: request.y, z: request.z }, direction, nowMs);
  if (!stairs) {
    request.climbVia = undefined;
    return false;
  }
  const at = stairs.getLocation();
  if (request.climbVia?.x !== at.getX() || request.climbVia?.y !== at.getY() || request.climbVia?.z !== here.z) {
    request.climbVia = { x: at.getX(), y: at.getY(), z: here.z };
  }
  if (!inReach(player, stairs) || nowMs < (state?.climbAt ?? 0)) return false;
  if (state) state.climbAt = nowMs + CLIMB_COOLDOWN_MS;
  world.emitObjectInteraction?.({
    player,
    object: stairs,
    objectId: stairs.getId(),
    clickType: climbOption(stairs.getId(), direction),
    location: { x: at.getX(), y: at.getY(), z: at.getZ() },
    sourceLocation: { ...here },
    handled: false,
  });
  request.climbVia = undefined;
  return true;
}

module.exports = { maybeClimb, findStairs, climbOption };
