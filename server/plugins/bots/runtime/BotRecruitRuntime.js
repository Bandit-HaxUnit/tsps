"use strict";

const { GameConstants } = require("../../../src/main/typescript/elvarg/game/GameConstants");
const { Misc } = require("../../../src/main/typescript/elvarg/util/Misc");
const {
  setModeFollowBack,
} = require("../behaviours/state/PlayerBotState");
const {
  ATTR_RECRUIT_OWNER_USERNAME,
  ATTR_RECRUIT_RETURN_AFTER_DEATH_AT,
  ATTR_RECRUIT_OWNER_MISSING_SINCE,
} = require("./BotRecruitConstants");

let RegionManager = null;

/** Called once from PlayerBots.plugin.js's register(api), before any bot behavior runs. */
function initBotRecruitRuntimeCoreAccess(api) {
  RegionManager = api.getRegionManager();
}

function alignBotToOwnerArea(bot, owner) {
  if (!bot || !owner || bot.getPrivateArea?.() === owner.getPrivateArea?.()) {
    return;
  }
  bot.setArea?.(owner.getArea?.() ?? null);
}

function teleportBotNearOwnerIfNeeded(bot, owner) {
  const botLoc = bot?.getLocation?.();
  const ownerLoc = owner?.getLocation?.();
  if (!botLoc || !ownerLoc) {
    return;
  }
  if (
    owner.isTeleportingReturn?.() !== true &&
    ownerLoc.isWithinDistance?.(
      botLoc,
      GameConstants.PET_FOLLOW_AUTO_TELEPORT_DISTANCE
    ) === true
  ) {
    return;
  }

  const tiles = [];
  for (const tile of owner.outterTiles?.() ?? []) {
    if (RegionManager.blocked?.(tile, owner.getPrivateArea?.())) {
      continue;
    }
    tiles.push(tile);
  }
  const destination =
    tiles.length > 0 ? tiles[Misc.getRandom(tiles.length - 1)] : ownerLoc;
  bot.moveTo?.(destination);
}

function armRecruitFollowBack(botState, behaviorMode) {
  if (!botState || !behaviorMode) {
    return;
  }
  if (!botState.autonomy) {
    botState.autonomy = {};
  }
  botState.autonomy.manualMode = behaviorMode.FOLLOW_BACK;
  botState.autonomy.modeEndsAt = Number.MAX_SAFE_INTEGER;
  botState.autonomy.nextDecisionAt = Number.MAX_SAFE_INTEGER;
}

function recallRecruitedBot(
  bot,
  owner,
  botState,
  behaviorMode,
  durationMs = 30000,
  nowMs = Date.now()
) {
  if (!bot || !owner || !botState || !behaviorMode) {
    return false;
  }
  bot.setAttribute?.(ATTR_RECRUIT_OWNER_USERNAME, owner.getUsername?.() ?? null);
  bot.setAttribute?.(ATTR_RECRUIT_RETURN_AFTER_DEATH_AT, null);
  bot.setAttribute?.(ATTR_RECRUIT_OWNER_MISSING_SINCE, null);
  alignBotToOwnerArea(bot, owner);
  teleportBotNearOwnerIfNeeded(bot, owner);
  armRecruitFollowBack(botState, behaviorMode);
  return setModeFollowBack(
    bot,
    botState,
    owner,
    nowMs,
    durationMs,
    behaviorMode,
    { allowInCombatTransition: true }
  );
}

module.exports = {
  initBotRecruitRuntimeCoreAccess,
  alignBotToOwnerArea,
  armRecruitFollowBack,
  recallRecruitedBot,
  teleportBotNearOwnerIfNeeded,
};
