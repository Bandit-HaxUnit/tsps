"use strict";

const { randomInRange } = require("../navigation/BotNavigation");

/**
 * PvP trash talk (issue #441). Lines fire on a per-bot cooldown while the bot is
 * fighting; nothing here changes combat state, it is pure flavour.
 */
const CHATTER_LINES = Object.freeze([
  "gf",
  "sit",
  "ez",
  "nice",
  "lag?",
  "1v1 me",
  "smite me",
  "free loot",
  "you're barred",
  "r u gonna eat that?",
  "thanks for the key",
  "stop praying",
  "nice spec",
  "did you just splash?",
  "coward",
  "tele noob",
  "my nan hits harder",
  "buying gf 10k",
  "bank loot?",
  "get rekt",
  "you call that a ko?",
  "cash me outside",
]);
const CHAT_COOLDOWN_MIN_MS = 9000;
const CHAT_COOLDOWN_MAX_MS = 24000;

function maybeChat(player, state, nowMs) {
  const pvp = state?.pvp;
  if (!player || !pvp || player.isPlayerBot?.() !== true) {
    return false;
  }
  if (nowMs < Number(pvp.nextChatAt ?? 0)) {
    return false;
  }
  pvp.nextChatAt = nowMs + randomInRange(CHAT_COOLDOWN_MIN_MS, CHAT_COOLDOWN_MAX_MS);
  if (player.isDyingReturn?.() === true || player.isTeleportingReturn?.() === true) {
    return false;
  }
  player.forceChat?.(CHATTER_LINES[Math.floor(Math.random() * CHATTER_LINES.length)]);
  return true;
}

module.exports = {
  CHATTER_LINES,
  maybeChat,
};
