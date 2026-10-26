/**
 * Shattered Relics' minigame fragments: Barbarian Pest Wars, Rogues' Chompy Farm and Mother's Magic
 * Fossils (data/league-shattered.json `minigameEffects`; Wiki /Fragments). Each level's number in
 * the cache (Fragments.equippedValue) is the percent more a minigame pays (`minigame:points`: Pest
 * Control, Soul Wars, the Tithe Farm, the Mage Training Arena) or the percent likelier a find is
 * (`minigame:chance`: the Motherlode Mine's golden nuggets, Fossil Island's fossils). Rogues'
 * Chompy Farm also counts a chompy kill several times (`big-chompy-bird-hunting:kill-credit`).
 */
const Fragments = require("./Fragments.LeagueMode");
const { data } = require("./Shattered.LeagueMode");

function effects() {
  return data.minigameEffects;
}

/** The percent more an equipped fragment gives this minigame's `kind` from its `list` (points or chances), or null. */
function percentFor(player, list, minigame, kind) {
  for (const effect of Object.values(effects())) {
    if (!effect[list]?.[minigame]?.includes(kind)) continue;
    const percent = Fragments.equippedValue(player, effect.fragment);
    if (percent !== null) return percent;
  }
  return null;
}

function morePoints(request) {
  const percent = percentFor(request.player, "points", request.minigame, request.kind);
  if (percent !== null) request.amount = Math.floor((request.amount * (100 + percent)) / 100);
}

function likelier(request) {
  const percent = percentFor(request.player, "chances", request.minigame, request.kind);
  if (percent !== null) request.multiplier *= (100 + percent) / 100;
}

/** A chompy kill counts 2, 3 or 4 times by the fragment's level. */
function chompyKills(request) {
  const effect = effects().roguesChompyFarm;
  const level = Fragments.equippedLevel(request.player, effect.fragment);
  if (level > 0) request.kills = Math.max(request.kills, effect.chompyKills[level - 1]);
}

module.exports = function attach(api) {
  api.onCustomEvent("minigame:points", morePoints);
  api.onCustomEvent("minigame:chance", likelier);
  api.onCustomEvent("big-chompy-bird-hunting:kill-credit", chompyKills);
};

module.exports._test = { morePoints, likelier, chompyKills };
