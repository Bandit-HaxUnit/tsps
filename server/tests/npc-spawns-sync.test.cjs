// Run after `yarn build`: node --test tests/npc-spawns-sync.test.cjs
// The Wiki spawn sync (scripts/sync-npc-spawns.ts, docs/npc-spawns.md): reading the Wiki's
// coordinates, adding only what's missing, and the Wyrmscraig spawns it wrote.
const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');

const { parsePoint, parseInfoboxMaps, parseBox, inBoxes, planAdditions } = require('../scripts/npc-spawn-matching.cjs');

test("reads the Wiki's coordinate forms", () => {
  assert.deepEqual(parsePoint('x:2580,y:8589'), { x: 2580, y: 8589 });
  assert.deepEqual(parsePoint('2615,8625'), { x: 2615, y: 8625 });
  assert.equal(parsePoint('zoom=3'), null);
  // Cormac: a square around one tile; Mortimer: named coordinates on a plane.
  assert.deepEqual(parseInfoboxMaps('|map = {{Map|2576,2253|mtype=square|r=3|zoom=3}}'),
    [{ version: null, points: [{ x: 2576, y: 2253 }], plane: 0 }]);
  assert.deepEqual(parseInfoboxMaps('|map2 = {{Map|x=2589|y=8614|plane=1|r=4|mapID=-1|mtype=pin}}'),
    [{ version: 2, points: [{ x: 2589, y: 8614 }], plane: 1 }]);
  // Muriel: a polygon outlining an area is one spawn at its centre.
  assert.deepEqual(parseInfoboxMaps('|map = {{Map|2584,2255|2589,2255|2589,2264|2586,2264|2586,2261|2584,2261|mtype=polygon|r=3|zoom=3}}'),
    [{ version: null, points: [{ x: 2587, y: 2260 }], plane: 0 }]);
  const box = parseBox('2640,2290,2530,2190');
  assert.ok(inBoxes({ x: 2576, y: 2253, level: 2 }, [box]), 'every plane unless given');
  assert.ok(!inBoxes({ x: 2576, y: 2253, level: 2 }, [parseBox('2530,2190,2640,2290,0')]));
});

test('adds only what the existing spawns lack, so a second run adds nothing', () => {
  const at = (name, x, y, level = 0) => ({ name, x, y, level });
  const wiki = [at('Wyrm', 10, 10), at('Wyrm', 20, 10), at('Wyrm', 30, 10), at('Wyrm', 40, 10), at('Bat', 5, 5)];
  // One wyrm 2 tiles off the Wiki's, one far from any: both count; the bat is missing.
  const existing = [at('wyrm', 12, 11), at('Wyrm', 100, 100), at('Bat', 5, 5, 1)];
  const { add, report } = planAdditions(wiki, existing, 4);
  assert.deepEqual(report.find((row) => row.name === 'Wyrm'), { name: 'Wyrm', level: 0, wiki: 4, existing: 2, added: 2 });
  // The two added are the Wiki spawns furthest from any existing wyrm.
  assert.deepEqual(add.filter((spawn) => spawn.name === 'Wyrm').map((spawn) => spawn.x).sort(), [30, 40]);
  assert.equal(add.filter((spawn) => spawn.name === 'Bat').length, 1, 'a bat on another plane is a different spawn');
  assert.equal(planAdditions(wiki, [...existing, ...add], 4).add.length, 0);
});

test('Wyrmscraig spawns come from the Wiki, with ids in the cache and their drops', async () => {
  const { Server } = require('../dist/Server');
  Server.installProductionPathResolver();
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(path.resolve(__dirname, '..'));
  const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
  const spawns = require('../data/definitions/npc-spawns.json');
  const drops = require('../data/definitions/npc-drops.json').npcs;
  const island = spawns.filter((spawn) => spawn.source === 'wiki' && inBoxes(spawn, [parseBox('2520,2170,2660,2310'), parseBox('2560,8560,2640,8660')]));
  assert.ok(island.length >= 80, `${island.length} Wyrmscraig spawns`);
  for (const spawn of island) {
    const npc = CacheDefinitions.getNpc(spawn.id);
    assert.equal(npc.name, spawn.name, `${spawn.id} at ${spawn.x},${spawn.y}`);
    if (npc.combatLevel > 0) assert.ok(drops[spawn.id], `${spawn.name} (${spawn.id}) has a drop table`);
  }
  const names = new Set(island.map((spawn) => spawn.name));
  for (const name of ['Cormac', 'Ffion', 'Mortimer', 'Wyrmling', 'Mountain troll', 'Lava Strykewyrm']) assert.ok(names.has(name), name);
  assert.equal(spawns.filter((spawn) => spawn.name === 'Mad Angel').length, 1, 'the Mad Angel is not doubled');
  // Fishing spots stand still like the existing ones; Mortimer and the broken golem have no walk animation.
  for (const spawn of island.filter((entry) => ['Fishing spot', 'Mortimer', 'Broken golem'].includes(entry.name))) {
    assert.equal(spawn.wanderRadius, 0, `${spawn.name} at ${spawn.x},${spawn.y}`);
  }
});
