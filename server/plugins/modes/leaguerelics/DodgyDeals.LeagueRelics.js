/**
 * Dodgy Deals (https://oldschool.runescape.wiki/w/Dodgy_Deals_(Raging_Echoes_League)), Raging
 * Echoes' tier 2 relic: every Thieving check succeeds, a pickpocket's loot is noted and
 * multiplied by the NPCs of the same kind within 5 tiles (the Wiki's 11x11; coins by the pouch),
 * the coin pouch limit is tripled, pickpockets and stall thefts repeat themselves, and stalls
 * never run out for the relic's owner.
 */
const Common = require("./Common.LeagueRelics");

let core;
let effect;

function active(player) {
  return Common.effectActive(player, effect);
}

function pickpocketTarget(request) {
  if (!request.target || !active(request.player)) return;
  request.target = { ...request.target, low: 256, high: 256 };
  request.pouchLimit *= effect.pouchLimitMultiplier;
}

/** NPCs of the pickpocketed kind within reach, the target among them. */
function crowd(player, npc) {
  const here = player.getLocation();
  const id = npc.getId();
  return Math.max(1, player.getLocalNpcs().filter((other) => other.getId() === id && other.getHitpoints() > 0
    && other.getLocation().getZ() === here.getZ() && other.getLocation().isWithinDistance(here, effect.radius)).length);
}

/** Noted, and as many as the crowd: a clue stays one; coins become that many pouches. */
function loot(request) {
  if (!active(request.player)) return;
  const times = crowd(request.player, request.npc);
  const multiplied = [];
  for (const entry of request.loot) {
    if (entry.clue) {
      multiplied.push(entry);
    } else if (entry.id === core.ItemIdentifiers.COINS) {
      for (let copy = 0; copy < times; copy++) multiplied.push({ ...entry });
    } else {
      multiplied.push({ ...entry, id: Common.noted(entry.id), amount: entry.amount * times });
    }
  }
  request.loot = multiplied;
}

function again(request) {
  if (active(request.player)) request.again = true;
}

function keepStall(request) {
  if (active(request.player)) request.handled = true;
}

module.exports = function attach(api) {
  core = api.core;
  effect = Common.data.effects.dodgyDeals;
  api.onCustomEvent("thieving:pickpocket-target", pickpocketTarget);
  api.onCustomEvent("thieving:loot", loot);
  api.onCustomEvent("thieving:done", again);
  api.onCustomEvent("thieving:deplete-stall", keepStall);
};
