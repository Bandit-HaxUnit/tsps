"use strict";

const Rolls = require("./Rolls.RewardCaskets");

/** The source the casket rolls name on "drops:chance" { player, source, rules }. */
const UNIQUES_SOURCE = "treasure-trails-casket";
/** The dump's sections of a tier's unique rewards ("Hard clue uniques", "Mega-rare table - Hard clues"). */
const UNIQUES_SECTION = /clue uniques$|^mega.?rare table/i;

let api = null;

/** How many times likelier a casket row is: the chance rules matching a unique's name (a league's boosted drops); other rows stay. */
function uniqueMultiplier(player) {
  const rules = [];
  if (player) api.emitCustomEvent("drops:chance", { player, source: UNIQUES_SOURCE, rules });
  if (rules.length === 0) return () => 1;
  return (row) => (UNIQUES_SECTION.test(row.section ?? "")
    ? rules.reduce((boost, rule) => (rule.pattern.test(row.name ?? "") ? boost * rule.multiplier : boost), 1)
    : 1);
}

/** Mutable response: { player, tier, rolls, drops:null, handled:false, error:null }. */
function rollCasket(request) {
  if (!request || request.handled) return;
  try {
    request.drops = Rolls.roll(request.tier, request.rolls, Math.random, uniqueMultiplier(request.player));
    request.handled = true;
  } catch (error) {
    request.error = error;
  }
}

function init(pluginApi) {
  api = pluginApi;
}

module.exports = {
  name: "RewardCaskets",
  members: true,
  register(api) {
    init(api);
    api.onCustomEvent("treasure-trails:roll-casket", rollCasket);
  },
};
