const { PlayerRights } = require("../../../src/main/typescript/elvarg/game/model/rights/PlayerRights");
const { FriendsChatManager } = require("../../interface/FriendsChatManager");
const { recallRecruitedBot } = require("./BotRecruitRuntime");
const { callModeHook } = require("../behaviours/hooks/ModeHookContract");
const { isPvpOnlyBotState } = require("../behaviours/state/PlayerBotState");
const { ATTR_RECRUIT_OWNER_USERNAME } = require("./BotRecruitConstants");

function registerBotCommands(options) {
  const {
    api,
    botApi,
    runtime,
    behaviorMode,
    assignableBehaviors,
    modeHandlers,
    resetMovementState,
    taskManager,
    flashHintArrowTaskFactory,
  } = options;

  const activateMode = (target, state, mode, reason) =>
    callModeHook({
      modeHandlers,
      mode,
      hookName: "activateMode",
      payload: {
        player: target,
        state,
        nowMs: Date.now(),
        reason,
      },
      fallback: false,
      api: botApi,
      errorEvent: "bot_mode_activation_error",
    }) === true;
  const supportedBehaviorList = [
    ...Object.keys(assignableBehaviors ?? {}).sort((a, b) => a.localeCompare(b)),
    "auto",
  ].join("|");

  /** Locks a controlled bot into one behavior tree, shared by ::bh and ::bot <behavior>. */
  const assignManualBehavior = (target, state, normalizedBehavior) => {
    if (!activateMode(target, state, normalizedBehavior, "manual_override_assign")) {
      return false;
    }
    const currentLoc = target.getLocation?.();
    if (currentLoc) {
      state.home = {
        x: currentLoc.getX(),
        y: currentLoc.getY(),
        z: currentLoc.getZ(),
      };
    }
    if (!state.autonomy) {
      state.autonomy = {};
    }
    state.autonomy.manualMode = normalizedBehavior;
    state.autonomy.modeEndsAt = Number.MAX_SAFE_INTEGER;
    state.autonomy.nextDecisionAt = Number.MAX_SAFE_INTEGER;
    resetMovementState(target);
    return true;
  };

  /** Hands a bot back to autonomous mode selection. */
  const assignAutoBehavior = (target, state) => {
    if (!state.autonomy) {
      state.autonomy = {};
    }
    state.autonomy.manualMode = null;
    state.autonomy.modeEndsAt = 0;
    state.autonomy.nextDecisionAt = 0;
    if (!activateMode(target, state, behaviorMode.ROAMING, "manual_override_auto")) {
      return false;
    }
    resetMovementState(target);
    return true;
  };

  const pendingRecruits = new Map();
  api.registerCommand("bot", ({ player, parts }) => {
    const requested = (parts[1] ?? "pvp").toLowerCase();
    const normalizedBehavior =
      requested === "auto"
        ? "auto"
        : assignableBehaviors?.[requested] ??
          (requested === "sparring" ? assignableBehaviors?.pvp : null);
    if (!normalizedBehavior) {
      player.sendMessage(`Usage: ::bot [${supportedBehaviorList}] (default pvp)`);
      return true;
    }
    const bot = runtime.spawnPvpBot(player.getLocation(), { mode: normalizedBehavior });
    if (!bot) {
      player.sendMessage("Unable to spawn a PvP bot right now.");
      return true;
    }
    // The factory queues a world login. Clan membership and mode activation need the bot registered.
    pendingRecruits.set(bot, { owner: player, behavior: normalizedBehavior });
    return true;
  }, PlayerRights.DEVELOPER);
  api.onPlayerProcess(({ player: owner }) => {
    if (owner.isPlayerBot?.()) return;
    for (const [bot, pending] of pendingRecruits) {
      if (pending.owner !== owner || !bot.isRegistered()) continue;
      pendingRecruits.delete(bot);
      if (!owner.isRegistered()) continue;
      const username = bot.getUsername?.();
      const state = username ? runtime.botStatesByName.get(username) : null;
      if (pending.behavior !== behaviorMode.PVP) {
        if (!state) {
          owner.sendMessage(`Unable to start ${pending.behavior} for ${username}: missing bot state.`);
          continue;
        }
        // spawnPvpBot primes PvP-only autonomy; the requested behavior replaces it.
        if (state.autonomy) state.autonomy.allowedAutonomousModes = null;
        const assigned = pending.behavior === "auto"
          ? assignAutoBehavior(bot, state)
          : assignManualBehavior(bot, state, pending.behavior);
        owner.sendMessage(assigned
          ? `${username} spawned as ${pending.behavior}.`
          : `Unable to start ${pending.behavior} for ${username}.`);
        botApi.log("bot_spawn_behavior_assigned", {
          assignedBy: owner.getUsername(),
          target: username,
          behavior: pending.behavior,
          assigned,
        });
        continue;
      }
      if (!owner.getRelations().getFriendsChatChannelName()) {
        FriendsChatManager.setOwnChannelName(owner, owner.getUsername());
      }
      const recruited = FriendsChatManager.recruitBot(owner, bot);
      if (recruited && !recallRecruitedBot(bot, owner, state, behaviorMode)) {
        bot.setAttribute?.(ATTR_RECRUIT_OWNER_USERNAME, owner.getUsername());
        bot.setFollowing?.(owner);
        bot.setMobileInteraction?.(owner);
        bot.setPositionToFace?.(owner.getLocation?.());
      }
      bot.setArea(owner.getArea());
      bot.moveTo(owner.getLocation().clone());
      owner.sendMessage(recruited
        ? `${username} is geared, in your clan chat, and ready beside you.`
        : `${username} is geared and beside you, but could not join your clan chat.`);
    }
  });

  api.registerCommand("botme", ({ player, parts }) => {
    const mode = (parts[1] ?? "toggle").toLowerCase();
    if (mode === "status") {
      const enabled = runtime.hasControllerForPlayer(player);
      player.sendMessage(`botme: ${enabled ? "enabled" : "disabled"}`);
      return true;
    }

    const shouldEnable =
      mode === "on" ||
      mode === "start" ||
      (mode === "toggle" && !runtime.hasControllerForPlayer(player));

    if (shouldEnable) {
      const enabled = runtime.enableControllerForPlayer(player);
      if (!enabled.ok) {
        const reason =
          enabled.reason === "already_enabled"
            ? "already enabled"
            : enabled.reason === "not_registered"
            ? "player is not active"
            : "unable to enable";
        player.sendMessage(`botme: ${reason}.`);
        return true;
      }
      player.sendMessage(
        "botme enabled: your character is running PlayerBots behavior."
      );
      botApi.log("botme_enabled", { username: player.getUsername() });
      return true;
    }

    if (mode === "off" || mode === "stop" || mode === "toggle") {
      const disabled = runtime.disableControllerForPlayer(player);
      if (!disabled) {
        player.sendMessage("botme: already disabled.");
        return true;
      }
      player.sendMessage("botme disabled: your character is no longer bot-driven.");
      botApi.log("botme_disabled", { username: player.getUsername() });
      return true;
    }

    player.sendMessage("Usage: ::botme [on|off|toggle|status]");
    return true;
  }, PlayerRights.ADMINISTRATOR);

  api.registerCommand("bh", ({ player, parts }) => {
    const usernameArg = parts[1];
    const behaviorArg = parts[2]?.toLowerCase();
    if (!usernameArg || !behaviorArg) {
      player.sendMessage(`Usage: ::bh <username> <${supportedBehaviorList}>`);
      return true;
    }

    const wantsAuto = behaviorArg === "auto";
    const normalizedBehavior =
      assignableBehaviors[behaviorArg] ??
      (behaviorArg === "sparring" ? assignableBehaviors.pvp : null);
    if (!normalizedBehavior && !wantsAuto) {
      player.sendMessage(`Unknown behaviour. Supported: ${supportedBehaviorList}`);
      return true;
    }

    const target = runtime.resolveControlledPlayer(usernameArg);
    if (!target || !target.isRegistered()) {
      player.sendMessage(`bh: player not found: ${usernameArg}`);
      return true;
    }

    const targetUsername = target.getUsername?.();
    if (!targetUsername || !runtime.hasControllerForUsername(targetUsername)) {
      player.sendMessage(`bh: target is not bot-controlled: ${usernameArg}`);
      return true;
    }

    const state = runtime.botStatesByName.get(targetUsername);
    if (!state) {
      player.sendMessage(`bh: missing state for: ${targetUsername}`);
      return true;
    }

    if (wantsAuto) {
      if (!assignAutoBehavior(target, state)) {
        player.sendMessage(`bh: failed to switch ${targetUsername} to auto`);
        return true;
      }
      taskManager.submit(flashHintArrowTaskFactory(player, target));

      player.sendMessage(`bh: ${targetUsername} -> auto`);
      botApi.log("bot_behavior_assigned", {
        assignedBy: player.getUsername(),
        target: targetUsername,
        behavior: "auto",
      });
      return true;
    }

    if (!assignManualBehavior(target, state, normalizedBehavior)) {
      player.sendMessage(`bh: failed to activate mode for ${targetUsername}`);
      return true;
    }
    taskManager.submit(flashHintArrowTaskFactory(player, target));

    player.sendMessage(`bh: ${targetUsername} -> ${normalizedBehavior}`);
    botApi.log("bot_behavior_assigned", {
      assignedBy: player.getUsername(),
      target: targetUsername,
      behavior: normalizedBehavior,
    });
    return true;
  }, PlayerRights.ADMINISTRATOR);

  api.registerCommand("bothotspots", ({ player }) => {
    const countsByHotspot = new Map();
    const countsByLoadout = new Map();
    const countsByProfile = new Map();

    for (const entry of runtime.entries ?? []) {
      const state = entry?.state;
      if (!isPvpOnlyBotState(state)) {
        continue;
      }
      const hotspotId = state?.pvp?.hotspotId ?? "none";
      const loadoutId = state?.pvp?.loadoutId ?? "unknown";
      const profileId = state?.pvp?.profileId ?? "unknown";
      countsByHotspot.set(hotspotId, (countsByHotspot.get(hotspotId) ?? 0) + 1);
      countsByLoadout.set(loadoutId, (countsByLoadout.get(loadoutId) ?? 0) + 1);
      countsByProfile.set(profileId, (countsByProfile.get(profileId) ?? 0) + 1);
    }

    const formatCounts = (map) =>
      [...map.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([key, count]) => `${key}:${count}`)
        .join(", ");

    player.sendMessage(
      `hotspots ${formatCounts(countsByHotspot) || "none"}`
    );
    player.sendMessage(
      `loadouts ${formatCounts(countsByLoadout) || "none"}`
    );
    player.sendMessage(
      `profiles ${formatCounts(countsByProfile) || "none"}`
    );
    return true;
  }, PlayerRights.ADMINISTRATOR);
}

module.exports = {
  registerBotCommands,
};
