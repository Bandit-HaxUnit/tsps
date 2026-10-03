const {
  isPvpOnlyBotState,
  setModeFollowBack,
  setModePvp,
} = require("../state/PlayerBotState");
const { startBankTrip } = require("../../brain/BankTripService");

const PERSISTENT_PVP_REACTION_DURATION_MS = 30000;

function clampChance(value, fallback = 0.5) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, numeric));
}

function cloneResourceTarget(target) {
  if (
    !target ||
    !Number.isFinite(target.objectId) ||
    !Number.isFinite(target.x) ||
    !Number.isFinite(target.y) ||
    !Number.isFinite(target.z)
  ) {
    return null;
  }
  return {
    objectId: target.objectId,
    x: target.x,
    y: target.y,
    z: target.z,
  };
}

function startRunAwayBankRun({
  bot,
  state,
  attacker,
  nowMs,
  behaviorMode,
  api,
}) {
  if (!bot || !state || !behaviorMode) {
    return false;
  }
  if (state.mode === behaviorMode.BANK_RUN) {
    return true;
  }
  if (!startBankTrip(bot, state, nowMs)) {
    return false;
  }
  api?.log?.("bot_run_away_started_by_attack", {
    bot: bot.getUsername?.(),
    attacker: attacker?.getUsername?.() ?? null,
    mode: behaviorMode.BANK_RUN,
  });
  return true;
}

function retaliateAgainstAttacker(bot, attacker, attackerIsPlayerBot, forceImmediate = false) {
  if (!bot || !attacker) {
    return;
  }
  const combat = bot.getCombat?.();
  if (!combat || bot.getHitpoints?.() <= 0 || attacker.getHitpoints?.() <= 0) {
    return;
  }

  const alreadyTargetingAttacker = combat.getTarget?.() === attacker;
  if (alreadyTargetingAttacker) {
    return;
  }

  if (attackerIsPlayerBot || forceImmediate === true) {
    bot.getMovementQueue?.().reset?.();
    combat.attack(attacker);
    return;
  }

  // Avoid pre-emptive attack against real players to prevent unintended skulls.
  const alreadyUnderAttackByPlayer = combat.getAttacker?.() === attacker;
  const alreadyHasDamageFromPlayer = combat.damageMapContains?.(attacker) === true;
  if (alreadyUnderAttackByPlayer || alreadyHasDamageFromPlayer) {
    bot.getMovementQueue?.().reset?.();
    combat.attack(attacker);
  }
}

function handlePlayerAttackReaction({
  bot,
  state,
  attacker,
  attackerIsPlayerBot,
  nowMs = Date.now(),
  followBackDurationMs,
  playerRunAwayChance,
  behaviorMode,
  api,
}) {
  if (!bot || !state || !attacker || !behaviorMode) {
    return false;
  }

  if (state.pvp?.retreat) return true;

  if (isPvpOnlyBotState(state)) {
    if (state.mode !== behaviorMode.PVP) {
      setModePvp(
        bot,
        state,
        attacker,
        nowMs,
        PERSISTENT_PVP_REACTION_DURATION_MS,
        behaviorMode,
        { allowInCombatTransition: true }
      );
    } else if (state?.pvp) {
      state.pvp.targetUsername = attacker.getUsername?.() ?? state.pvp.targetUsername;
      state.pvp.targetPlayer = attacker;
      state.pvp.endsAt = Math.max(
        Number(state.pvp.endsAt ?? 0),
        nowMs + PERSISTENT_PVP_REACTION_DURATION_MS
      );
      state.pvp.nextActionAt = nowMs;
    }

    retaliateAgainstAttacker(bot, attacker, attackerIsPlayerBot, true);
    api?.log?.("persistent_pvp_reaction", {
      bot: bot.getUsername?.() ?? null,
      attacker: attacker.getUsername?.() ?? null,
      attackerIsPlayerBot: attackerIsPlayerBot === true,
    });
    return true;
  }

  const fleeChance = clampChance(playerRunAwayChance, 0.5);
  if (
    !attackerIsPlayerBot &&
    Math.random() < fleeChance &&
    startRunAwayBankRun({
      bot,
      state,
      attacker,
      nowMs,
      behaviorMode,
      api,
    })
  ) {
    return true;
  }

  if (
    !setModeFollowBack(
      bot,
      state,
      attacker,
      nowMs,
      followBackDurationMs,
      behaviorMode
    )
  ) {
    return false;
  }

  retaliateAgainstAttacker(bot, attacker, attackerIsPlayerBot);
  api?.log?.("follow_back_started_by_attack", {
    bot: bot.getUsername?.() ?? null,
    attacker: attacker.getUsername?.() ?? null,
    attackerIsPlayerBot: attackerIsPlayerBot === true,
    durationMs: followBackDurationMs,
  });
  return true;
}

module.exports = {
  handlePlayerAttackReaction,
};
