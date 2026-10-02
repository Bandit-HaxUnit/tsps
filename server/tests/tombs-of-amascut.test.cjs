// Run after `yarn build`: node --test tests/tombs-of-amascut.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const { NpcDefinition } = require('../dist/game/definition/NpcDefinition');
const { NpcIdentifiers: Npcs } = require('../dist/util/NpcIdentifiers');

test("Tombs of Amascut NPCs don't block or die with the player's animations", () => {
  CachePipeline.initialize();
  new NpcDefinitionLoader().load();
  const anims = (id) => [NpcDefinition.forId(id).getDefenceAnim(), NpcDefinition.forId(id).getDeathAnim()];
  // Without their own, they fell back to the player's block (424) and death (836).
  assert.deepEqual(anims(Npcs.ZEBAK_2), [-1, 9634], 'NPC_ZEBAK01_DEATH; Zebak has no block animation');
  assert.deepEqual(anims(Npcs.KEPHRI), [-1, 9582], 'NPC_KEPHRI_DEATH');
  assert.deepEqual(anims(Npcs.BABOON_BRAWLER), [-1, 9755], 'NPC_MANDRILL_DESPAWN02');
  assert.deepEqual(anims(Npcs.SOLDIER_SCARAB), [-1, 9590], 'NPC_SCARAB_DEATH');
  for (let id = 11689; id <= 11804; id++) {
    const definition = NpcDefinition.forId(id);
    if (!definition?.getName?.() || definition.getName() === 'null') continue;
    assert.notEqual(definition.getDefenceAnim(), 424, `${id} ${definition.getName()} blocks like a player`);
    assert.notEqual(definition.getDeathAnim(), 836, `${id} ${definition.getName()} dies like a player`);
  }
});

test('the chest follows the Wiki: unique and pet chances, and the unique weights by raid level', () => {
  const Rewards = require('../plugins/minigames/toa/ToaRewards');
  // 1% per 10,500 - 20 x RL points, RL scaled at 310 (a third) and 430 (a sixth).
  assert.equal(Rewards.uniqueChancePercent(20000, 300).toFixed(2), (20000 / 4500).toFixed(2));
  assert.equal(Rewards.uniqueChancePercent(20000, 430).toFixed(4), (20000 / (10500 - 20 * 350)).toFixed(4));
  assert.equal(Rewards.uniqueChancePercent(90000, 600), Rewards.uniqueChancePercent(64000, 600), 'points capped at 64,000');
  // 1% per 350,000 - 700 x RL points, RL scaled at 400 and 550.
  assert.equal(Rewards.petChancePercent(35000, 0).toFixed(2), '0.10', '35,000 points at raid level 0');
});

test('reward points: a 5,000 start, room points capped and added on completion, and the MVP bonus (Wiki)', () => {
  const { Raid } = require('../plugins/minigames/toa/ToaRaid');
  const a = { name: 'a' };
  const b = { name: 'b' };
  const room = { def: { key: 'CRONDIS_PUZZLE', puzzle: true, path: 'CRONDIS' } };
  const members = new Map([[a, { points: 5000, roomPoints: 0 }], [b, { points: 5000, roomPoints: 0 }]]);
  const raid = Object.assign(Object.create(Raid.prototype), {
    players: [a, b], members, member: (player) => members.get(player), roomFor: () => room,
  });
  raid.addPoints(a, 25000);
  raid.addPoints(b, 1000);
  assert.equal(members.get(a).roomPoints, 20000, 'a room caps at 20,000');
  assert.equal(members.get(a).points, 5000, 'nothing counts until the room is completed');
  raid.completeRoomPoints(room);
  assert.equal(members.get(a).points, 5000 + 20000 + 400 + 300 * 2, 'room points, Crondis completion and the MVP bonus');
  assert.equal(members.get(b).points, 5000 + 1000 + 400);
  assert.equal(raid.lootPoints(a), 20000 + 400 + 600, 'the 5,000 start is taken off for the loot');
});

test('returning from a path lands on free Nexus floor, never inside its doorway', () => {
  const { RegionManager } = require('../dist/game/collision/RegionManager');
  const { Location } = require('../dist/game/model/Location');
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const Shared = require('../plugins/minigames/toa/ToaShared');
  CachePipeline.initialize();
  RegionManager.init();
  Shared.bind({ core: PluginManager.getCoreApi() });
  for (const path of Shared.PATHS) {
    for (let dx = 0; dx <= path.spread; dx++) {
      const tile = new Location(path.back.x + dx, path.back.y, 0);
      assert.ok(Shared.floorFree(null, tile), `${path.name}: (${tile.getX()}, ${tile.getY()}) is blocked`);
    }
  }
});

test('::toaskiptoreward can force a unique and the pet to one player', () => {
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const { ItemIdentifiers: I } = require('../dist/util/ItemIdentifiers');
  const Shared = require('../plugins/minigames/toa/ToaShared');
  const Rewards = require('../plugins/minigames/toa/ToaRewards');
  Shared.bind({ core: PluginManager.getCoreApi() });
  const playerStub = () => {
    const attributes = new Map();
    const empty = { contains: () => false };
    return {
      getAttribute: (key) => attributes.get(key), setAttribute: (key, value) => attributes.set(key, value),
      getInventory: () => empty, getEquipment: () => empty, getBank: () => empty,
    };
  };
  const a = playerStub();
  const b = playerStub();
  // No points at all: without forcing, there would be no purple and no pet.
  const raid = {
    players: [a, b], raidLevel: 0, totalDeaths: 1, lootPoints: () => 0,
    settings: { isActive: () => false },
    forcedLoot: { player: b, unique: I.TUMEKENS_SHADOW_UNCHARGED_, pet: true },
  };
  const { uniqueWinner, uniqueId, petWinner } = Rewards.rollRaidLoot(raid);
  assert.equal(uniqueWinner, b);
  assert.equal(uniqueId, I.TUMEKENS_SHADOW_UNCHARGED_);
  assert.equal(petWinner, b);
  // Wiki: the unique waits in the sarcophagus; the finder's chest has no common rolls.
  const ids = Rewards.lootOf(b).map((entry) => entry.id);
  assert.equal(Rewards.sealedUnique(b), I.TUMEKENS_SHADOW_UNCHARGED_, 'the unique is sealed in the sarcophagus');
  assert.ok(!ids.includes(I.TUMEKENS_SHADOW_UNCHARGED_), 'not in the chest');
  assert.ok(!ids.includes(I.FOSSILISED_DUNG), 'and no fossilised dung in its place');
  assert.ok(ids.includes(I.TUMEKENS_GUARDIAN), 'the pet is in the chest');
  assert.ok(Rewards.hasRewards(b));
  assert.deepEqual(Rewards.lootOf(a).map((entry) => entry.id), [I.FOSSILISED_DUNG]);
  // Opening it (or the lobby chest) moves the unique to the front of the loot.
  assert.equal(Rewards.unsealUnique(b), I.TUMEKENS_SHADOW_UNCHARGED_);
  assert.equal(Rewards.lootOf(b)[0].id, I.TUMEKENS_SHADOW_UNCHARGED_);
  assert.equal(Rewards.sealedUnique(b), -1);
});
