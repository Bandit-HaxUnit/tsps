// Generators (plugins/agent/mcp/EditGenerators.AgentMcp.js) and the hip roof rule, against
// fake stores. Run: node --test tests/edit-generator-mcp.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { z } = require("zod");

const geometry = require("../plugins/agent/mcp/EditGeometry.AgentMcp");
const registerEditGeneratorTools = require("../plugins/agent/mcp/EditGenerators.AgentMcp");
const registerEditStyleTools = require("../plugins/agent/mcp/EditStyles.AgentMcp");

test("the hip roof reproduces a Varrock house roof", () => {
  // varrock-house-a (8x7, roof on planes 2-3): eaves ring, a slope ring on plane 2, a slope
  // ring and two flat tops on plane 3.
  const roof = geometry.hipRoof(0, 0, 8, 7, { plane: 2 });
  const at = (x, y, plane) => roof.find((p) => p.x === x && p.y === y && p.z === plane);
  assert.deepEqual([at(0, 0, 2).type, at(0, 0, 2).face], [19, 1]);
  assert.deepEqual([at(7, 6, 2).type, at(7, 6, 2).face], [19, 3]);
  assert.deepEqual([at(3, 0, 2).type, at(3, 0, 2).face], [18, 1]);
  assert.deepEqual([at(1, 1, 2).type, at(1, 1, 2).face], [16, 1]);
  assert.deepEqual([at(6, 3, 2).type, at(6, 3, 2).face], [12, 0]);
  assert.deepEqual([at(2, 4, 3).type, at(2, 4, 3).face], [16, 2]);
  assert.deepEqual(roof.filter((p) => p.type === 17).map((p) => [p.x, p.y, p.z]), [[3, 3, 3], [4, 3, 3]]);
  assert.equal(roof.length, 26 + 18 + 10 + 2);
  // varrock-house-west's roof: no eaves, one slope ring and a 3x1 ridge on one plane.
  const small = geometry.hipRoof(0, 0, 5, 3, { plane: 2, eaves: false });
  assert.ok(small.every((p) => p.z === 2));
  assert.equal(small.filter((p) => p.type === 17).length, 3);
});

function setup() {
  process.env.AGENT_MCP_STYLES_FILE = require("node:path").join(
    require("node:fs").mkdtempSync(require("node:path").join(require("node:os").tmpdir(), "edit-gen-")), "styles.json");
  require("node:fs").writeFileSync(process.env.AGENT_MCP_STYLES_FILE, JSON.stringify({
    town: { wall: 10, corner: 10, door: 12, gate: null, roof: 20, window: 30, variants: [] },
    fence: { wall: 40, corner: 40, door: null, gate: 41, roof: null, window: null, variants: [] },
  }));
  const tools = new Map();
  const placed = [];
  const edits = [];
  const build = { applyPlacements: (list) => { placed.push(...list); return { placed: list.length }; } };
  const terrain = { applyEdits: (list) => { edits.push(...list); return { regions: [] }; }, tileAt: () => ({}) };
  const ctx = { core: { ObjectDefinition: { forId: () => null } }, z, tool: (name, _d, _s, handler) => tools.set(name, handler) };
  const styles = registerEditStyleTools(ctx, { build, terrain, objectsIn: () => [] });
  registerEditGeneratorTools(ctx, { build, terrain, styles });
  return { call: async (name, args) => tools.get(name)(args), placed, edits };
}

test("build_house: walls round the inside, a door, windows, floors, flags and a roof", async () => {
  const t = setup();
  const result = await t.call("build_house", { style: "town", x: 100, y: 100, width: 6, height: 5, storeys: 2, door: "south" });
  assert.equal(result.roof, true);
  const level = (n) => t.placed.filter((p) => p.z === n && p.type <= 4);
  // Ground floor: the wall ring with one door; upstairs the same ring without it.
  assert.equal(level(0).filter((p) => p.id === 12).length, 1, "one door downstairs");
  assert.equal(level(1).filter((p) => p.id === 12).length, 0, "no door upstairs");
  assert.ok(level(0).every((p) => p.x >= 100 && p.x <= 105 && p.y >= 100 && p.y <= 104));
  assert.ok(result.windows > 0);
  // The roof starts above the top storey.
  assert.ok(t.placed.filter((p) => p.id === 20).every((p) => p.z >= 2));
  // Indoor tiles: floor and indoor flag on both storeys; the roof plane carries the roof flag.
  assert.equal(t.edits.filter((e) => e.kind === "terrain" && e.plane === 0).length, 4 * 3);
  assert.equal(t.edits.filter((e) => e.kind === "flag" && e.plane === 2 && e.locId === 16).length, 6 * 5);
  const dry = await t.call("build_house", { style: "town", x: 0, y: 0, width: 4, height: 4, dryRun: true });
  assert.equal(dry.dryRun, true);
});

test("build_graveyard and build_farm: an enclosure with a gate, filled from the sets", async () => {
  const t = setup();
  const yard = await t.call("build_graveyard", { style: "fence", x: 10, y: 10, width: 9, height: 8 });
  assert.ok(yard.stones >= 6);
  assert.equal(t.placed.filter((p) => p.id === 41).length, 1, "the fence's gate hangs in the gateway");
  assert.ok(t.edits.every((e) => e.tileX === 14), "the path runs up the middle from the south gate");
  t.placed.length = 0;
  await t.call("build_farm", { style: "fence", x: 30, y: 30, width: 7, height: 6, crop: "cabbage" });
  assert.ok(t.placed.filter((p) => p.id === 1161).length >= 15);
  assert.ok(t.placed.some((p) => p.id === 297), "a scarecrow");
  await assert.rejects(t.call("build_farm", { style: "fence", x: 30, y: 30, width: 7, height: 6, crop: "melon" }), /Unknown crop/);
});
