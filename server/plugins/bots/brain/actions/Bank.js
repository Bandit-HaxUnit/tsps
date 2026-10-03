"use strict";

const { MapObjects } = require("../../../../src/main/typescript/elvarg/game/entity/impl/object/MapObjects");
const { Bank } = require("../../../../src/main/typescript/elvarg/game/model/container/impl/Bank");
const { BANK_BOOTH_IDS, isUsableBankBooth } = require("../../lib/BankBooths");
const { approachObject } = require("../../behaviours/navigation/BotNavigation");

const BANK_SEARCH_REGION_RADIUS = 2;
const MAX_DIRECT_ROUTE_TILES = 20;
const INTERACT_COOLDOWN_MS = 1500;
const DEPOSIT_DELAY_MS = 600;

/**
 * Deposits the inventory at the nearest usable bank booth, then reports success.
 * Segmented approach and the interact cooldown mirror the woodcutting action:
 * re-issuing walkToObject every tick cancels the arrival callback.
 */
function createBankAction(spec, world) {
  const requireFull = spec.until?.inventoryFull !== false;
  let booth = null;
  let lastClickAt = 0;
  let depositAt = 0;

  function findBooth(player) {
    const loc = player.getLocation();
    const candidates =
      world.objectSearch?.findCandidatesByIds?.(player, [...BANK_BOOTH_IDS], {
        regionRadius: BANK_SEARCH_REGION_RADIUS,
        z: loc.getZ(),
        privateArea: player.getPrivateArea?.() ?? null,
      }) ?? [];
    let best = null;
    let bestDistSq = Number.MAX_SAFE_INTEGER;
    for (const object of candidates) {
      if (!object || !isUsableBankBooth(object.getId())) {
        continue;
      }
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
    return best;
  }

  function resolveBooth(player) {
    if (!booth) {
      return null;
    }
    const loc = player.getLocation().clone();
    loc.set(booth.x, booth.y, booth.z);
    return MapObjects.get(booth.objectId, loc, player.getPrivateArea());
  }

  return {
    id: "bank",
    update(ctx) {
      const { player, nowMs } = ctx;
      if (depositAt > 0 && nowMs >= depositAt) {
        Bank.depositItems(player, player.getInventory(), true);
        depositAt = 0;
        world.log?.("bot_brain_bank_deposited", {
          username: player.getUsername?.(),
        });
        return "success";
      }
      if (requireFull && !player.getInventory().isFull()) {
        return "success";
      }

      const object = resolveBooth(player) ?? findBooth(player);
      if (!object) {
        return "failed";
      }
      booth = {
        objectId: object.getId(),
        x: object.getLocation().getX(),
        y: object.getLocation().getY(),
        z: object.getLocation().getZ(),
      };

      const loc = player.getLocation();
      const distance = Math.max(
        Math.abs(loc.getX() - booth.x),
        Math.abs(loc.getY() - booth.y)
      );
      if (distance > MAX_DIRECT_ROUTE_TILES) {
        approachObject(player, object, { nowMs, reason: "brain_bank_approach" });
        return "running";
      }
      if (player.getForceMovement?.() != null) {
        return "running";
      }
      if (player.getMovementQueue?.()?.size?.() > 0) {
        return "running";
      }
      if (nowMs - lastClickAt < INTERACT_COOLDOWN_MS) {
        return "running";
      }
      lastClickAt = nowMs;

      const objectLoc = object.getLocation();
      player.getMovementQueue().walkToObject(object, {
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
          depositAt = Date.now() + DEPOSIT_DELAY_MS;
        },
      });
      return "running";
    },
    stop() {
      booth = null;
      lastClickAt = 0;
      depositAt = 0;
    },
  };
}

module.exports = {
  createBankAction,
};
