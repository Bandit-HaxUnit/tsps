/**
 * Trickster (https://oldschool.runescape.wiki/w/Trickster), Trailblazer Reloaded's tier 1 relic:
 * Thieving, Agility, Hunter and Firemaking actions always succeed, the coin pouch limit is
 * tripled, a pickpocket repeats itself and its loot is doubled and noted, box traps lure faster
 * (ours: the trap's look for prey every 2 ticks instead of 5) with double loot and XP, impling
 * jars never break, and up to nine logs burn in one action. The Sage's greaves are not in this
 * cache.
 */
const Common = require("./Common.LeagueRelics");

let core;
let effect;

function active(player) {
  return Common.effectActive(player, effect);
}

/** The pickpocket always lands, and the pouch limit is tripled. */
function pickpocketTarget(request) {
  if (!request.target || !active(request.player)) return;
  request.target = { ...request.target, low: 256, high: 256 };
  request.pouchLimit *= effect.pouchLimitMultiplier;
}

/** Doubled and noted: coins come as pouches, so a second pouch stands for their double; a clue stays one clue. */
function loot(request) {
  if (!active(request.player)) return;
  const doubled = [];
  for (const entry of request.loot) {
    if (entry.clue) {
      doubled.push(entry);
    } else if (entry.id === core.ItemIdentifiers.COINS) {
      for (let copy = 0; copy < effect.lootMultiplier; copy++) doubled.push({ ...entry });
    } else {
      doubled.push({ ...entry, id: Common.noted(entry.id), amount: entry.amount * effect.lootMultiplier });
    }
  }
  request.loot = doubled;
}

function pickpocketAgain(request) {
  if (request.kind === "pickpocket" && active(request.player)) request.again = true;
}

function succeeds(request) {
  if (active(request.player)) request.success = true;
}

function catchChance(request) {
  if (active(request.player)) request.chance = 1;
}

/** Box traps: double loot and XP, and a quicker look for prey. */
function boxRewards(request) {
  if (request.kind !== "box" || !active(request.player)) return;
  request.rewards = request.rewards.map(([itemId, amount]) => [itemId, amount * effect.boxTrapMultiplier]);
  request.xp *= effect.boxTrapMultiplier;
}

function boxLure(request) {
  if (request.kind === "box" && active(request.player)) request.ticks = effect.boxTrapLureTicks;
}

function jarKept(request) {
  if (active(request.player)) request.kept = true;
}

function logsPerAction(request) {
  if (active(request.player)) request.amount = effect.logsPerAction;
}

module.exports = function attach(api) {
  core = api.core;
  effect = Common.data.effects.trickster;
  api.onCustomEvent("thieving:pickpocket-target", pickpocketTarget);
  api.onCustomEvent("thieving:loot", loot);
  api.onCustomEvent("thieving:done", pickpocketAgain);
  api.onCustomEvent("agility:roll", succeeds);
  api.onCustomEvent("hunter:catch-chance", catchChance);
  api.onCustomEvent("hunter:rewards", boxRewards);
  api.onCustomEvent("hunter:lure-interval", boxLure);
  api.onCustomEvent("hunter:jar-kept", jarKept);
  api.onCustomEvent("firemaking:light-roll", succeeds);
  api.onCustomEvent("firemaking:logs-per-action", logsPerAction);
};
