// Pure state-machine checks; no server, sockets, player login, or smoke-test harness.
// From server/: node -r ts-node/register/transpile-only plugins/skills/farming/Model.Farming.test.js
// The plugin hands the farming files api.core; outside the server the test does it.
require("../../../src/main/typescript/elvarg/game/World");
const { PluginManager } = require("../../../src/main/typescript/elvarg/plugins/PluginManager");
require("./Core.Farming").init({ core: PluginManager.getCoreApi() });
const Data = require("./Data.Farming");
const Model = require("./Model.Farming");
const assert = require("node:assert/strict");

const now = Date.UTC(2026, 8, 30);
for (const key of ["RANARR", "APPLE", "OAK", "WHITE_LILY", "ATTAS", "GRAPE", "CELASTRUS", "SPIRIT_TREE"]) {
    Data.CROPS.set(key, { ...Data.CACHE.timing[key], key, seed: 1, produce: 2, level: 1, plant: 0, harvest: 0,
        check: ["APPLE", "OAK"].includes(key) ? 1 : 0, seedCount: 1, payment: [] });
}
const herb = Data.CACHE.patches.find(p => p.type === "HERB" && p.x === 3058);
const tree = Data.CACHE.patches.find(p => p.type === "TREE");
function planted(key = "RANARR", patch = herb) {
    const farm = { offset: 7 * Model.MINUTE, patches: {}, tools: {}, autoWeed: false };
    farm.patches[Data.patchKey(patch)] = { ...Model.emptyPatch(now, farm), crop: key, nextAt: Model.nextGrowth(now, Data.CROPS.get(key).minutes, farm.offset), compost: 3 };
    return farm;
}
const oneShot = planted();
const stepped = planted();
const persisted = JSON.parse(JSON.stringify(oneShot));
const matureAt = now + 100 * Model.MINUTE;
Model.advanceFarm(oneShot, matureAt, () => 1);
Model.advanceFarm(persisted, matureAt, () => 1);
for (let at = now; at <= matureAt; at += Model.MINUTE) Model.advanceFarm(stepped, at, () => 1);
assert.deepEqual(oneShot, stepped, "offline and online growth must match");
assert.deepEqual(oneShot, persisted, "save/load preserves growth");
const ripe = oneShot.patches[Data.patchKey(herb)];
assert.equal(ripe.status, "grown");
assert.equal(ripe.lives, 6);
assert.ok(Number.isInteger(Model.patchValue(herb, ripe)));
Model.advanceFarm(oneShot, now + 365 * 1440 * Model.MINUTE, () => 0);
assert.equal(ripe.status, "grown", "mature crops cannot become diseased");

const diseased = planted();
const sick = diseased.patches[Data.patchKey(herb)];
Model.advanceFarm(diseased, sick.nextAt, () => 0);
assert.equal(sick.status, "diseased");
const deathAt = sick.nextAt;
Model.advanceFarm(diseased, deathAt - 1, () => 0);
assert.equal(sick.status, "diseased");
Model.advanceFarm(diseased, deathAt, () => 0);
assert.equal(sick.status, "dead");
assert.equal(Model.patchValue(herb, sick), Data.CACHE.states.HERB.ANYHERB.DEAD[sick.stage], "dead herbs use the shared dead-herb variants");
const protectedFarm = planted();
protectedFarm.patches[Data.patchKey(herb)].protected = true;
Model.advanceFarm(protectedFarm, matureAt, () => 0);
assert.equal(protectedFarm.patches[Data.patchKey(herb)].status, "grown");

const oakFarm = planted("OAK", tree);
Model.advanceFarm(oakFarm, now + 200 * Model.MINUTE, () => 1);
const oak = oakFarm.patches[Data.patchKey(tree)];
oak.checked = true;
const fullTree = Model.patchValue(tree, oak);
oak.stump = true;
oak.nextAt = matureAt;
assert.notEqual(Model.patchValue(tree, oak), fullTree);
Model.advanceFarm(oakFarm, matureAt, () => 1);
assert.equal(oak.stump, false);
assert.equal(Model.patchValue(tree, oak), fullTree);
const spirit = Data.CACHE.patches.find(p => p.type === "SPIRIT_TREE");
const spiritState = { ...oak, crop: "SPIRIT_TREE", checked: false };
assert.equal(Model.patchValue(spirit, spiritState), 44, "grown spirit trees must offer Check-health");
spiritState.checked = true;
assert.equal(Model.patchValue(spirit, spiritState), 20, "checked spirit trees must offer Travel");
const vine = Data.CACHE.patches.find(p => p.type === "GRAPES");
const grapes = { ...oak, crop: "GRAPE", checked: true, lives: 5 };
assert.equal(Model.patchValue(vine, grapes), 10, "a checked vine starts with grapes, not a dead vine");
grapes.lives = 1;
assert.equal(Model.patchValue(vine, grapes), 14);
grapes.status = "dead";
assert.equal(Model.patchValue(vine, grapes), 15);
const celastrus = Data.CACHE.patches.find(p => p.type === "CELASTRUS");
assert.equal(Model.patchValue(celastrus, { ...oak, crop: "CELASTRUS", checked: true, lives: 0 }), 17, "empty celastrus trees can be chopped before clearing");

assert.equal(Model.diseaseChance(Data.CROPS.get("RANARR"), 0, false, false), 27 / 128);
assert.equal(Model.diseaseChance(Data.CROPS.get("RANARR"), 3, false, false), 3 / 128);
assert.equal(Model.diseaseChance(Data.CROPS.get("RANARR"), 3, false, true), 1 / 128);
assert.equal(Model.saveLifeChance(Data.CROPS.get("RANARR"), 99), 81 / 256);
assert.equal(Model.saveLifeChance(Data.CROPS.get("RANARR"), 99, true, true), 93 / 256);
assert.equal(Model.nextGrowth(now, 20, 7 * Model.MINUTE) - now, 13 * Model.MINUTE);
assert.equal(Data.CACHE.patches.filter(p => p.type === "HERB").length, 10);
assert.ok(Data.CACHE.patches.some(p => p.type === "FLOWER" && p.x === 3601 && p.y === 3525), "Port Phasmatys flower patch uses regional weed models");
assert.ok(Data.CACHE.patches.some(p => p.type === "COMPOST" && p.x === 3610 && p.y === 3522), "Port Phasmatys compost bin uses regional models");
assert.equal(Data.CACHE.patches.filter(p => p.type === "REDWOOD").length, 1, "redwood scenery must not become independently plantable patches");
assert.equal(new Set(Data.CACHE.patches.map(Data.patchKey)).size, Data.CACHE.patches.length);
const tithe = { crop: 0, stage: 0, watered: true, dead: false, fertilized: false, nextAt: now + Model.MINUTE };
Model.advanceTithe(tithe, now + Model.MINUTE);
assert.equal(tithe.stage, 1);
Model.advanceTithe(tithe, now + 2 * Model.MINUTE);
assert.equal(tithe.dead, true, "each Tithe growth stage needs watering");
const ripeTithe = { ...tithe, stage: 3, dead: false };
Model.advanceTithe(ripeTithe, now + 100 * Model.MINUTE);
assert.equal(ripeTithe.dead, false, "ripe Tithe fruit does not expire");
for (const xp of [6, 14, 23]) {
    const batch = Model.titheDeposit(0, 100, xp);
    assert.equal(batch.points, 35);
    assert.equal(batch.score, 0);
    assert.equal(batch.xp + batch.bonus + xp * 100, xp * 1610);
    const first = Model.titheDeposit(0, 74, xp), last = Model.titheDeposit(74, 50, xp);
    assert.equal(last.count, 26, "a deposit cannot overflow the sack");
    assert.equal(first.xp + last.xp + last.bonus, batch.xp + batch.bonus);
    assert.equal(first.points + last.points, 35);
}
console.log("Farming state checks passed.");
