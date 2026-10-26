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

/** Catalogs built from the cache (data `fromCache`), by league type. */
const cacheCatalogs = new Map();

function slug(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function enumEntries(id) {
  return [...core.CacheDefinitions.getEnumValues(id).entries()].sort(([a], [b]) => a - b);
}

/**
 * The current league's catalog as the cache holds it: the league struct's tier enum, each tier's
 * cost, passive struct and relic enum, each relic's name and description (the params the relic
 * interface reads). Relics granting items are not known from the cache, so none hands out items.
 */
function catalogFromCache(type) {
  const { params } = data;
  const { CacheDefinitions } = core;
  const leagueParams = CacheDefinitions.getStructParams(league(type).struct);
  const tiers = enumEntries(leagueParams.get(params.tiersEnum)).map(([, tierStruct]) => {
    const tierParams = CacheDefinitions.getStructParams(tierStruct);
    const passiveStruct = tierParams.get(params.tierPassive);
    const relics = enumEntries(tierParams.get(params.tierRelics)).map(([, relicStruct]) => {
      const relicParams = CacheDefinitions.getStructParams(relicStruct);
      const name = String(relicParams.get(params.relicName) ?? "");
      return { key: slug(name), name, description: String(relicParams.get(params.relicDescription) ?? ""), grants: [], struct: relicStruct };
    });
    return {
      cost: Number(tierParams.get(params.tierCost)) || 0,
      passive: String(CacheDefinitions.getStructParams(passiveStruct)?.get(params.passiveText) ?? ""),
      relics, struct: tierStruct, passiveStruct,
    };
  });
  return { fromCache: true, tiers };
}

/** A league's tiers and relics: the data's, or the cache's own for a league marked `fromCache`. */
function catalog(type) {
  const row = data.leagues[type];
  if (!row) return null;
  if (!row.fromCache) return row;
  if (!cacheCatalogs.has(type)) cacheCatalogs.set(type, catalogFromCache(type));
  return cacheCatalogs.get(type);
}

/** The struct ids the relic interface's scripts take for a relic and its tier's passive. */
function structIds(type, tier, slot) {
  const tierRow = catalog(type)?.tiers[tier];
  if (tierRow?.struct !== undefined) {
    return { relicStruct: tierRow.relics[slot - 1]?.struct, passiveStruct: tierRow.passiveStruct };
  }
  const id = ids(type);
  return { relicStruct: id.relicStruct(tier, slot), passiveStruct: id.passiveStruct(tier) };
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
  init, leagueOf, catalog, league, relic, chosen, points, highestTier, hasRelic, effectActive, ids, structIds, message, RELICS_ATTRIBUTE,
  derivedHit, isBuildingDerivedHit,
  get data() { return data; },
  get api() { return api; },
  get core() { return core; },
};
