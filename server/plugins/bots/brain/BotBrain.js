"use strict";

const {
  clearMovementRequest,
  dispatchMovementRequest,
  peekMovementRequest,
} = require("../behaviours/navigation/BotNavigation");
const { maybeCrossDitch } = require("./DitchCrossing");

/**
 * Void-style behaviour runner: one action per bot per tick, driven by a frame
 * stack (activity at the bottom, resolvers pushed on top while a setup
 * requirement is unmet). No per-tick planning: an action either makes progress,
 * waits, succeeds, or fails, and failures re-assign on the next idle tick.
 */

const FRAME_STATE = Object.freeze({
  PENDING: "pending",
  RUNNING: "running",
  WAIT: "wait",
  SUCCESS: "success",
  FAILED: "failed",
});

class BehaviourFrame {
  constructor(behaviour) {
    this.behaviour = behaviour;
    this.actionIndex = 0;
    this.state = FRAME_STATE.PENDING;
    this.waitTicks = 0;
    this.blocked = new Set();
    this.lastProgressAt = 0;
    this.enteredAt = 0;
  }

  action() {
    return this.behaviour.actions[this.actionIndex] ?? null;
  }
}

class BotBrain {
  constructor(options) {
    this.player = options.player;
    this.state = options.state ?? null;
    this.registry = options.registry;
    this.world = options.world;
    this.frames = [];
    this.activeActivity = null;
    this.lastError = null;
    // Ephemeral brains are reactive overlays (a recruit defending its owner):
    // when the activity ends, onExhausted hands the bot back to the tree.
    this.ephemeral = options.ephemeral === true;
    this.onExhausted =
      typeof options.onExhausted === "function" ? options.onExhausted : null;
    if (options.activity) {
      this.pushActivity(options.activity, options.nowMs ?? Date.now());
    }
  }

  ensureState() {
    const state = this.state ?? this.world?.resolveState?.(this.player);
    if (state) {
      this.state = state;
    }
    return this.state;
  }

  pushActivity(activity, nowMs) {
    const frame = new BehaviourFrame(activity);
    frame.enteredAt = nowMs;
    this.frames.push(frame);
    if (activity.resolver !== true) {
      this.registry?.occupy?.(activity);
    }
    if (activity.actions?.length) {
      this.activeActivity = activity;
      const state = this.ensureState();
      if (state && activity.mode) {
        state.mode = activity.mode;
      }
    }
  }

  releaseActivity() {
    if (this.activeActivity) {
      this.registry?.release?.(this.activeActivity);
      this.activeActivity = null;
    }
  }

  reset() {
    this.releaseActivity();
    this.frames = [];
  }

  /** Skill plugins announce produces; this keeps stall timers from firing. */
  noteProgress(nowMs = Date.now()) {
    const frame = this.frames[this.frames.length - 1];
    if (frame) {
      frame.lastProgressAt = nowMs;
    }
  }

  assignNext(nowMs) {
    const activity = this.registry?.pickActivity?.(this.player, nowMs);
    if (!activity) {
      return false;
    }
    this.pushActivity(activity, nowMs);
    return true;
  }

  startFrame(frame, nowMs) {
    const ctx = this.context(frame, nowMs);
    for (const requirement of frame.behaviour.setup ?? []) {
      if (requirement.check(ctx)) {
        continue;
      }
      const resolvers = this.registry?.resolversFor?.(requirement, this.player) ?? [];
      const resolver = resolvers.find(
        (candidate) =>
          !frame.blocked.has(candidate.id) &&
          (candidate.requires ?? []).every((condition) => condition.check(ctx))
      );
      if (!resolver) {
        frame.state = FRAME_STATE.FAILED;
        frame.failReason = `unresolved:${requirement.id ?? "requirement"}`;
        this.world?.log?.("bot_brain_frame_failed", { reason: frame.failReason });
        return;
      }
      frame.blocked.add(resolver.id);
      this.pushActivity(resolver, nowMs);
      return;
    }
    for (const requirement of frame.behaviour.requires ?? []) {
      if (!requirement.check(ctx)) {
        frame.state = FRAME_STATE.FAILED;
        frame.failReason = `requires:${requirement.id ?? "requirement"}`;
        this.world?.log?.("bot_brain_frame_failed", { reason: frame.failReason });
        return;
      }
    }
    const action = frame.action();
    if (!action) {
      frame.state = FRAME_STATE.SUCCESS;
      return;
    }
    frame.lastProgressAt = nowMs;
    frame.state = FRAME_STATE.RUNNING;
  }

  nextAction(nowMs) {
    const frame = this.frames[this.frames.length - 1];
    if (!frame) {
      return;
    }
    frame.actionIndex += 1;
    if (frame.actionIndex >= (frame.behaviour.actions?.length ?? 0)) {
      const repeat = frame.behaviour.repeat === true;
      if (repeat) {
        frame.actionIndex = 0;
      } else {
        this.completeFrame(nowMs);
        return;
      }
    }
    frame.state = FRAME_STATE.PENDING;
    this.startFrame(frame, nowMs);
  }

  completeFrame(nowMs) {
    const frame = this.frames.pop();
    if (!frame) {
      return;
    }
    if (frame.behaviour.actions?.length && frame.behaviour === this.activeActivity) {
      this.releaseActivity();
    }
    const parent = this.frames[this.frames.length - 1];
    if (parent) {
      parent.state = FRAME_STATE.PENDING;
      return;
    }
    if (this.ephemeral) {
      this.onExhausted?.();
      return;
    }
    this.assignNext(nowMs);
  }

  context(frame, nowMs) {
    return {
      player: this.player,
      state: this.ensureState(),
      world: this.world,
      activity: this.activeActivity,
      frame,
      nowMs,
    };
  }

  /** Brain entries skip the behaviour tree, so they dispatch their own movement. */
  dispatchMovement() {
    const player = this.player;
    if (!player || player.getForceMovement?.() != null) {
      return;
    }
    if (player.getMovementQueue?.()?.size?.() > 0) {
      return;
    }
    const request = peekMovementRequest(player);
    if (!request) {
      return;
    }
    if (
      maybeCrossDitch({
        player,
        state: this.state ?? null,
        world: this.world,
        request,
      })
    ) {
      return;
    }
    const result = dispatchMovementRequest(player, request, this.state ?? undefined);
    const latest = peekMovementRequest(player);
    if (latest === request && result?.hasRoute === true) {
      clearMovementRequest(player);
    }
  }

  debugTick(frame) {
    if (process.env.BOT_BRAIN_DEBUG !== "1") {
      return;
    }
    this._debugCounter = (this._debugCounter ?? 0) + 1;
    if (this._debugCounter % 20 !== 0) {
      return;
    }
    const loc = this.player.getLocation?.();
    this.world?.log?.("bot_brain_debug", {
      username: this.player.getUsername?.(),
      state: frame?.state ?? "none",
      action: frame?.action()?.id ?? null,
      index: frame?.actionIndex ?? null,
      mode: this.state?.mode ?? null,
      x: loc?.getX?.() ?? null,
      y: loc?.getY?.() ?? null,
      queue: this.player.getMovementQueue?.()?.size?.() ?? 0,
    });
  }

  /** @returns {"running"|"idle"} */
  tick(nowMs = Date.now()) {
    this.dispatchMovement();
    // Global support runs before the activity action, as the tree's first
    // branches did: boosts, defensive/retreat, then eating.
    const support = this.world?.supportTick?.({
      player: this.player,
      state: this.ensureState(),
      nowMs,
    });
    if (support?.skip === true) {
      return "running";
    }
    const frame = this.frames[this.frames.length - 1];
    this.debugTick(frame);
    if (!frame) {
      if (!this.ephemeral) {
        this.assignNext(nowMs);
      }
      return "running";
    }
    switch (frame.state) {
      case FRAME_STATE.PENDING:
        this.startFrame(frame, nowMs);
        break;
      case FRAME_STATE.RUNNING: {
        const action = frame.action();
        if (!action) {
          frame.state = FRAME_STATE.SUCCESS;
          break;
        }
        const ctx = this.context(frame, nowMs);
        let result;
        try {
          result = action.update(ctx);
        } catch (error) {
          this.lastError = String(error?.message ?? error);
          this.world?.log?.("bot_brain_action_failed", {
            action: action.id,
            activity: this.activeActivity?.id ?? null,
            error: this.lastError,
          });
          result = "failed";
        }
        if (result === "success") {
          action.stop?.(ctx);
          this.nextAction(nowMs);
        } else if (result === "failed") {
          action.stop?.(ctx);
          frame.state = FRAME_STATE.FAILED;
        } else if (result === "wait") {
          frame.state = FRAME_STATE.WAIT;
          frame.waitTicks = Math.max(1, Number(ctx.waitTicks ?? 1));
        } else {
          if (action.madeProgress?.(ctx)) {
            frame.lastProgressAt = nowMs;
          }
        }
        break;
      }
      case FRAME_STATE.WAIT:
        frame.waitTicks -= 1;
        if (frame.waitTicks <= 0) {
          frame.state = FRAME_STATE.PENDING;
        }
        break;
      case FRAME_STATE.SUCCESS:
        this.completeFrame(nowMs);
        break;
      case FRAME_STATE.FAILED:
        this.failFrame(frame, nowMs);
        break;
      default:
        frame.state = FRAME_STATE.PENDING;
        break;
    }
    return "running";
  }

  failFrame(frame, nowMs) {
    this.frames.pop();
    const behaviour = frame.behaviour;
    if (behaviour.actions?.length) {
      if (behaviour.resolver !== true) {
        this.registry?.blockActivity?.(
          this.player,
          behaviour.id,
          nowMs,
          behaviour.failureCooldownMs
        );
      }
      this.releaseActivity();
    }
    const parent = this.frames[this.frames.length - 1];
    if (parent) {
      // A resolver failed: retry the parent next tick, it will look for another.
      parent.state = FRAME_STATE.PENDING;
      return;
    }
    if (this.ephemeral) {
      this.onExhausted?.();
      return;
    }
    this.assignNext(nowMs);
  }
}

module.exports = {
  BotBrain,
  FRAME_STATE,
};
