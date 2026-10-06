"use strict";

const { playerState } = require("../ActionState");
const { nearestClusters, npcClustersFor } = require("../NpcClusterIndex");
const { canReachSpot } = require("../../behaviours/navigation/BotLongRoutes");
const { requestMovement, peekMovementRequest } = require("../../behaviours/navigation/BotNavigation");
const Fishing = require("../../../skills/Fishing.plugin");

// Spots of the chosen cluster: within this of its centre.
const SITE_RADIUS = 16;
// Within this of the centre a bot stops walking and looks for a spot.
const SITE_ARRIVE = 8;
const START_RETRY_MS = 3000;
// At the cluster with no spot to fish (all moved off, out of reach): move on.
const IDLE_MS = 60000;
// A spot walked at this many times without the fishing starting (no shore tile in reach):
// skip it.
const SPOT_TRIES = 3;
const SPOT_AVOID_MS = 2 * 60 * 1000;
const SITE_AVOID_MS = 10 * 60 * 1000;
// Walking to a cluster without getting any closer this long (a members-only or level-locked
// door, the Fishing Guild below 68): this bot skips it.
const NO_PROGRESS_MS = 60000;
// Fishers per spot weighed against walking distance, as combat training does.
const SPREAD_DISTANCE = 150;

// Cluster key -> fishers there, shared by every fishing action so bots spread out.
const SITE_OCCUPANTS = new Map();

function occupants(siteKey) {
  let players = SITE_OCCUPANTS.get(siteKey);
  if (!players) SITE_OCCUPANTS.set(siteKey, (players = new Set()));
  for (const player of players) if (player.isRegistered?.() === false) players.delete(player);
  return players;
}

const chebyshev = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const tile = (loc) => ({ x: loc.getX(), y: loc.getY(), z: loc.getZ() });

/** Fishing spots grouped by the tools they take, built from the live NPCs like combat clusters. */
function spotKeys(definition) {
  if (!Fishing.FISHING_SPOT_NAMES.includes(definition?.getName?.())) return null;
  const tools = Fishing.spotTools(definition.getId(), definition).map((entry) => entry.tool);
  return tools.length ? tools : null;
}

/**
 * Fishes spots that take `tool` (a Fishing TOOLS name: NET, FLY_FISHING_ROD, LOBSTER_POT,
 * HARPOON...) through the fishing plugin, as a click on the spot would. Spots come from
 * the NPC cluster index, so no spot coordinates are written down anywhere. Bait or
 * feathers are provisioned like a combat bot's runes and taken back when it stops, so
 * they never reach a bank.
 *
 * JSON: { "type": "fish", "tool": "FLY_FISHING_ROD", "bait": "feather", "until": { "inventoryFull": true } }
 */
function createFishAction(spec, world) {
  const toolName = spec.tool;
  if (!Fishing.TOOLS?.[toolName]) {
    throw new Error(`[bot activities] unknown fishing tool '${toolName}'`);
  }
  const baitId = Number.isInteger(spec.bait) ? spec.bait : null;
  const baitAmount = Math.max(1, Math.floor(Number(spec.baitAmount ?? 300)));
  const routeExists = world.routes?.canReachSpot ?? canReachSpot;
  const clickTypeAt = (npc) =>
    Fishing.spotTools(npc.getId(), npc.getDefinition()).find((entry) => entry.tool === toolName)?.clickType ?? 0;
  const stateFor = (player) => playerState(action, player, () => ({
    site: null, avoidedSites: new Map(), avoidedSpots: new WeakMap(), spotTries: new WeakMap(),
    idleSince: 0, lastStartAt: 0, approach: null, position: null, moved: false, bestDistance: Infinity, closerAt: 0,
  }));

  /** The least crowded nearby cluster the route planner can reach; null while still planning. */
  function selectSite(player, bot, nowMs) {
    const here = tile(player.getLocation());
    const index = npcClustersFor(world, "fishingSpots", spotKeys);
    const clusters = nearestClusters(index, [toolName], here)
      .filter((cluster) => (bot.avoidedSites.get(cluster.key) ?? 0) <= nowMs);
    const score = (cluster) => occupants(cluster.key).size / cluster.count + cluster.distance / SPREAD_DISTANCE;
    for (const cluster of clusters.sort((a, b) => score(a) - score(b))) {
      const reachable = routeExists(player, cluster, nowMs);
      if (reachable === undefined) return null;
      if (reachable === true) {
        bot.site = { key: cluster.key, x: cluster.x, y: cluster.y, z: cluster.z };
        occupants(cluster.key).add(player);
        bot.idleSince = 0;
        bot.bestDistance = Infinity;
        bot.closerAt = nowMs;
        return true;
      }
      bot.avoidedSites.set(cluster.key, nowMs + SITE_AVOID_MS);
    }
    return false;
  }

  function leaveSite(player, bot, nowMs, avoidMs = 0) {
    if (!bot.site) return;
    if (avoidMs) bot.avoidedSites.set(bot.site.key, nowMs + avoidMs);
    occupants(bot.site.key).delete(player);
    bot.site = null;
    bot.approach = null;
  }

  function nearestSpot(player, bot, nowMs) {
    const here = tile(player.getLocation());
    let best = null;
    let bestDistance = Infinity;
    // Not getNearbyNpcsForUpdate: that only sees NPCs in regions active around real players.
    for (const npc of world.core.World.getNpcsNear(player.getLocation(), SITE_RADIUS + 8, player.getPrivateArea?.() ?? null)) {
      if (npc.isRegistered?.() === false || (bot.avoidedSpots.get(npc) ?? 0) > nowMs || clickTypeAt(npc) === 0) continue;
      const at = tile(npc.getLocation());
      if (at.z !== here.z || chebyshev(at, bot.site) > SITE_RADIUS) continue;
      const distance = chebyshev(at, here);
      if (distance < bestDistance) {
        best = npc;
        bestDistance = distance;
      }
    }
    return best;
  }

  const action = {
    id: "fish",
    update(ctx) {
      const { player, nowMs } = ctx;
      const bot = stateFor(player);
      const inventory = player.getInventory();
      if (spec.until?.inventoryFull && inventory.isFull()) return "success";
      const loc = player.getLocation();
      const position = `${loc.getX()},${loc.getY()},${loc.getZ()}`;
      if (position !== bot.position) {
        bot.position = position;
        bot.moved = true;
      }
      if (baitId !== null && inventory.getAmount(baitId) < baitAmount / 2) {
        inventory.adds(baitId, baitAmount - inventory.getAmount(baitId));
      }
      if (Fishing.isFishingActive(player)) {
        bot.idleSince = 0;
        if (bot.approach) bot.spotTries.delete(bot.approach);
        bot.approach = null;
        return "running";
      }
      if (player.getMovementQueue().size() > 0 || peekMovementRequest(player)) return "running";
      const home = ctx.state?.home;
      if (!bot.site && home && Number.isFinite(home.z) && loc.getZ() !== home.z) {
        // Left upstairs (a bank floor): spots are found per floor, go back down first.
        requestMovement(player, home.x, home.y, { nowMs, z: home.z, reason: "brain_fish_walk", basicPather: true });
        return "running";
      }
      if (!bot.site) {
        const selected = selectSite(player, bot, nowMs);
        if (selected === null) return "running";
        if (!selected) return "failed";
      }
      const here = tile(loc);
      const spot = nearestSpot(player, bot, nowMs);
      if (spot) {
        if (nowMs - bot.lastStartAt < START_RETRY_MS) return "running";
        // Walked at before and still not fishing: that spot has no shore tile in reach.
        if (bot.approach === spot) {
          const tries = (bot.spotTries.get(spot) ?? 0) + 1;
          bot.spotTries.set(spot, tries);
          if (tries >= SPOT_TRIES) {
            bot.avoidedSpots.set(spot, nowMs + SPOT_AVOID_MS);
            bot.spotTries.delete(spot);
            bot.approach = null;
            return "running";
          }
        }
        bot.approach = spot;
        bot.lastStartAt = nowMs;
        // As a player's click on the spot: walk into NPC reach (adjacent, not diagonal or a
        // square back), face it and fish (NPCOptionPacketListener does the same).
        player.getMovementQueue().walkToEntity(spot, () => {
          const at = spot.getLocation();
          world.emitNpcInteraction?.({
            player, npc: spot, npcId: spot.getId(), npcIndex: spot.getIndex(),
            clickType: clickTypeAt(spot), location: { x: at.getX(), y: at.getY(), z: at.getZ() }, handled: false,
          });
        }, 1);
        return "running";
      }
      const fromSite = chebyshev(here, bot.site);
      if (fromSite < bot.bestDistance) {
        bot.bestDistance = fromSite;
        bot.closerAt = nowMs;
      } else if (fromSite > SITE_ARRIVE && nowMs - bot.closerAt >= NO_PROGRESS_MS) {
        leaveSite(player, bot, nowMs, SITE_AVOID_MS);
        return "running";
      }
      if (fromSite > SITE_ARRIVE) {
        requestMovement(player, bot.site.x, bot.site.y, { nowMs, z: bot.site.z, reason: "brain_fish_walk", basicPather: true });
        return "running";
      }
      bot.idleSince ||= nowMs;
      if (nowMs - bot.idleSince >= IDLE_MS) leaveSite(player, bot, nowMs, SITE_AVOID_MS);
      return "running";
    },
    stop(ctx) {
      const bot = stateFor(ctx.player);
      // Bait is provisioned for fishing only: take back what is left before a bank trip.
      const left = baitId !== null ? ctx.player.getInventory?.()?.getAmount(baitId) ?? 0 : 0;
      if (left > 0) ctx.player.getInventory().deleteNumber(baitId, left);
      leaveSite(ctx.player, bot, ctx.nowMs);
      bot.position = null;
    },
    madeProgress(ctx) {
      const bot = stateFor(ctx.player);
      const moved = bot.moved;
      bot.moved = false;
      return moved;
    },
    describe(ctx) {
      const bot = stateFor(ctx.player);
      return `fish ${toolName} site=${bot.site ? `${bot.site.x},${bot.site.y}` : "none"} ` +
        `active=${Fishing.isFishingActive(ctx.player)}`;
    },
  };
  return action;
}

module.exports = {
  createFishAction,
  spotKeys,
};
