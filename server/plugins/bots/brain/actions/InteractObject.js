"use strict";

const { MapObjects } = require("../../../../src/main/typescript/elvarg/game/entity/impl/object/MapObjects");
const { Skill } = require("../../../../src/main/typescript/elvarg/game/model/Skill");
const Woodcutting = require("../../../skills/Woodcutting.plugin");
const {
  approachObject,
  queueRouteAndFlagAppearance,
  randomInRange,
} = require("../../behaviours/navigation/BotNavigation");

const MAX_TARGET_TILES = 64;
const MAX_DIRECT_ROUTE_TILES = 20;
const SEARCH_WALK_RADIUS = 10;
const INTERACT_COOLDOWN_MS = 1500;

function resolveObjectIds(spec) {
  if (Array.isArray(spec.objectIds) && spec.objectIds.length > 0) {
    return spec.objectIds.map(Number).filter(Number.isFinite);
  }
  if (spec.treeTier) {
    const tier = Woodcutting.TREES.find(
      (tree) =>
        tree.name === `${spec.treeTier} tree` ||
        tree.name === spec.treeTier ||
        tree.name?.startsWith(`${spec.treeTier} `)
    );
    return tier?.objectIds ?? [];
  }
  return [];
}

/**
 * Generic "walk to an object and use an option until X" action, modelled on the
 * old woodcutting loop but with no per-mode state: target acquisition, segmented
 * approach, interact, then progress is measured by produced items or XP.
 */
function createInteractObjectAction(spec, world) {
  const objectIds = resolveObjectIds(spec);
  const option = spec.option ?? "Chop down";
  const stallMs = Math.max(5, Number(spec.stallSeconds ?? 120)) * 1000;
  let target = null;
  let lastProduction = null;
  let lastClickAt = 0;

  function productionCount(player) {
    return world.productionCount?.(player) ?? 0;
  }

  function findTarget(player) {
    const loc = player.getLocation();
    const candidates =
      world.objectSearch?.findCandidatesByIds?.(player, objectIds, {
        regionRadius: 1,
        z: loc.getZ(),
        privateArea: player.getPrivateArea?.() ?? null,
      }) ?? [];
    let best = null;
    let bestDistSq = MAX_TARGET_TILES * MAX_TARGET_TILES;
    for (const object of candidates) {
      const objectLoc = object.getLocation();
      if (!objectLoc || objectLoc.getZ() !== loc.getZ()) {
        continue;
      }
      const dx = objectLoc.getX() - loc.getX();
      const dy = objectLoc.getY() - loc.getY();
      const distSq = dx * dx + dy * dy;
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        best = object;
      }
    }
    target = best
      ? {
          objectId: best.getId(),
          x: best.getLocation().getX(),
          y: best.getLocation().getY(),
          z: best.getLocation().getZ(),
        }
      : null;
  }

  function resolveTargetObject(player) {
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
    if (debugCounter % 20 !== 0) {
      return;
    }
    const player = ctx.player;
    const loc = player.getLocation?.();
    world.log?.("bot_brain_interact_debug", {
      username: player.getUsername?.(),
      detail,
      x: loc?.getX?.() ?? null,
      y: loc?.getY?.() ?? null,
      queue: player.getMovementQueue?.()?.size?.() ?? 0,
      target: target ? `${target.objectId}@${target.x},${target.y}` : null,
    });
  }

  return {
    id: "interactObject",
    update(ctx) {
      const { player, state, nowMs } = ctx;
      if (spec.until?.inventoryFull && player.getInventory().isFull()) {
        return "success";
      }
      if (world.isBusy?.(player)) {
        debug(ctx, "busy");
        return "running";
      }

      let object = target ? resolveTargetObject(player) : null;
      if (!object) {
        target = null;
        findTarget(player);
        object = target ? resolveTargetObject(player) : null;
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
        return "running";
      }
      if (player.getMovementQueue?.()?.size?.() > 0) {
        return "running";
      }
      // Re-issuing walkToObject every tick keeps resetting the route before its
      // arrival callback fires, so the click never lands. Space them out.
      if (nowMs - lastClickAt < INTERACT_COOLDOWN_MS) {
        return "running";
      }
      lastClickAt = nowMs;

      const objectLoc = object.getLocation();
      const queue = player.getMovementQueue();
      debug(
        ctx,
        `interact:${distance}:obj=${object.getId()}@${objectLoc.getX()},${objectLoc.getY()}`
      );
      queue.walkToObject(object, {
        execute: () => {
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
      debug(ctx, `after:queue=${queue.size?.() ?? 0}:route=${queue.hasRoute?.() ?? false}`);
      return "running";
    },
    madeProgress(ctx) {
      const produced = productionCount(ctx.player);
      const progressed = lastProduction !== null && produced !== lastProduction;
      lastProduction = produced;
      return progressed;
    },
    stop() {
      target = null;
      lastProduction = null;
    },
  };
}

function woodcuttingProductionCount(player) {
  const inventory = player.getInventory?.();
  if (!inventory) {
    return 0;
  }
  let total = 0;
  for (const logId of Woodcutting.TREE_LOG_IDS ?? []) {
    total += inventory.getAmount(logId);
  }
  total += Math.floor(
    player.getSkillManager?.().getExperience?.(Skill.WOODCUTTING) ?? 0
  );
  return total;
}

module.exports = {
  createInteractObjectAction,
  woodcuttingProductionCount,
};
