"use strict";

const { attachBrain } = require("./attachBrain");

/**
 * Reactive bank flee: a bot attacked by a real player runs to the nearest bank
 * and deposits, then the parent activity resumes. Pushed as a nested frame when
 * the bot already has a brain, otherwise attached as an ephemeral brain.
 * Configured once at boot.
 */
let service = null;

function configureBankTrip(options = {}) {
  service = {
    runtime: options.runtime ?? null,
    registry: options.registry ?? null,
    world: options.world ?? null,
    resetMovementState: options.resetMovementState ?? null,
  };
}

function startBankTrip(player, state, nowMs = Date.now()) {
  if (!player || !state || !service?.runtime || !service?.registry) {
    return false;
  }
  const username = player.getUsername?.();
  const entry = username ? service.runtime.entriesByUsername?.get?.(username) : null;
  if (!entry) {
    return false;
  }
  const activity = service.registry.byId?.get("bank_trip") ?? null;
  if (!activity) {
    return false;
  }
  if (entry.brain) {
    if (entry.brain.isRunningActivity?.("bank_trip")) {
      return true;
    }
    entry.brain.pushActivity(activity, nowMs);
    return true;
  }
  return attachBrain({
    runtime: service.runtime,
    registry: service.registry,
    world: service.world,
    bot: player,
    activity,
    home: state.home ?? null,
    resetMovementState: service.resetMovementState,
    nowMs,
  });
}

module.exports = {
  configureBankTrip,
  startBankTrip,
};
