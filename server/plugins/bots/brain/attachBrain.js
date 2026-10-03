"use strict";

const { BotBrain } = require("./BotBrain");

/** Wires a spawned bot's entry to a brain running `activity`. Shared by sites, bench and ::bot. */
function attachBrain(options = {}) {
  const { runtime, registry, world, bot, activity, home, resetMovementState, nowMs } = options;
  if (!runtime || !registry || !bot || !activity) {
    return false;
  }
  const username = bot.getUsername?.();
  const state = username ? runtime.botStatesByName?.get?.(username) : null;
  const entry = username ? runtime.entriesByUsername?.get?.(username) : null;
  if (!state || !entry) {
    return false;
  }
  if (home) {
    state.home = { x: home.x, y: home.y, z: home.z ?? 0 };
  }
  if (state.autonomy) {
    state.autonomy.allowedAutonomousModes = null;
  }
  entry.brain = new BotBrain({
    player: bot,
    state,
    registry,
    world,
    activity,
    nowMs: nowMs ?? Date.now(),
  });
  resetMovementState?.(bot);
  return true;
}

module.exports = {
  attachBrain,
};
