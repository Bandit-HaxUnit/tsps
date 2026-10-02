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
