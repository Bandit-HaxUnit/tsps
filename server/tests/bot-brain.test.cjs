// Run after `yarn build`: node --test tests/bot-brain.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { BotBrain } = require('../plugins/bots/brain/BotBrain');
const {
  buildPvpSeekIndex,
  nearby,
  activeTargetCount,
  hotspotFightCount,
  trackEngagement,
} = require('../plugins/bots/brain/pvp/PvpSeekIndex');

const fakePlayer = (name = 'bot', x = 3100, y = 3600) => ({
  getUsername: () => name,
  getForceMovement: () => null,
  getMovementQueue: () => ({ size: () => 0 }),
  getLocation: () => ({ getX: () => x, getY: () => y, getZ: () => 0 }),
});

/** Registry stub that counts capacity slots and records cooldown blocks. */
function fakeRegistry(next = []) {
  const slots = new Map();
  const blocked = [];
  return {
    slots,
    blocked,
    occupy: (a) => slots.set(a.id, (slots.get(a.id) ?? 0) + 1),
    release: (a) => slots.set(a.id, (slots.get(a.id) ?? 0) - 1),
    blockActivity: (_, id) => blocked.push(id),
    pickActivity: () => next.shift() ?? null,
    resolversFor: (req) => req.resolvers ?? [],
  };
}

const action = (id, results) => ({ id, update: () => results.shift() ?? 'running' });
const tickN = (brain, n) => { for (let i = 0; i < n; i++) brain.tick(i); };

test('unmet setup pushes a resolver; the parent resumes once it succeeds', () => {
  let hasAxe = false;
  const resolver = {
    id: 'withdraw_axe', resolver: true,
    actions: [{ id: 'bank', update: () => { hasAxe = true; return 'success'; } }],
  };
  const chop = action('chop', []);
  const activity = {
    id: 'woodcutting', mode: 'woodcutting', repeat: true,
    setup: [{ id: 'axe', check: () => hasAxe, resolvers: [resolver] }],
    actions: [chop],
  };
  const registry = fakeRegistry();
  const state = { mode: 'roaming' };
  const brain = new BotBrain({ player: fakePlayer(), state, registry, activity });
  brain.tick(0);
  assert.equal(brain.frames.at(-1).behaviour.id, 'withdraw_axe');
  tickN(brain, 4);
  assert.equal(brain.frames.length, 1);
  assert.equal(brain.frames[0].action().id, 'chop');
  assert.equal(state.mode, 'woodcutting');
  assert.equal(registry.slots.get('woodcutting'), 1, 'resolvers take no capacity slot');
});

test('a failed activity is blocked, releases its slot and the brain picks the next one', () => {
  const roam = { id: 'roam', mode: 'roaming', actions: [action('wander', [])] };
  const registry = fakeRegistry([roam]);
  const activity = { id: 'mining', mode: 'mining', actions: [action('mine', ['failed'])] };
  const brain = new BotBrain({ player: fakePlayer(), state: {}, registry, activity });
  tickN(brain, 3);
  assert.deepEqual(registry.blocked, ['mining']);
  assert.equal(registry.slots.get('mining'), 0);
  assert.equal(brain.frames[0].behaviour.id, 'roam');
});

for (const outcome of ['success', 'failed']) {
  test(`an overlay hands state.mode back to its parent on ${outcome}`, () => {
    const state = {};
    const registry = fakeRegistry();
    const parent = { id: 'roam', mode: 'roaming', repeat: true, actions: [action('wander', [])] };
    const brain = new BotBrain({ player: fakePlayer(), state, registry, activity: parent });
    brain.tick(0);
    brain.pushActivity({ id: 'pvp_engage', mode: 'pvp', actions: [action('fight', [outcome])] }, 1);
    assert.equal(state.mode, 'pvp');
    tickN(brain, 3);
    assert.equal(state.mode, 'roaming');
    assert.equal(brain.frames.length, 1);
    assert.equal(registry.slots.get('pvp_engage'), 0);
  });
}

test('an exhausted ephemeral brain calls onExhausted instead of picking work', () => {
  let exhausted = 0;
  const registry = fakeRegistry([{ id: 'roam', actions: [action('wander', [])] }]);
  const brain = new BotBrain({
    player: fakePlayer(), state: {}, registry, ephemeral: true,
    onExhausted: () => exhausted++,
    activity: { id: 'bank_trip', actions: [action('bank', ['success'])] },
  });
  tickN(brain, 3);
  assert.equal(exhausted, 1);
  assert.equal(brain.frames.length, 0);
});

test('reset releases every frame slot, not just the top one', () => {
  const registry = fakeRegistry();
  const brain = new BotBrain({
    player: fakePlayer(), state: {}, registry,
    activity: { id: 'roam', actions: [action('wander', [])] },
  });
  brain.pushActivity({ id: 'pvp_engage', actions: [action('fight', [])] }, 0);
  brain.reset();
  assert.equal(registry.slots.get('roam'), 0);
  assert.equal(registry.slots.get('pvp_engage'), 0);
});

test('pvp seek index buckets nearby bots and tracks target caps within a tick', () => {
  const a = fakePlayer('a', 3100, 3600);
  const b = fakePlayer('b', 3105, 3600);
  const far = fakePlayer('far', 3300, 3900);
  const entries = [
    { player: a, state: { mode: 'pvp', pvp: {} } },
    { player: b, state: { mode: 'pvp', pvp: { targetUsername: 'victim', hotspotId: 'edge', phase: 'combat' } } },
    { player: far, state: { mode: 'pvp', pvp: {} } },
  ];
  const index = buildPvpSeekIndex({
    entries,
    world: { getPlayers: () => [] },
    pvpMode: 'pvp',
    isInCombat: () => true,
  });
  const near = nearby(index.botBuckets, a, 16).map((entry) => entry.player.getUsername());
  assert.deepEqual(near.sort(), ['a', 'b']);
  assert.equal(index.entryByPlayer.get(a), entries[0]);
  assert.equal(activeTargetCount(index, 'victim'), 1);
  assert.equal(activeTargetCount(index, 'victim', 'b'), 0, 'a bot does not count against itself');
  trackEngagement(index, a, { pvp: { hotspotId: 'edge' } }, 'victim');
  assert.equal(activeTargetCount(index, 'victim'), 2);
  assert.equal(hotspotFightCount(index, 'edge'), 1);
});

test('an unreachable object is avoided by every bot until it expires', () => {
  const { isAvoided, UNREACHABLE_UNTIL } = require('../plugins/bots/brain/actions/InteractObject');
  UNREACHABLE_UNTIL.set('1278:3230:3279:0', 1000);
  assert.equal(isAvoided('1278:3230:3279:0', 999), true);
  assert.equal(isAvoided('1278:3230:3279:0', 1000), false, 'expired entries are retried');
  assert.equal(UNREACHABLE_UNTIL.has('1278:3230:3279:0'), false);
});

const { createPvpCombatAction } = require('../plugins/bots/brain/actions/PvpCombat');
const { PvpController } = require('../plugins/bots/brain/pvp/PvpController');
const { Location } = require('../dist/game/model/Location');
const { peekMovementRequest, clearMovementRequest } = require('../plugins/bots/behaviours/navigation/BotNavigation');
const { __testing: loadoutTesting } = require('../plugins/bots/behaviours/policies/PvpLoadoutPolicy');
const { getWildernessHotspot } = require('../plugins/bots/behaviours/pvp/WildernessHotspotRegistry');
const { SkillManager } = require('../dist/game/content/skill/SkillManager');

test('unmatched pvp bots walk between seek retries; overlays return to their activity', () => {
  const calls = [];
  const controller = {
    tick: () => calls.push('fight'), ensureLoadout() {},
    seek: () => calls.push('seek'), wanderWhileSeeking: () => calls.push('walk'),
  };
  const ctx = { nowMs: 10, player: { getHitpoints: () => 99 }, state: { pvp: { nextActionAt: 100 } } };
  createPvpCombatAction({}, controller).update(ctx);
  assert.deepEqual(calls, ['walk']);
  calls.length = 0;
  assert.equal(createPvpCombatAction({ exitWhenIdle: true }, controller).update(ctx), 'success');
  assert.deepEqual(calls, []);
  ctx.player.getCombat = () => ({ getTarget: () => ({ getHitpoints: () => 99 }) });
  createPvpCombatAction({}, controller).update(ctx);
  assert.deepEqual(calls, ['fight']);
});

test('idle pvp walking stays inside its hotspot and pauses for movement or combat', () => {
  const player = { ...fakePlayer('wander', 3085, 3528), getLocation: () => new Location(3085, 3528, 0) };
  const state = { autonomy: { allowedAutonomousModes: ['pvp'] }, pvp: { hotspotId: 'edge_ditch' },
    roaming: { nextWalkAt: 0, roamBounds: getWildernessHotspot('edge_ditch').area } };
  const controller = Object.create(PvpController.prototype);
  controller.api = { getRegionManager: () => ({ blocked: () => false, isWater: () => false }) };
  controller.getEntries = () => [];
  controller.wanderWhileSeeking({ player, state, nowMs: 100 });
  const request = peekMovementRequest(player);
  assert.ok(request);
  assert.ok(request.x >= 3078 && request.x <= 3091 && request.y >= 3525 && request.y <= 3535);
  assert.notDeepEqual([request.x, request.y], [3085, 3528]);
  assert.ok(state.roaming.nextWalkAt >= 3600);
  clearMovementRequest(player);
  assert.equal(controller.wanderWhileSeeking({ player, state, nowMs: 101 }), false);
  player.getCombat = () => ({ getAttacker: () => ({}) });
  assert.equal(controller.wanderWhileSeeking({ player, state, nowMs: 20000 }), false);
  assert.equal(peekMovementRequest(player), null);
});

test('Edgeville generated and global presets remain within narrow combat bands', () => {
  for (const hotspotId of ['edge_ditch', 'edge_south']) {
    const hotspot = getWildernessHotspot(hotspotId);
    const band = hotspot.combatLevelRange;
    for (const profileId of hotspot.allowedProfiles) {
      for (const loadoutId of hotspot.allowedLoadouts) {
        for (let i = 0; i < 5; i++) {
          const state = { pvp: { hotspotId, loadoutId, profileId, presetPoolEnabled: true } };
          const generated = loadoutTesting.buildGeneratedPreset(null, state);
          assert.ok(generated, `${hotspotId}/${profileId}/${loadoutId}`);
          const stats = generated.preset.getStats();
          const level = SkillManager.prototype.getCombatLevel.call({ skills: { maxLevel: stats } });
          assert.ok(level >= band.min && level <= band.max, `${generated.archetypeId}: ${level}`);
        }
      }
    }
  }
});

const fs = require('node:fs');
const { createTrainCombatAction } = require('../plugins/bots/brain/actions/TrainCombat');
const { Skill } = require('../dist/game/model/Skill');
const { Equipment } = require('../dist/game/model/container/impl/Equipment');
const { ItemIdentifiers } = require('../dist/util/ItemIdentifiers');
const { FightStyle } = require('../dist/game/content/combat/FightStyle');
const { Flag } = require('../dist/game/model/Flag');
const trainingSpec = JSON.parse(fs.readFileSync('data/definitions/bot-activities.json', 'utf8'))
  .activities.find((a) => a.id === 'combat_training').actions[0];

function trainingScene(level = 1) {
  let target = null, owner = null, hp = 10, npcHp = 3, registered = true;
  let location = new Location(3230, 3298, 0), permission = true;
  const levels = Array(24).fill(level), items = [], inventory = new Map();
  const attacks = [], changes = [], logs = [], xp = [];
  const styles = [FightStyle.ACCURATE, FightStyle.AGGRESSIVE, FightStyle.DEFENSIVE]
    .map((style, index) => ({ getStyle: () => style, getChildId: () => index }));
  class TrainingItem {
    constructor(id) { this.id = id; }
    getId() { return this.id; }
    getDefinition() { return { getRequirements: () => [] }; }
  }
  const npc = {
    isNpc: () => true, isRegistered: () => registered, isDyingFunction: () => false,
    getHitpoints: () => npcHp, getPrivateArea: () => null,
    getLocation: () => new Location(3230, 3298, 0),
    getCurrentDefinition: () => ({ isAttackable: () => true, getName: () => 'Chicken' }),
    getCombat: () => ({ getTarget: () => owner, getAttacker: () => owner }),
  };
  const player = {
    ...fakePlayer('trainee'), getLocation: () => location, getPrivateArea: () => null,
    isRegistered: () => true, getHitpoints: () => hp, isDyingReturn: () => false,
    getCombat: () => ({ getTarget: () => target, getAttacker: () => null,
      attack: (n) => { target = n; attacks.push(n); }, reset: () => { target = null; } }),
    getSkillManager: () => ({ getMaxLevel: (s) => levels[s.getIndex()],
      getCurrentLevel: (s) => levels[s.getIndex()], addExperience: (...args) => xp.push(args) }),
    getEquipment: () => ({ getItems: () => items, set: (slot, item) => { items[slot] = item; }, refreshItems() {} }),
    getInventory: () => ({ getAmount: (id) => inventory.get(id) ?? 0,
      adds: (id, amount) => inventory.set(id, (inventory.get(id) ?? 0) + amount) }),
    getWeapon: () => ({ getFightType: () => styles }), getUpdateFlag: () => ({ flag() {} }),
    setCombatFollowing() {},
  };
  const world = {
    core: { Skill, Equipment, Item: TrainingItem, ItemIdentifiers, Flag, FightStyle,
      World: { getNearbyNpcsForUpdate: () => [npc] },
      WorldDefinition: { isMembersArea: () => false },
      CombatFactory: { getMethod: () => ({}), canAttackPermission: () => permission ? 'yes' : 'no' },
      CanAttackResponse: { CAN_ATTACK: 'yes' },
      WeaponInterfaceManager: { assign() {}, changeCombatStyle: (_, slot) => changes.push(slot) },
    },
    refreshEquipment() {}, regionManager: { loadMapFiles() {} }, log: (_, d) => logs.push(d),
  };
  const ctx = { player, state: {}, nowMs: 1000 };
  return { player, npc, world, ctx, attacks, changes, items, levels, logs, inventory, xp,
    kill: () => { npcHp = 0; }, die: () => { hp = 0; }, revive: () => { hp = 10; },
    occupy: () => { owner = {}; }, deny: () => { permission = false; },
    unregister: () => { registered = false; },
    move: (x, y) => { location = new Location(x, y, 0); },
  };
}

test('combat trainers start on chickens, provision bronze gear and use normal NPC attacks', () => {
  const s = trainingScene(), a = createTrainCombatAction(trainingSpec, s.world);
  a.update(s.ctx);
  assert.equal(s.logs[0].stage, 'chickens');
  assert.deepEqual(s.attacks, [s.npc]);
  assert.equal(s.items[Equipment.WEAPON_SLOT].getId(), ItemIdentifiers.BRONZE_SCIMITAR);
  assert.equal(s.inventory.get(ItemIdentifiers.TROUT), 16);
  assert.equal(s.changes[0], 0);
  s.ctx.nowMs += 600; a.update(s.ctx);
  assert.equal(s.attacks.length, 1, 'do not restart a fight every tick');
  assert.deepEqual(s.xp, [], 'no artificial XP');
  a.stop(s.ctx);
});

test('training balances melee skills and upgrades weapons and armour independently', () => {
  const s = trainingScene(5);
  s.levels[Skill.ATTACK.getIndex()] = 20;
  s.levels[Skill.DEFENCE.getIndex()] = 10;
  const a = createTrainCombatAction(trainingSpec, s.world); a.update(s.ctx);
  assert.equal(s.items[Equipment.WEAPON_SLOT].getId(), ItemIdentifiers.MITHRIL_SCIMITAR);
  assert.equal(s.items[Equipment.BODY_SLOT].getId(), ItemIdentifiers.BLACK_PLATEBODY);
  assert.equal(s.changes[0], 1, 'train lowest skill: Strength');
  assert.equal(s.logs[0].stage, 'chickens', 'high Attack alone does not promote fragile bots');
  a.stop(s.ctx);
});

test('trainers finish fights before level promotion or ending a timed session', () => {
  const s = trainingScene();
  const a = createTrainCombatAction({ ...trainingSpec, durationSeconds: { min: 1, max: 1 } }, s.world);
  a.update(s.ctx); s.levels.fill(10); s.ctx.nowMs = 5000;
  assert.equal(a.update(s.ctx), 'running');
  s.kill(); assert.equal(a.update(s.ctx), 'success'); a.stop(s.ctx);
  s.ctx.nowMs = 6000; a.update(s.ctx);
  assert.equal(s.logs.at(-1).stage, 'livestock_and_goblins');
  a.stop(s.ctx);
});

test('higher training tiers select monks/barbarians and guards and walk from home', () => {
  for (const [level, stage] of [[20, 'monks_and_barbarians'], [40, 'guards']]) {
    const s = trainingScene(level); s.move(3089, 3524);
    const a = createTrainCombatAction(trainingSpec, s.world); a.update(s.ctx);
    assert.equal(s.logs[0].stage, stage);
    assert.equal(s.attacks.length, 0);
    assert.equal(peekMovementRequest(s.player).reason, 'brain_combat_training');
    a.stop(s.ctx);
  }
});

test('NPC training skips occupied, forbidden, dead and unregistered targets', () => {
  for (const setup of ['occupy', 'deny', 'kill', 'unregister']) {
    const s = trainingScene(); s[setup]();
    const a = createTrainCombatAction(trainingSpec, s.world); a.update(s.ctx);
    assert.equal(s.attacks.length, 0, setup); a.stop(s.ctx);
  }
});

test('NPC reservations prevent simultaneous claims, and stop releases them', () => {
  const first = trainingScene(), second = trainingScene();
  second.world.core.World.getNearbyNpcsForUpdate = () => [first.npc];
  const a = createTrainCombatAction(trainingSpec, first.world);
  const b = createTrainCombatAction(trainingSpec, second.world);
  a.update(first.ctx); b.update(second.ctx);
  assert.equal(second.attacks.length, 0);
  a.stop(first.ctx); second.ctx.nowMs += 2000; b.update(second.ctx);
  assert.deepEqual(second.attacks, [first.npc]); b.stop(second.ctx);
});

test('stalled targets are abandoned and death resets the training destination', () => {
  const s = trainingScene(), a = createTrainCombatAction(trainingSpec, s.world); a.update(s.ctx);
  s.ctx.nowMs += 46000; a.update(s.ctx);
  assert.equal(s.player.getCombat().getTarget(), null);
  assert.equal(s.attacks.length, 1);
  s.die(); a.update(s.ctx); s.revive(); s.ctx.nowMs += 2000; a.update(s.ctx);
  assert.equal(s.logs.length, 2); a.stop(s.ctx);
});

test('configured training sites contain matching canonical NPC spawns', () => {
  const spawns = JSON.parse(fs.readFileSync('data/definitions/npc-spawns.json', 'utf8'));
  for (const stage of trainingSpec.stages) {
    for (const site of stage.sites) {
      assert.ok(spawns.some((n) => site.names.includes(n.name) && n.level === site.area.z &&
        n.x >= site.area.minX && n.x <= site.area.maxX && n.y >= site.area.minY && n.y <= site.area.maxY), site.id);
    }
  }
});

test('replacing a training brain stops its NPC fight and releases its claim', () => {
  const s = trainingScene();
  const a = createTrainCombatAction(trainingSpec, s.world);
  const activity = { id: 'train', actions: [a], repeat: true };
  const brain = new BotBrain({ player: s.player, state: s.ctx.state, world: s.world,
    registry: fakeRegistry(), activity });
  brain.tick(1000); brain.tick(1600);
  assert.equal(s.player.getCombat().getTarget(), s.npc);
  brain.reset();
  assert.equal(s.player.getCombat().getTarget(), null);
  assert.equal(peekMovementRequest(s.player), null);
});

test('combat-training activity compiles against the real plugin core API', () => {
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const { createBotActivityRegistry } = require('../plugins/bots/brain/BotActivityRegistry');
  const registry = createBotActivityRegistry({ world: { core: PluginManager.getCoreApi() } });
  assert.equal(registry.byId.get('combat_training').actions[0].id, 'trainCombat');
});

test('timed visits rotate between sites without requiring a level-up', () => {
  const s = trainingScene(10);
  const a = createTrainCombatAction({ ...trainingSpec, durationSeconds: { min: 1, max: 1 } }, s.world);
  a.update(s.ctx);
  const firstSite = s.logs[0].site;
  s.ctx.nowMs += 1500;
  assert.equal(a.update(s.ctx), 'success');
  a.stop(s.ctx); a.update(s.ctx);
  assert.notEqual(s.logs.at(-1).site, firstSite);
  a.stop(s.ctx);
});

test('NPC trainers do not cross private areas or attack a non-attackable NPC', () => {
  for (const kind of ['instance', 'noncombat']) {
    const s = trainingScene();
    if (kind === 'instance') s.npc.getPrivateArea = () => ({});
    else s.npc.getCurrentDefinition = () => ({ isAttackable: () => false, getName: () => 'Chicken' });
    const a = createTrainCombatAction(trainingSpec, s.world); a.update(s.ctx);
    assert.equal(s.attacks.length, 0);
    a.stop(s.ctx);
  }
});
