"use strict";

const Woodcutting = require("../../skills/Woodcutting.plugin");
const Mining = require("../../skills/Mining.plugin");

const CATALOGS = {
  tree: () =>
    (Woodcutting.TREES ?? []).map((tree) => ({
      name: tree.name,
      ids: tree.objectIds ?? [],
    })),
  rock: () =>
    (Mining.ROCKS ?? []).map((rock) => ({
      name: rock.objectName,
      ids: rock.objectIds ?? [],
    })),
};

function normalize(value) {
  return String(value ?? "").toLowerCase();
}

/**
 * Object ids for an activity action: explicit objectIds, or a named tier from a
 * skill catalog ("normal" tree, "copper" rock). Catalogs keep the JSON free of
 * cache ids while the action stays skill-agnostic.
 */
function resolveCatalogObjectIds(spec = {}) {
  if (Array.isArray(spec.objectIds) && spec.objectIds.length > 0) {
    return spec.objectIds.map(Number).filter(Number.isFinite);
  }
  const kind = spec.catalog ?? (spec.treeTier ? "tree" : null);
  if (!kind) {
    return [];
  }
  const load = CATALOGS[kind];
  if (!load) {
    throw new Error(`[bot activities] unknown object catalog '${kind}'`);
  }
  const entries = load().filter((entry) => entry.ids.length > 0);
  const tier = spec.tier ?? spec.treeTier ?? null;
  if (!tier) {
    return entries.flatMap((entry) => entry.ids);
  }
  const wanted = normalize(tier);
  const match = entries.find((entry) => {
    const name = normalize(entry.name);
    return (
      name === wanted ||
      name === `${wanted} tree` ||
      name === `${wanted} rocks` ||
      name.startsWith(`${wanted} `)
    );
  });
  return match?.ids ?? [];
}

module.exports = {
  resolveCatalogObjectIds,
};
