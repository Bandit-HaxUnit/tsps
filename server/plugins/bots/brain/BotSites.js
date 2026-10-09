"use strict";

/**
 * bot-sites.json with the deployment's choices applied: world.json / world.local.json
 * `pluginConfig` "PlayerBots:sites" maps a site id to properties that replace the site's own,
 * each top-level property whole (`bots` replaces every count). `true`/`false` is short for
 * `{ "enabled": ... }`. A world can then run its own bot population (skilling sites on, the PvP
 * pens off, fewer Lumbridge woodcutters) in its gitignored world.local.json and still update
 * from main by fast-forward.
 *
 *   "pluginConfig": { "PlayerBots:sites": {
 *     "edge_low": false,
 *     "lumbridge": { "enabled": true, "bots": { "woodcutting": 10 } }
 *   } }
 *
 * Sites and properties the map doesn't name keep theirs. Read through getPluginConfig, so the
 * layering is pluginConfig's: world.local.json's "PlayerBots:sites" replaces world.json's.
 */
const fs = require("fs");
const { PluginManager } = require("../../../src/main/typescript/elvarg/plugins/PluginManager");

const SITES_CONFIG_KEY = "PlayerBots:sites";

/** The "PlayerBots:sites" overrides: id -> site properties. Other values are skipped with a warning. */
function siteOverrides(raw = PluginManager.getPluginConfig(SITES_CONFIG_KEY)) {
  if (raw === undefined) return new Map();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    console.warn(`[bot sites] world config pluginConfig "${SITES_CONFIG_KEY}" must be an object of site id -> properties; ignored`);
    return new Map();
  }
  const overrides = new Map();
  for (const [id, value] of Object.entries(raw)) {
    const props = typeof value === "boolean" ? { enabled: value } : value;
    if (!props || typeof props !== "object" || Array.isArray(props)) {
      console.warn(`[bot sites] world config ${SITES_CONFIG_KEY}.${id} must be true, false or an object of site properties; ignored`);
      continue;
    }
    overrides.set(id, props);
  }
  return overrides;
}

/** Applies `overrides` to a parsed bot-sites.json in place, warning about ids it doesn't have. */
function applySiteOverrides(sitesFile, overrides) {
  const sites = Array.isArray(sitesFile?.sites) ? sitesFile.sites : [];
  const known = new Set(sites.map((site) => site.id));
  for (const id of overrides.keys()) {
    if (!known.has(id)) console.warn(`[bot sites] world config ${SITES_CONFIG_KEY} names unknown site '${id}'`);
  }
  for (const site of sites) {
    if (overrides.has(site.id)) Object.assign(site, overrides.get(site.id), { id: site.id });
  }
  return sitesFile;
}

/** Reads bot-sites.json (or `file`) with the world config's "PlayerBots:sites" applied. */
function readBotSites(file, raw) {
  const sitesFile = JSON.parse(fs.readFileSync(file, "utf8"));
  return applySiteOverrides(sitesFile, siteOverrides(raw));
}

module.exports = { readBotSites, siteOverrides, applySiteOverrides };
