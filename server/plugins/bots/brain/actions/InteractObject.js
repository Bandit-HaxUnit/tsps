"use strict";

const { MapObjects } = require("../../../../src/main/typescript/elvarg/game/entity/impl/object/MapObjects");
const { resolveCatalogObjectIds } = require("../BotObjectCatalog");
const { playerState } = require("../ActionState");
const {
  approachObject,
  queueRouteAndFlagAppearance,
  randomInRange,
} = require("../../behaviours/navigation/BotNavigation");

const MAX_TARGET_TILES = 64;
// Pick randomly among this many nearest live objects so a dense crowd of bots
// spreads over nearby trees/rocks instead of all felling the same one.
const TARGET_SPREAD = 6;
const MAX_DIRECT_ROUTE_TILES = 20;
const SEARCH_WALK_RADIUS = 10;
const INTERACT_COOLDOWN_MS = 1500;
// Consecutive clicks on the same object from the same tile that never start a
// session mean the route failed (tree behind a closed gate/fence). Blacklist and
// repick instead of parking there forever.
const UNREACHABLE_CLICKS = 2;
const UNREACHABLE_AVOID_MS = 60000;

/**
 * Generic "walk to an object and use an option until X" action. Target
 * acquisition, segmented approach, interact, then progress is measured by
 * produced items or XP. State is per player: the action instance is shared.
 */
function createInteractObjectAction(spec, world) {
  const objectIds = resolveCatalogObjectIds(spec);
  const option = spec.option ?? "Chop down";
  const stallMs = Math.max(5, Number(spec.stallSeconds ?? 120)) * 1000;
  const stateFor = (player) =>
    playerState(action, player, () => ({
      target: null,
      lastProduction: null,
      lastClickAt: 0,
      lastTargetKey: null,
      lastClickX: null,
      lastClickY: null,
      failedClicks: 0,
      avoid: new Map(),
    }));

  function productionCount(player) {
    if (world.productionCount) {
      return world.productionCount(player);
    }
    let total = 0;
    for (const item of player?.getInventory?.()?.getItems?.() ?? []) {
      if (item?.getId?.() > 0) {
        total += item.getAmount();
      }
    }
    return total;
  }

  function findTarget(player, nowMs) {
    const bot = stateFor(player);
    const loc = player.getLocation();
    const candidates =
      world.objectSearch?.findCandidatesByIds?.(player, objectIds, {
        regionRadius: 1,
        z: loc.getZ(),
        privateArea: player.getPrivateArea?.() ?? null,
      }) ?? [];
    const live = [];
    const maxDistSq = MAX_TARGET_TILES * MAX_TARGET_TILES;
    for (const object of candidates) {
      const objectLoc = object.getLocation();
      if (!objectLoc || objectLoc.getZ() !== loc.getZ()) {
        continue;
      }
      const dx = objectLoc.getX() - loc.getX();
      const dy = objectLoc.getY() - loc.getY();
      const distSq = dx * dx + dy * dy;
      if (distSq > maxDistSq) {
        continue;
      }
      const key = `${object.getId()}:${objectLoc.getX()}:${objectLoc.getY()}`;
      const avoidedUntil = bot.avoid.get(key);
      if (avoidedUntil !== undefined) {
        if (avoidedUntil > nowMs) {
          continue;
        }
        bot.avoid.delete(key);
      }
      live.push({ object, distSq });
    }
    live.sort((left, right) => left.distSq - right.distSq);
    const pool = live.slice(0, TARGET_SPREAD);
    const best = pool[Math.floor(Math.random() * pool.length)]?.object ?? null;
    bot.target = best
      ? {
          objectId: best.getId(),
          x: best.getLocation().getX(),
          y: best.getLocation().getY(),
          z: best.getLocation().getZ(),
        }
      : null;
  }

  function resolveTargetObject(player) {
    const target = stateFor(player).target;
    if (!target) {
      return null;
    }
    const loc = player.getLocation().clone();
    loc.set(target.x, target.y, target.z);
    return MapObjects.get(target.objectId, loc, player.getPrivateArea());
  }

  function wander(player, state) {
    const home = state?.home ?? player.getLocation();
    const targetX = home.x + randomInRange(-SEARCH_WALK_RADIUS, SEARCH_WALK_RADIUS);
    const targetY = home.y + randomInRange(-SEARCH_WALK_RADIUS, SEARCH_WALK_RADIUS);
    queueRouteAndFlagAppearance(player, targetX, targetY, {
      reason: "brain_search_walk",
      basicPather: true,
    });
  }

  let debugCounter = 0;
  function debug(ctx, detail) {
    if (process.env.BOT_BRAIN_DEBUG !== "1") {
      return;
    }
    debugCounter += 1;
    if (debugCounter % 10 !== 0) {
      return;
    }
    const player = ctx.player;
    const loc = player.getLocation?.();
    const target = stateFor(player).target;
    world.log?.("bot_brain_interact_debug", {
      username: player.getUsername?.(),
      detail,
      x: loc?.getX?.() ?? null,
      y: loc?.getY?.() ?? null,
      queue: player.getMovementQueue?.()?.size?.() ?? 0,
      target: target ? `${target.objectId}@${target.x},${target.y}` : null,
    });
  }

  const action = {
    id: "interactObject",
    update(ctx) {
      const { player, state, nowMs } = ctx;
      const bot = stateFor(player);
      if (spec.until?.inventoryFull && player.getInventory().isFull()) {
        debug(ctx, "full");
        return "success";
      }
      if (world.isBusy?.(player)) {
        debug(ctx, "busy");
        return "running";
      }

      let object = bot.target ? resolveTargetObject(player) : null;
      if (!object) {
        bot.target = null;
        findTarget(player, nowMs);
        object = bot.target ? resolveTargetObject(player) : null;
        if (!object) {
          if (nowMs - ctx.frame.lastProgressAt > stallMs) {
            return "failed";
          }
          debug(ctx, "no-target");
          wander(player, state);
          ctx.waitTicks = 2;
          return "wait";
        }
      }

      const target = bot.target;
      const loc = player.getLocation();
      const distance = Math.max(
        Math.abs(loc.getX() - target.x),
        Math.abs(loc.getY() - target.y)
      );
      if (distance > MAX_DIRECT_ROUTE_TILES) {
        debug(ctx, `approach:${distance}`);
        approachObject(player, object, { nowMs, reason: "brain_target_approach" });
        return "running";
      }
      if (player.getForceMovement?.() != null) {
        debug(ctx, "force");
        return "running";
      }
      if (player.getMovementQueue?.()?.size?.() > 0) {
        debug(ctx, `queue:${player.getMovementQueue().size()}`);
        return "running";
      }
      // Re-issuing walkToObject every tick keeps resetting the route before its
      // arrival callback fires, so the click never lands. Space them out.
      if (nowMs - bot.lastClickAt < INTERACT_COOLDOWN_MS) {
        debug(ctx, "cooldown");
        return "running";
      }

      const objectLoc = object.getLocation();
      const key = `${object.getId()}:${objectLoc.getX()}:${objectLoc.getY()}`;
      const now = player.getLocation();
      const stayedPut =
        bot.lastClickX === now.getX() && bot.lastClickY === now.getY();
      bot.failedClicks =
        bot.lastTargetKey === key && stayedPut ? bot.failedClicks + 1 : 0;
      if (bot.failedClicks >= UNREACHABLE_CLICKS) {
        bot.avoid.set(key, nowMs + UNREACHABLE_AVOID_MS);
        bot.target = null;
        bot.lastTargetKey = null;
        bot.failedClicks = 0;
        debug(ctx, "unreachable-repick");
        findTarget(player, nowMs);
        return "running";
      }
      bot.lastTargetKey = key;
      bot.lastClickX = now.getX();
      bot.lastClickY = now.getY();
      bot.lastClickAt = nowMs;
      const queue = player.getMovementQueue();
      debug(
        ctx,
        `interact:${distance}:obj=${object.getId()}@${objectLoc.getX()},${objectLoc.getY()}`
      );
      queue.walkToObject(object, {
        execute: () => {
          if (process.env.BOT_BRAIN_DEBUG === "1") {
            world.log?.("bot_brain_interact_click", {
              username: player.getUsername?.(),
              objectId: object.getId(),
              x: objectLoc.getX(),
              y: objectLoc.getY(),
            });
          }
          world.emitObjectInteraction?.({
            player,
            object,
            objectId: object.getId(),
            clickType: 1,
            location: {
              x: objectLoc.getX(),
              y: objectLoc.getY(),
              z: objectLoc.getZ(),
            },
            sourceLocation: {
              x: player.getLocation().getX(),
              y: player.getLocation().getY(),
              z: player.getLocation().getZ(),
            },
            handled: false,
          });
        },
      });
      return "running";
    },
    madeProgress(ctx) {
      const bot = stateFor(ctx.player);
      const produced = productionCount(ctx.player);
      const progressed = bot.lastProduction !== null && produced !== bot.lastProduction;
      bot.lastProduction = produced;
      return progressed;
    },
    stop(ctx) {
      const player = ctx?.player;
      if (!player) {
        return;
      }
      const bot = stateFor(player);
      bot.target = null;
      bot.lastProduction = null;
    },
  };
  return action;
}

function inventoryProductionCount(player) {
  let total = 0;
  for (const item of player?.getInventory?.()?.getItems?.() ?? []) {
    if (item?.getId?.() > 0) {
      total += item.getAmount();
    }
  }
  return total;
}

module.exports = {
  createInteractObjectAction,
  inventoryProductionCount,
};
