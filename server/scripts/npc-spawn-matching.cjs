"use strict";

// Parsing the Wiki's spawn coordinates and deciding which of them npc-spawns.json is missing,
// for scripts/sync-npc-spawns.ts (docs/npc-spawns.md). Plain JS so tests can load it.

/** "x:2580,y:8589" or "2580,8589" -> { x, y }; anything else -> null. */
function parsePoint(text) {
  const match = String(text).trim().match(/^(?:x:)?\s*(\d+)\s*,\s*(?:y:)?\s*(\d+)$/);
  return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
}

/**
 * The `{{Map}}` templates in an NPC infobox: `|map = {{Map|2576,2253|r=3}}`, or one per version
 * (`|map2 = {{Map|x=2589|y=8614|plane=0}}`). Returns { version (1-based, null when shared),
 * points, plane }. A polygon, rectangle or line outlines an area: it becomes one spawn at its
 * centre. The map's `r` only sizes the marker, so it's ignored.
 */
function parseInfoboxMaps(wikitext) {
  const maps = [];
  const pattern = /\|\s*map(\d*)\s*=\s*\{\{\s*Map\s*\|([^{}]*)\}\}/gi;
  for (const [, version, body] of String(wikitext).matchAll(pattern)) {
    const named = {};
    const points = [];
    for (const part of body.split("|")) {
      const equals = part.indexOf("=");
      const key = equals > 0 ? part.slice(0, equals).trim().toLowerCase() : null;
      if (key && !/^x:/.test(part.trim())) named[key] = part.slice(equals + 1).trim();
      else {
        const point = parsePoint(part);
        if (point) points.push(point);
      }
    }
    if (named.x !== undefined && named.y !== undefined) {
      const point = parsePoint(`${named.x},${named.y}`);
      if (point) points.push(point);
    }
    if (points.length === 0) continue;
    if (/^(polygon|rectangle|line)$/i.test(named.mtype ?? "") && points.length > 1) {
      const xs = points.map((point) => point.x);
      const ys = points.map((point) => point.y);
      const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      points.splice(0, points.length, { x: Math.round((minX + maxX) / 2), y: Math.round((minY + maxY) / 2) });
    }
    maps.push({
      version: version ? Number(version) : null,
      points,
      plane: Number.isFinite(Number(named.plane)) ? Number(named.plane) : 0,
    });
  }
  return maps;
}

/** Boxes from "minX,minY,maxX,maxY[,plane]". */
function parseBox(text) {
  const values = String(text).split(",").map((value) => Number(value.trim()));
  if (values.length < 4 || values.length > 5 || values.some((value) => !Number.isInteger(value))) {
    throw new Error(`Bad --box "${text}": expected minX,minY,maxX,maxY[,plane]`);
  }
  const [x1, y1, x2, y2, plane] = values;
  return { minX: Math.min(x1, x2), maxX: Math.max(x1, x2), minY: Math.min(y1, y2), maxY: Math.max(y1, y2), plane };
}

function inBoxes(spawn, boxes) {
  return boxes.some((box) => spawn.x >= box.minX && spawn.x <= box.maxX && spawn.y >= box.minY && spawn.y <= box.maxY
    && (box.plane === undefined || box.plane === spawn.level));
}

function nameKey(name) {
  return String(name ?? "").trim().toLowerCase();
}

/** Chebyshev distance on one plane; Infinity across planes. */
function distance(a, b) {
  return a.level === b.level ? Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) : Infinity;
}

/**
 * Which Wiki spawns the existing ones in the same boxes lack. Per NPC name and plane:
 * 1. each Wiki spawn takes the nearest unmatched existing spawn of that name within `radius`;
 * 2. existing spawns of that name left over still count, so only the difference in number is
 *    added (the Wiki spawns furthest from any existing one);
 * Existing spawns are never moved or removed, so a second run adds nothing.
 * Returns { add: wiki spawns to add, report: per name { wiki, existing, added } }.
 */
function planAdditions(wikiSpawns, existingSpawns, radius) {
  const byName = new Map();
  const group = (spawn, side) => {
    const key = `${nameKey(spawn.name)}@${spawn.level}`;
    if (!byName.has(key)) byName.set(key, { name: spawn.name, level: spawn.level, wiki: [], existing: [] });
    byName.get(key)[side].push(spawn);
  };
  wikiSpawns.forEach((spawn) => group(spawn, "wiki"));
  existingSpawns.forEach((spawn) => group(spawn, "existing"));

  const add = [];
  const report = [];
  for (const { name, level, wiki, existing } of byName.values()) {
    if (wiki.length === 0) continue;
    const unmatchedExisting = new Set(existing);
    const unmatchedWiki = [];
    for (const spawn of wiki) {
      let best = null;
      for (const candidate of unmatchedExisting) {
        const d = distance(spawn, candidate);
        if (d <= radius && (best === null || d < distance(spawn, best))) best = candidate;
      }
      if (best) unmatchedExisting.delete(best);
      else unmatchedWiki.push(spawn);
    }
    const missing = Math.max(0, unmatchedWiki.length - unmatchedExisting.size);
    const nearest = (spawn) => Math.min(Infinity, ...existing.map((other) => distance(spawn, other)));
    const chosen = unmatchedWiki.sort((a, b) => nearest(b) - nearest(a)).slice(0, missing);
    add.push(...chosen);
    report.push({ name, level, wiki: wiki.length, existing: existing.length, added: chosen.length });
  }
  return { add, report: report.sort((a, b) => b.added - a.added || a.name.localeCompare(b.name)) };
}

module.exports = { parsePoint, parseInfoboxMaps, parseBox, inBoxes, nameKey, distance, planAdditions };
