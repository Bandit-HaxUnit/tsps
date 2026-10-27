/**
 * Shared by the LeagueRelics units: the data (league-relics.json, plus leagues.json for each
 * league's name, colour and unlock graphic), a character's league (LeagueMode's `league:profile`),
 * its chosen relics and points, and the catalog lookups.
 */
const fs = require("fs");
const path = require("path");

/** Chosen relics: tier index (0-7) -> slot (1-3). */
const RELICS_ATTRIBUTE = "league:relics";

let api = null;
let core = null;
let data = null;
let leagues = null;

function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  const dir = path.join(__dirname, "..", "data");
  data = JSON.parse(fs.readFileSync(path.join(dir, "league-relics.json"), "utf8"));
  leagues = JSON.parse(fs.readFileSync(path.join(dir, "leagues.json"), "utf8")).leagues;
}

/** The league a character is in (its type), or null for a main character. */
function leagueOf(player) {
  const query = { player, league: null };
  api.emitCustomEvent("league:profile", query);
  const type = query.league;
  return type !== null && data.leagues[type] && leagues[type] ? Number(type) : null;
}

function catalog(type) {
  return data.leagues[type] ?? null;
}

function league(type) {
  return leagues[type] ?? null;
}

function relic(type, tier, slot) {
  return catalog(type)?.tiers[tier]?.relics[slot - 1] ?? null;
}

function chosen(player) {
  const value = player.getAttribute(RELICS_ATTRIBUTE);
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function points(player) {
  const query = { player, points: 0, tasks: 0 };
  api.emitCustomEvent("league:points", query);
  return query.points | 0;
}

/** The highest tier index chosen, or -1. */
function highestTier(player) {
  return Object.keys(chosen(player)).reduce((highest, tier) => Math.max(highest, Number(tier)), -1);
}

/** Whether the character chose relic `key` in its own league's catalog. */
function hasRelic(player, key) {
  const type = leagueOf(player);
  if (type === null) return false;
  const picks = chosen(player);
  return catalog(type).tiers.some((tier, tierIndex) => tier.relics[picks[tierIndex] - 1]?.key === key);
}

/** An effect applies to a player character in the effect's league who chose its relic. */
function effectActive(player, effect) {
  return player?.isPlayer?.() === true && leagueOf(player) === effect.league && hasRelic(player, effect.key);
}

/** Virtual struct and enum ids for a league's catalog: the client reads them as if from the cache. */
function ids(type) {
  const base = data.virtualIdBase + Number(type) * 1000;
  return {
    tiersEnum: base,
    tierStruct: (tier) => base + 10 + tier,
    passiveStruct: (tier) => base + 20 + tier,
    relicsEnum: (tier) => base + 30 + tier,
    relicStruct: (tier, slot) => base + 100 + tier * 3 + (slot - 1),
  };
}

/** True while a relic builds a hit derived from another (a splash), so relics that scale hits leave it alone. */
let buildingDerivedHit = false;

/** Runs `build` (which constructs a PendingHit) as a derived hit; see `isBuildingDerivedHit`. */
function derivedHit(build) {
  buildingDerivedHit = true;
  try {
    return build();
  } finally {
    buildingDerivedHit = false;
  }
}

function isBuildingDerivedHit() {
  return buildingDerivedHit;
}

function message(key, values = {}) {
  return data.messages[key].text.replace(/\{(\w+)\}/g, (match, name) => values[name] ?? match);
}

module.exports = {
  init, leagueOf, catalog, league, relic, chosen, points, highestTier, hasRelic, effectActive, ids, message, RELICS_ATTRIBUTE,
  derivedHit, isBuildingDerivedHit,
  get data() { return data; },
  get api() { return api; },
  get core() { return core; },
};
