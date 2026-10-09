"use strict";

/**
 * bot-sites.json with the deployment's choices applied: world.json / world.local.json
 * `botSites` maps a site id to whether it spawns, over the site's own `enabled`. A world can
 * then run its own bot population (skilling sites on, the PvP pens off) in its gitignored
 * world.local.json and still update from main by fast-forward.
 *
 *   "botSites": { "lumbridge": true, "edge_low": false }
 *
 * Sites the map doesn't name keep their `enabled`. Read through readWorldConfig, so the
 * layering is world.local.json's: its `botSites` replaces world.json's.
 */
const fs = require("fs");
const { readWorldConfig } = require("../../../src/main/typescript/elvarg/game/definition/WorldDefinition");

/** The `botSites` overrides: id -> enabled. Non-boolean values are skipped with a warning. */
function siteOverrides(config = readWorldConfig()) {
  const raw = config.botSites;
  if (raw === undefined) return new Map();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    console.warn("[bot sites] world config `botSites` must be an object of site id -> true/false; ignored");
    return new Map();
  }
  const overrides = new Map();
  for (const [id, enabled] of Object.entries(raw)) {
    if (typeof enabled !== "boolean") {
      console.warn(`[bot sites] world config botSites.${id} must be true or false; ignored`);
      continue;
    }
    overrides.set(id, enabled);
  }
  return overrides;
}

/** Applies `overrides` to a parsed bot-sites.json in place, warning about ids it doesn't have. */
function applySiteOverrides(sitesFile, overrides) {
  const sites = Array.isArray(sitesFile?.sites) ? sitesFile.sites : [];
  const known = new Set(sites.map((site) => site.id));
  for (const id of overrides.keys()) {
    if (!known.has(id)) console.warn(`[bot sites] world config botSites names unknown site '${id}'`);
  }
  for (const site of sites) {
    if (overrides.has(site.id)) site.enabled = overrides.get(site.id);
  }
  return sitesFile;
}

/** Reads bot-sites.json (or `file`) with the world config's `botSites` applied. */
function readBotSites(file, config) {
  const sitesFile = JSON.parse(fs.readFileSync(file, "utf8"));
  return applySiteOverrides(sitesFile, siteOverrides(config));
}

module.exports = { readBotSites, siteOverrides, applySiteOverrides };
