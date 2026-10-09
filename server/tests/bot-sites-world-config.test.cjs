// Run after `yarn build`: node --test tests/bot-sites-world-config.test.cjs
// world.json / world.local.json pluginConfig "PlayerBots:sites" switches bot-sites.json sites on or off
// (plugins/bots/brain/BotSites.js, server/docs/bot-combat-training.md).
const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { readBotSites, siteOverrides, applySiteOverrides } = require("../plugins/bots/brain/BotSites");

const SITES = path.resolve(__dirname, "..", "data", "definitions", "bot-sites.json");

const sitesConfig = (sites) => ({ pluginConfig: { "PlayerBots:sites": sites } });

function quietly(fn) {
  const warnings = [];
  const warn = console.warn;
  console.warn = (message) => warnings.push(String(message));
  try {
    return { result: fn(), warnings };
  } finally {
    console.warn = warn;
  }
}

test("PlayerBots:sites switches the named sites; the rest keep their own enabled", () => {
  const file = { sites: [{ id: "lumbridge", enabled: false }, { id: "edge_low", enabled: true }, { id: "seers", enabled: false }] };
  applySiteOverrides(file, siteOverrides(sitesConfig({ lumbridge: true, edge_low: false })));
  assert.deepEqual(file.sites.map((site) => [site.id, site.enabled]), [["lumbridge", true], ["edge_low", false], ["seers", false]]);
});

test("no PlayerBots:sites leaves bot-sites.json as it ships", () => {
  assert.equal(siteOverrides({}).size, 0);
});

test("a value that isn't true/false, or an unknown site, is warned about and ignored", () => {
  const { result, warnings } = quietly(() => {
    const overrides = siteOverrides(sitesConfig({ lumbridge: "yes", varrock: true, atlantis: true }));
    return applySiteOverrides({ sites: [{ id: "lumbridge", enabled: false }, { id: "varrock", enabled: false }] }, overrides);
  });
  assert.deepEqual(result.sites.map((site) => site.enabled), [false, true]);
  assert.ok(warnings.some((line) => line.includes("PlayerBots:sites.lumbridge")));
  assert.ok(warnings.some((line) => line.includes("'atlantis'")));
  assert.equal(quietly(() => siteOverrides(sitesConfig(["lumbridge"])).size).result, 0);
});

test("the shipped bot-sites.json: skilling sites on and the PvP pens off, as a deployment would set it", () => {
  const ids = ["lumbridge", "varrock", "falador", "seers", "east_ardougne", "edge_low", "edge_mid", "edge_mains", "varrock_ditch", "green_drags_gate", "revs_entrance"];
  const botSites = Object.fromEntries(ids.map((id) => [id, !id.startsWith("edge") && !["varrock_ditch", "green_drags_gate", "revs_entrance"].includes(id)]));
  const { result, warnings } = quietly(() => readBotSites(SITES, sitesConfig(botSites)));
  assert.deepEqual(warnings, [], "every id is a real site");
  const enabled = Object.fromEntries(result.sites.map((site) => [site.id, site.enabled]));
  assert.deepEqual(ids.map((id) => enabled[id]), ids.map((id) => botSites[id]));
  assert.ok(result.sites.filter((site) => site.pvp).every((site) => site.enabled === false));
});
