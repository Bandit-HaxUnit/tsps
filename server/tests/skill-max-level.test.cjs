// Run after `yarn build`: node --test tests/skill-max-level.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Skill } = require("../dist/game/model/Skill");
const { SkillManager } = require("../dist/game/content/skill/SkillManager");

const sender = new Proxy({}, { get: (_, name) => (name === "then" ? undefined : () => sender) });
const skills = new SkillManager({ getPacketSender: () => sender });

test("lowering a skill takes effect on the first call (issue #101)", () => {
  for (const level of [99, 1]) {
    skills
      .setCurrentLevels(Skill.ATTACK, level)
      .setMaxLevel(Skill.ATTACK, level)
      .setExperience(Skill.ATTACK, SkillManager.getExperienceForLevel(level));
    assert.equal(skills.getMaxLevel(Skill.ATTACK), level);
  }
});

test("Hunter cache data, trap ownership, transactions, cancellation and persisted birdhouses", async () => {
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  const { PluginManager } = require("../dist/plugins/PluginManager");
  await CachePipeline.initialize(require("node:path").resolve(__dirname, ".."));
  const core = PluginManager.getCoreApi(), I = core.ItemIdentifiers;
  const C = require("../plugins/skills/hunter/Context"), { H } = C;
  const Traps = require("../plugins/skills/hunter/Traps");
  const Houses = require("../plugins/skills/hunter/Birdhouses");
  const Tracking = require("../plugins/skills/hunter/Tracking");
  const Catching = require("../plugins/skills/hunter/Catching");
  const Runtime = require("../plugins/skills/hunter/Runtime");
  let startup;
  const hooks = [];
  const api = new Proxy({ core, emitCustomEvent() {}, onServerStartup(handler) { startup = handler; } }, {
    get(target, name) { return target[name] ?? ((...args) => hooks.push([name, ...args])); },
  });
  require("../plugins/skills/Hunter.plugin").register(api);
  startup();
  assert.equal(H.data.creatures.length, 21);
  assert.equal(H.data.implings.length, 12);
  assert.equal(Houses.bases.size, 4);
  assert.ok(hooks.some(hook => hook[0] === "onNpcRoute"));
  for (const rows of Object.values(require("../plugins/skills/hunter/ImplingLoot.json"))) {
    for (const [name, weight, min, max, noted] of rows) {
      assert.ok(Number.isInteger(I[name]), name);
      assert.ok(weight > 0 && min > 0 && max >= min, name);
      if (noted) assert.ok(core.ItemDefinition.forId(I[name]).getNoteId() > 0, name);
    }
  }
  for (const def of Object.values(Tracking.data.creatures)) for (const name of def.loot) assert.ok(Number.isInteger(I[name]), name);

  function player() {
    const counts = new Map(), attrs = new Map(), levels = new Map(), experience = new Map(), configs = new Map();
    let location = new core.Location(3000, 3000, 0), size = 28;
    const slots = () => [...counts].reduce((total, [id, n]) => total + (core.ItemDefinition.forId(id).isStackable() ? 1 : n), 0);
    const inv = {
      capacity: () => size, getFreeSlots: () => size - slots(), full() {},
      getItems: () => [...counts].map(([id, amount]) => new core.Item(id, amount)),
      get: slot => [...counts].map(([id, amount]) => new core.Item(id, amount))[slot],
      getAmount: id => counts.get(id) ?? 0, contains: id => (counts.get(id) ?? 0) > 0,
      adds(id, n) { counts.set(id, (counts.get(id) ?? 0) + n); },
      deleteNumber(id, n) { const next = (counts.get(id) ?? 0) - n; if (next > 0) counts.set(id, next); else counts.delete(id); },
    };
    const skillManager = {
      getCurrentLevel: s => levels.get(s) ?? 99, getMaxLevel: () => 99, stopSkillable() {},
      setCurrentLevels: (s, n) => levels.set(s, n),
      addExperiences: (s, n) => experience.set(s, (experience.get(s) ?? 0) + n),
    };
    return {
      counts, attrs, levels, experience, configs, setSize(n) { size = n; },
      isRegistered: () => true, getHitpoints: () => 99, busy: () => false, getUsername: () => "hunter-test",
      getInventory: () => inv, getSkillManager: () => skillManager,
      getBank: () => ({ contains: () => false }),
      getEquipment: () => ({ getItems: () => [], get: () => new core.Item(-1, 0) }),
      getPrivateArea: () => null, getWildernessLevel: () => 0,
      getLocation: () => location, moveTo(p) { location = p; },
      getAttribute: key => attrs.get(key), setAttribute: (key, value) => attrs.set(key, value),
      getPacketSender: () => ({ sendConfig: (id, value) => configs.set(id, value), sendVarbit() {} }),
      getCombat: () => ({ getTarget: () => null, getAttacker: () => null }),
      getMovementQueue: () => ({ canWalk: () => false }),
      performAnimation() {}, sendMessage() {},
    };
  }
  const p = player(), stranger = player();
  const objects = new Set(), drops = [];
  let npcs = [];
  H.core = { ...core,
    ObjectManager: { register(o) { objects.add(o); }, deregister(o) { objects.delete(o); } },
    MapObjects: { exists: o => objects.has(o), getType: () => null },
    RegionManager: { blocked: () => false },
    ItemOnGroundManager: { registerLocation: (...args) => drops.push(args) },
    World: { getRemovedObjects: () => [], getNearbyNpcsForUpdate: () => npcs },
    PathFinder: { calculateWalkRoute(npc, x, y) { npc.moveTo(new core.Location(x, y, 0)); } },
  };
  const advance = ticks => { for (let i = 0; i < ticks; i++) Runtime.tick(); };
  const random = Math.random;
  Math.random = () => 0;
  try {
    p.counts.set(I.BOX_TRAP, 1);
    p.setSize(1);
    assert.equal(C.exchange(p, [[I.BOX_TRAP, 1]], [[I.BONES, 1], [I.RAW_BIRD_MEAT, 1]]), false);
    assert.equal(p.counts.get(I.BOX_TRAP), 1, "failed exchange preserves materials");
    assert.equal(C.exchange(p, [[I.BOX_TRAP, 1]], [[I.CHINCHOMPA_2, 100]]), true, "stack uses freed slot");
    p.counts.clear(); p.setSize(28); p.counts.set(I.BIRD_SNARE, 1);
    Traps.activate({ player: p, itemId: I.BIRD_SNARE });
    p.moveTo(new core.Location(3001, 3000, 0)); advance(3);
    assert.equal(H.traps.size, 0, "moving cancels before consumption");
    assert.equal(p.counts.get(I.BIRD_SNARE), 1);
    Traps.activate({ player: p, itemId: I.BIRD_SNARE }); advance(3);
    const trap = [...H.traps][0]; assert.ok(trap); assert.equal(p.counts.has(I.BIRD_SNARE), false);
    assert.equal(Traps.limit(p, "box"), 5);
    assert.equal(Traps.limit({ ...p, getWildernessLevel: () => 10 }, "box"), 6);
    assert.equal(Traps.limit(p, "deadfall"), 1);
    p.levels.set(Skill.HUNTER, 19); assert.equal(Traps.limit(p, "bird"), 1);
    p.levels.set(Skill.HUNTER, 20); assert.equal(Traps.limit(p, "bird"), 2, "temporary boosts unlock the next trap");
    p.levels.delete(Skill.HUNTER);
    let npcLocation = trap.location.clone(), visible = true, blocked = false;
    const npc = {
      getId: () => core.NpcIdentifiers.CRIMSON_SWIFT, getPrivateArea: () => null, isRegistered: () => true,
      isVisible: () => visible, setVisible(v) { visible = v; }, isDyingFunction: () => false, getHitpoints: () => 1,
      getLocation: () => npcLocation, moveTo(p) { npcLocation = p; }, getSpawnPosition: () => trap.location.clone(),
      getMovementQueue: () => ({ reset() {}, isMovementBlocked: () => blocked, setBlockMovement(v) { blocked = v; } }),
      getCombat: () => ({ getTarget: () => null, getAttacker: () => null, reset() {} }),
    };
    npcs = [npc]; advance(6);
    assert.equal(trap.state, "caught"); assert.equal(visible, false);
    const object = trap.objects[0];
    Traps.check({ player: stranger, object }); advance(2);
    assert.equal(H.traps.size, 1, "only owner can collect");
    p.setSize(1); Traps.check({ player: p, object }); advance(2);
    assert.equal(H.traps.size, 1, "full inventory preserves catch");
    p.setSize(28); Traps.check({ player: p, object }); advance(2);
    assert.equal(H.traps.size, 0); assert.equal(p.counts.get(I.BIRD_SNARE), 1);
    assert.equal(p.experience.get(Skill.HUNTER), 34);
    Traps.check({ player: p, object }); advance(4);
    assert.equal(p.experience.get(Skill.HUNTER), 34, "stale clicks cannot duplicate XP");
    assert.equal(visible, true, "caught NPC respawns");
    p.counts.set(I.BIRD_SNARE, 2);
    Traps.activate({ player: p, itemId: I.BIRD_SNARE }); advance(3); npcs = []; advance(100);
    assert.equal(H.traps.size, 0); assert.equal(drops.at(-1)[1].getId(), I.BIRD_SNARE);

    const [baseId] = Houses.bases.keys(), houseObject = new core.GameObject(baseId, p.getLocation().clone(), 10, 0, null);
    p.counts.set(I.BIRD_HOUSE, 1); p.counts.set(I.HAMMERSTONE_SEED, 10);
    Houses.use({ player: p, object: houseObject, objectId: baseId, itemId: I.BIRD_HOUSE }); advance(2);
    Houses.seeds({ player: p, object: houseObject });
    const state = p.attrs.get(Houses.ATTRIBUTE)[baseId];
    assert.equal(state.seeds, 10); assert.equal(Houses.status(state), 1);
    Houses.empty({ player: p, object: houseObject }); advance(2);
    assert.equal(p.attrs.get(Houses.ATTRIBUTE)[baseId], state, "timer cannot be bypassed");
    state.filled = Date.now() - Houses.DURATION;
    const restored = JSON.parse(JSON.stringify(p.attrs.get(Houses.ATTRIBUTE)));
    p.attrs.set(Houses.ATTRIBUTE, restored); Houses.login({ player: p });
    assert.equal(p.configs.get(Houses.bases.get(baseId).transformVarp), 3);
    const beforeXp = p.experience.get(Skill.HUNTER);
    Houses.empty({ player: p, object: houseObject }); advance(2);
    assert.equal(p.experience.get(Skill.HUNTER) - beforeXp, 280);
    assert.equal(p.counts.get(I.CLOCKWORK), 1);
    Houses.empty({ player: p, object: houseObject }); advance(2);
    assert.equal(p.counts.get(I.CLOCKWORK), 1, "birdhouse loot only collected once");
    p.counts.clear(); p.counts.set(I.CLOCKWORK, 1);
    p.attrs.get(Houses.ATTRIBUTE)[baseId] = { tier: 0, seeds: 10, filled: Date.now() - Houses.DURATION };
    p.counts.set(I.LOGS, 1); p.counts.set(I.HAMMER, 1); p.counts.set(I.CHISEL, 1);
    Houses.reset({ player: p, object: houseObject }); advance(2);
    assert.equal(p.attrs.get(Houses.ATTRIBUTE)[baseId].seeds, 0, "reset rebuilds an unseeded birdhouse");
    assert.equal(p.counts.get(I.CLOCKWORK), 1, "reset reuses clockwork without creating another");
    assert.equal(p.counts.has(I.LOGS), false);
    assert.equal(p.experience.get(Skill.CRAFTING), 15);
    p.counts.clear(); p.counts.set(I.SNOWY_KNIGHT, 1); p.levels.set(Skill.HITPOINTS, 50);
    Catching.release({ player: p, itemId: I.SNOWY_KNIGHT });
    assert.equal(p.levels.get(Skill.HITPOINTS), 65); assert.equal(p.counts.get(I.BUTTERFLY_JAR), 1);
    p.counts.set(I.LUCKY_IMPLING_JAR, 1);
    Catching.loot({ player: p, itemId: I.LUCKY_IMPLING_JAR });
    assert.equal(p.counts.get(I.LUCKY_IMPLING_JAR), 1, "no treasure-trail integration does not destroy lucky jars");
    const route = { npcId: core.NpcIdentifiers.FISHING_SPOT_12, definition: { getActions: () => ["Catch"] }, clickType: 1, range: 1 };
    Runtime.npcRoute(route); assert.equal(route.range, 9);
    const MagicBoxes = require("../plugins/skills/hunter/MagicBoxes");
    p.counts.clear(); p.counts.set(I.IMP_IN_A_BOX_2_, 1); p.counts.set(I.COINS, 500);
    let transferred = 0;
    H.core.Bank = { ...core.Bank, deposit(player, id, slot, amount) { player.getInventory().deleteNumber(id, amount); transferred += amount; } };
    const bankEvent = { player: p, usedItemId: I.IMP_IN_A_BOX_2_, usedWithItemId: I.COINS };
    MagicBoxes.use(bankEvent);
    assert.equal(transferred, 500); assert.equal(p.counts.get(I.IMP_IN_A_BOX_1_), 1);
    p.counts.set(I.COINS, 100); H.core.Bank.deposit = () => {};
    MagicBoxes.use({ ...bankEvent, usedItemId: I.IMP_IN_A_BOX_1_ });
    assert.equal(p.counts.get(I.IMP_IN_A_BOX_1_), 1, "failed banking does not spend a charge");
    const pluginApi = PluginManager.createApi("hunter-route-check");
    pluginApi.onNpcRoute(event => { event.range = Infinity; });
    const checkedRoute = { player: p, npc, range: 1 };
    PluginManager.emitNpcRoute(checkedRoute); assert.equal(checkedRoute.range, 1, "invalid hook ranges are rejected centrally");
    const { MovementQueue } = require("../dist/game/model/movement/MovementQueue");
    const originals = { projectile: core.RegionManager.canProjectileAttack, entityRoute: core.PathFinder.calculateEntityRoute,
      reached: core.PathFinder.reachedEntity, submit: core.TaskManager.submit };
    let completed = 0, queued = 0;
    const queue = { player: { ...p, getIndex: () => 1, setMobileInteraction() {} }, getMobility: () => ({ canMove: () => true }),
      checkDestination: () => true, reset() {}, walkToReset() {}, isInteractionTargetValid: () => true,
      canInteractWithUnreachableNpc: () => false };
    try {
      core.PathFinder.reachedEntity = () => false;
      core.PathFinder.calculateEntityRoute = () => {};
      core.TaskManager.submit = () => queued++;
      core.RegionManager.canProjectileAttack = () => true;
      MovementQueue.prototype.walkToEntity.call(queue, npc, () => completed++, 9);
      assert.equal(completed, 1, "a ranged option resolves before trying to walk into water");
      core.RegionManager.canProjectileAttack = () => false;
      MovementQueue.prototype.walkToEntity.call(queue, npc, () => completed++, 9);
      assert.equal(completed, 1, "ranged options cannot resolve through projectile clipping");
      assert.equal(queued, 1, "blocked ranged interaction keeps the approach task");
    } finally {
      core.RegionManager.canProjectileAttack = originals.projectile; core.PathFinder.calculateEntityRoute = originals.entityRoute;
      core.PathFinder.reachedEntity = originals.reached; core.TaskManager.submit = originals.submit;
    }
  } finally {
    Math.random = random;
    Runtime.shutdown(); H.core = core; H.players.clear(); H.reserved.clear(); H.actions.clear(); H.hidden.clear();
  }
});
