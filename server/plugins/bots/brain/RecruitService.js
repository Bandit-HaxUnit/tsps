"use strict";

const { attachBrain } = require("./attachBrain");
const {
  ATTR_RECRUIT_OWNER_USERNAME,
  ATTR_RECRUIT_RETURN_AFTER_DEATH_AT,
  ATTR_RECRUIT_OWNER_MISSING_SINCE,
} = require("../runtime/BotRecruitConstants");

/**
 * Recruit hand-off into the brain: a bot follows its owner through the
 * follow_owner activity, replacing the old follow-back mode entirely.
 * Configured once at boot.
 */
let service = null;

function configureRecruit(options = {}) {
  service = {
    runtime: options.runtime ?? null,
    registry: options.registry ?? null,
    world: options.world ?? null,
    resetMovementState: options.resetMovementState ?? null,
  };
}

function startRecruit(player, state, owner, nowMs = Date.now()) {
  if (!player || !state || !owner || !service?.runtime || !service?.registry) {
    return false;
  }
  const username = player.getUsername?.();
  const entry = username ? service.runtime.entriesByUsername?.get?.(username) : null;
  if (!entry) {
    return false;
  }
  const activity = service.registry.byId?.get("follow_owner") ?? null;
  if (!activity) {
    return false;
  }
  const ownerUsername = owner.getUsername?.() ?? null;
  if (
    entry.brain?.isRunningActivity?.("follow_owner") &&
    player.getAttribute?.(ATTR_RECRUIT_OWNER_USERNAME) === ownerUsername
  ) {
    player.setAttribute?.(ATTR_RECRUIT_RETURN_AFTER_DEATH_AT, null);
    player.setAttribute?.(ATTR_RECRUIT_OWNER_MISSING_SINCE, null);
    return true;
  }
  player.setAttribute?.(ATTR_RECRUIT_OWNER_USERNAME, ownerUsername);
  player.setAttribute?.(ATTR_RECRUIT_RETURN_AFTER_DEATH_AT, null);
  player.setAttribute?.(ATTR_RECRUIT_OWNER_MISSING_SINCE, null);
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
    home: state.home ?? player.getLocation?.(),
    resetMovementState: service.resetMovementState,
    nowMs,
  });
}

module.exports = {
  configureRecruit,
  startRecruit,
};
