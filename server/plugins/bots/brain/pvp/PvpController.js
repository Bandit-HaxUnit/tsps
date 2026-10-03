"use strict";

const {
  applyGeneratedPvpLoadout,
} = require("../../behaviours/policies/PvpLoadoutPolicy");
const { randomInRange } = require("../../behaviours/navigation/BotNavigation");
const { Wilderness } = require("../../../../src/main/typescript/elvarg/game/content/wilderness/Wilderness");
const {
  isPvpOnlyBotState,
} = require("../../behaviours/state/PlayerBotState");

const SEEK_RETRY_MIN_MS = 1200;
const SEEK_RETRY_MAX_MS = 3500;

/**
 * Strangler adapter: the brain drives the existing PvP engine through this class
 * while its methods move here. It owns no per-bot state, so one instance (the
 * same one the pvp mode handler uses) serves every bot.
 */
class PvpController {
  constructor(options = {}) {
    this.behavior = options.behavior ?? null;
    this.api = options.api ?? null;
    this.getEntries =
      typeof options.getEntries === "function" ? options.getEntries : () => [];
  }

  isActive() {
    return this.behavior != null;
  }

  /** One engagement tick; mirrors PvpBehavior.tick's status codes. */
  tick({ player, state, nowMs }) {
    if (!this.behavior) {
      return "failure";
    }
    return this.behavior.tick({ player, state, nowMs });
  }

  /**
   * Target selection. Throttled through state.pvp.nextActionAt so a bot with no
   * candidate does not rescan the world every tick.
   */
  seek({ player, state, nowMs }) {
    if (!this.behavior) {
      return false;
    }
    const entries = this.getEntries();
    // Candidates are compared by entry identity, so the source must be the
    // canonical runtime entry or the bot can pick itself.
    const entry =
      entries.find((candidate) => candidate?.player === player) ?? { player, state };
    const started = this.behavior.tryStartMode({
      entry,
      entries,
      sharedCycleState: null,
      nowMs,
    });
    if (!started && state?.pvp) {
      if (process.env.BOT_BRAIN_DEBUG === "1") {
        this.logSeekMiss({ entry, entries, nowMs });
      }
      state.pvp.nextActionAt = nowMs + randomInRange(SEEK_RETRY_MIN_MS, SEEK_RETRY_MAX_MS);
    }
    return started;
  }

  /** PvP-only bots respawn through the registry resolver; re-gear them once healthy. */
  ensureLoadout(player, state) {
    if (!state?.pvp) {
      return false;
    }
    if ((player.getHitpoints?.() ?? 0) <= 0 || player.isDyingReturn?.() === true) {
      return false;
    }
    const hasInventory = player
      .getInventory?.()
      .getItems?.()
      .some((item) => item?.getId?.() > 0);
    const hasEquipment = player
      .getEquipment?.()
      .getItems?.()
      .some((item) => item?.getId?.() > 0);
    if (hasInventory || hasEquipment) {
      return false;
    }
    const applied = applyGeneratedPvpLoadout(player, state, { api: this.api });
    if (applied) {
      state.pvp.loadoutPending = false;
    }
    return applied;
  }

  /** BOT_BRAIN_DEBUG=1: why a seek found no fight, without guessing from logs. */
  logSeekMiss({ entry, entries, nowMs }) {
    const player = entry.player;
    const location = player.getLocation?.();
    const nearby = entries.filter(
      (candidate) =>
        candidate !== entry &&
        candidate?.player?.getLocation &&
        location &&
        location.getDistance(candidate.player.getLocation()) <= 16
    );
    const passing = nearby.filter(
      (candidate) =>
        this.behavior.isPvpCandidate?.({
          sourceEntry: entry,
          candidateEntry: candidate,
          entries,
          pvpIndex: null,
          nowMs,
          isInCombat: null,
        }) === true
    ).length;
    this.api?.log?.("bot_brain_pvp_seek_miss", {
      username: player.getUsername?.(),
      mode: entry.state?.mode ?? null,
      phase: entry.state?.pvp?.phase ?? null,
      pvpOnly: isPvpOnlyBotState(entry.state),
      wild: Wilderness.isIn(player),
      nearby: nearby.length,
      passing,
      nextInMs: Math.max(0, Math.floor(Number(entry.state?.pvp?.nextActionAt ?? 0) - nowMs)),
    });
  }
}

function createPvpController(options) {
  return new PvpController(options);
}

module.exports = {
  PvpController,
  createPvpController,
};
