"use strict";

const { attachBrain } = require("../attachBrain");

/**
 * Reactive pvp hand-off: behaviour-tree bots (clan recruits, a bot attacked by
 * a player) attach the ephemeral pvp_engage brain, which fights the seeded
 * target and hands control back when it is gone. Configured once at boot.
 */
let service = null;

function configureReactivePvp(options = {}) {
  service = {
    runtime: options.runtime ?? null,
    registry: options.registry ?? null,
    world: options.world ?? null,
    resetMovementState: options.resetMovementState ?? null,
  };
}

function startReactivePvp(player, state, nowMs = Date.now()) {
  if (!player || !state || !service?.runtime || !service?.registry) {
    return false;
  }
  const username = player.getUsername?.();
  const entry = username ? service.runtime.entriesByUsername?.get?.(username) : null;
  if (!entry) {
    return false;
  }
  const activity = service.registry.byId?.get("pvp_engage") ?? null;
  if (!activity) {
    return false;
  }
  if (state.pvp) {
    state.pvp.phase = "combat";
    state.pvp.nextActionAt = nowMs;
  }
  // A brain already exists: stack the fight as a child frame so the parent
  // activity (follow_owner, roam, a skilling loop) resumes when it ends.
  if (entry.brain) {
    if (entry.brain.isRunningActivity?.("pvp_engage")) {
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
  configureReactivePvp,
  startReactivePvp,
};
