// Pure state-machine checks; no server, sockets, player login, or smoke-test harness.
// From server/: node -r ts-node/register/transpile-only src/main/typescript/elvarg/game/plugin/impl/farming/FarmingModel.test.ts
import assert = require("node:assert/strict");
import { CACHE, Crop, CROPS, patchKey } from "./FarmingData";
import { Farm, advanceFarm, diseaseChance, emptyPatch, nextGrowth, patchValue, saveLifeChance, MINUTE, advanceTithe, titheDeposit } from "./FarmingModel";

const now = Date.UTC(2026, 8, 30);
for (const key of ["RANARR", "APPLE", "OAK", "WHITE_LILY", "ATTAS", "GRAPE", "CELASTRUS", "SPIRIT_TREE"]) {
    CROPS.set(key, { ...CACHE.timing[key], key, seed: 1, produce: 2, level: 1, plant: 0, harvest: 0,
        check: ["APPLE", "OAK"].includes(key) ? 1 : 0, seedCount: 1, payment: [] } as Crop);
}
const herb = CACHE.patches.find(p => p.type === "HERB" && p.x === 3058);
const tree = CACHE.patches.find(p => p.type === "TREE");
function planted(key = "RANARR", patch = herb): Farm {
    const farm: Farm = { offset: 7 * MINUTE, patches: {}, tools: {}, autoWeed: false };
    farm.patches[patchKey(patch)] = { ...emptyPatch(now, farm), crop: key, nextAt: nextGrowth(now, CROPS.get(key).minutes, farm.offset), compost: 3 };
    return farm;
}
const oneShot = planted();
const stepped = planted();
const persisted = JSON.parse(JSON.stringify(oneShot));
const matureAt = now + 100 * MINUTE;
advanceFarm(oneShot, matureAt, () => 1);
advanceFarm(persisted, matureAt, () => 1);
for (let at = now; at <= matureAt; at += MINUTE) advanceFarm(stepped, at, () => 1);
assert.deepEqual(oneShot, stepped, "offline and online growth must match");
assert.deepEqual(oneShot, persisted, "save/load preserves growth");
const ripe = oneShot.patches[patchKey(herb)];
assert.equal(ripe.status, "grown");
assert.equal(ripe.lives, 6);
assert.ok(Number.isInteger(patchValue(herb, ripe)));
advanceFarm(oneShot, now + 365 * 1440 * MINUTE, () => 0);
assert.equal(ripe.status, "grown", "mature crops cannot become diseased");

const diseased = planted();
const sick = diseased.patches[patchKey(herb)];
advanceFarm(diseased, sick.nextAt, () => 0);
assert.equal(sick.status, "diseased");
const deathAt = sick.nextAt;
advanceFarm(diseased, deathAt - 1, () => 0);
assert.equal(sick.status, "diseased");
advanceFarm(diseased, deathAt, () => 0);
assert.equal(sick.status, "dead");
assert.equal(patchValue(herb, sick), CACHE.states.HERB.ANYHERB.DEAD[sick.stage], "dead herbs use the shared dead-herb variants");
const protectedFarm = planted();
protectedFarm.patches[patchKey(herb)].protected = true;
advanceFarm(protectedFarm, matureAt, () => 0);
assert.equal(protectedFarm.patches[patchKey(herb)].status, "grown");

const oakFarm = planted("OAK", tree);
advanceFarm(oakFarm, now + 200 * MINUTE, () => 1);
const oak = oakFarm.patches[patchKey(tree)];
oak.checked = true;
const fullTree = patchValue(tree, oak);
oak.stump = true;
oak.nextAt = matureAt;
assert.notEqual(patchValue(tree, oak), fullTree);
advanceFarm(oakFarm, matureAt, () => 1);
assert.equal(oak.stump, false);
assert.equal(patchValue(tree, oak), fullTree);
const spirit = CACHE.patches.find(p => p.type === "SPIRIT_TREE");
const spiritState = { ...oak, crop: "SPIRIT_TREE", checked: false };
assert.equal(patchValue(spirit, spiritState), 44, "grown spirit trees must offer Check-health");
spiritState.checked = true;
assert.equal(patchValue(spirit, spiritState), 20, "checked spirit trees must offer Travel");
const vine = CACHE.patches.find(p => p.type === "GRAPES");
const grapes = { ...oak, crop: "GRAPE", checked: true, lives: 5 };
assert.equal(patchValue(vine, grapes), 10, "a checked vine starts with grapes, not a dead vine");
grapes.lives = 1;
assert.equal(patchValue(vine, grapes), 14);
grapes.status = "dead";
assert.equal(patchValue(vine, grapes), 15);
const celastrus = CACHE.patches.find(p => p.type === "CELASTRUS");
assert.equal(patchValue(celastrus, { ...oak, crop: "CELASTRUS", checked: true, lives: 0 }), 17, "empty celastrus trees can be chopped before clearing");

assert.equal(diseaseChance(CROPS.get("RANARR"), 0, false, false), 27 / 128);
assert.equal(diseaseChance(CROPS.get("RANARR"), 3, false, false), 3 / 128);
assert.equal(diseaseChance(CROPS.get("RANARR"), 3, false, true), 1 / 128);
assert.equal(saveLifeChance(CROPS.get("RANARR"), 99), 81 / 256);
assert.equal(saveLifeChance(CROPS.get("RANARR"), 99, true, true), 93 / 256);
assert.equal(nextGrowth(now, 20, 7 * MINUTE) - now, 13 * MINUTE);
assert.equal(CACHE.patches.filter(p => p.type === "HERB").length, 10);
assert.equal(new Set(CACHE.patches.map(patchKey)).size, CACHE.patches.length);
const tithe = { crop: 0, stage: 0, watered: true, dead: false, fertilized: false, nextAt: now + MINUTE };
advanceTithe(tithe, now + MINUTE);
assert.equal(tithe.stage, 1);
advanceTithe(tithe, now + 2 * MINUTE);
assert.equal(tithe.dead, true, "each Tithe growth stage needs watering");
const ripeTithe = { ...tithe, stage: 3, dead: false };
advanceTithe(ripeTithe, now + 100 * MINUTE);
assert.equal(ripeTithe.dead, false, "ripe Tithe fruit does not expire");
for (const xp of [6, 14, 23]) {
    const batch = titheDeposit(0, 100, xp);
    assert.equal(batch.points, 35);
    assert.equal(batch.score, 0);
    assert.equal(batch.xp + batch.bonus + xp * 100, xp * 1610);
    const first = titheDeposit(0, 74, xp), last = titheDeposit(74, 50, xp);
    assert.equal(last.count, 26, "a deposit cannot overflow the sack");
    assert.equal(first.xp + last.xp + last.bonus, batch.xp + batch.bonus);
    assert.equal(first.points + last.points, 35);
}
console.log("Farming state checks passed.");
