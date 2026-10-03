"use strict";

const { attachBrain } = require("./attachBrain");

/**
 * Swaps a bot onto the brain roam activity. Used by ::bot auto and by the
 * behaviour task's roaming fallback, so BT bots can hand themselves over to the
 * brain without a mode handler. Configured once at boot.
 */
let service = null;

function configureRoam(options = {}) {
  service = {
    runtime: options.runtime ?? null,
    registry: options.registry ?? null,
    world: options.world ?? null,
    resetMovementState: options.resetMovementState ?? null,
  };
}

function startBrainRoam(player, state, nowMs = Date.now(), home = null) {
  if (!player || !state || !service?.runtime || !service?.registry) {
    return false;
  }
  const username = player.getUsername?.();
  const entry = username ? service.runtime.entriesByUsername?.get?.(username) : null;
  if (!entry) {
    return false;
  }
  const activity = service.registry.byId?.get("roam") ?? null;
  if (!activity) {
    return false;
  }
  if (entry.brain) {
    entry.brain.releaseActivity?.();
    entry.brain = null;
  }
  return attachBrain({
    runtime: service.runtime,
    registry: service.registry,
    world: service.world,
    bot: player,
    activity,
    home: home ?? state.home ?? player.getLocation?.(),
    resetMovementState: service.resetMovementState,
    nowMs,
  });
}

module.exports = {
  configureRoam,
  startBrainRoam,
};
