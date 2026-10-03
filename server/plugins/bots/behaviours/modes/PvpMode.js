"use strict";

const {
  PvpController,
  PVP_DURATION_DEFAULT_MIN_MS,
  PVP_DURATION_DEFAULT_MAX_MS,
  POST_PVP_COOLDOWN_MIN_MS,
  POST_PVP_COOLDOWN_MAX_MS,
} = require("../../brain/pvp/PvpController");

/**
 * Mode adapter for the PvP controller. The behaviour tree (roaming autonomy,
 * recruit follow-back) still enters pvp as a mode; every hook is implemented by
 * the same controller instance the brain uses.
 */
const PVP_MODE_DESCRIPTOR = Object.freeze({
  key: "pvp",
  modeProperty: "PVP",
  assignable: true,
  autonomous: Object.freeze({
    strategy: "try_start",
    weight: 0.05,
    params: Object.freeze({
      pvpMinMs: PVP_DURATION_DEFAULT_MIN_MS,
      pvpMaxMs: PVP_DURATION_DEFAULT_MAX_MS,
      pvpMaxDistanceTiles: 16,
      postPvpCooldownMinMs: POST_PVP_COOLDOWN_MIN_MS,
      postPvpCooldownMaxMs: POST_PVP_COOLDOWN_MAX_MS,
    }),
    priority: 10,
  }),
  modeStopParams: Object.freeze({
    postPvpCooldownMinMs: POST_PVP_COOLDOWN_MIN_MS,
    postPvpCooldownMaxMs: POST_PVP_COOLDOWN_MAX_MS,
  }),
  requiredHooks: [
    "behaviorRequirementsMet",
    "tryStartMode",
    "stopMode",
    "isModeStateValid",
    "handleBlocked",
  ],
  create({ botStatesByName, api, behaviorMode }) {
    return new PvpController(botStatesByName, api, {
      behaviorMode,
    });
  },
});

module.exports = {
  PVP_MODE_DESCRIPTOR,
};
