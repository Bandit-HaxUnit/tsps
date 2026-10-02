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


// Exercise native feedback and the real plugin actions without a client or game loop.
function feedbackPlayer(core) {
  const counts = new Map(), sent = [], animations = [], attrs = new Map();
  let location = new core.Location(3000, 3000, 0), menu, chatbox = -1;
  const inventory = {
    get: slot => [...counts].map(([id, n]) => new core.Item(id, n))[slot],
    contains: id => (counts.get(id) ?? 0) > 0, getAmount: id => counts.get(id) ?? 0,
    deleteNumber(id, n) { const remaining = (counts.get(id) ?? 0) - n; if (remaining > 0) counts.set(id, remaining); else counts.delete(id); },
    deleteAtSlot(slot, n) { this.deleteNumber(this.get(slot).getId(), n); },
    addItem(item) { counts.set(item.getId(), (counts.get(item.getId()) ?? 0) + item.getAmount()); },
    isFull: () => false, getFreeSlots: () => 28,
  };
  const sender = new Proxy({
    sendCreationMenu(value) { menu = value; return sender; },
    sendChatboxInterface(id) { chatbox = id; sent.push(["chatbox", id]); return sender; },
    isChatboxInterface: id => chatbox === id,
    closeInterface(id) { if (chatbox === id) chatbox = -1; return sender; },
  }, { get: (target, key) => target[key] ?? ((...args) => { sent.push([key, ...args]); return sender; }) });
  const p = {
    counts, sent, animations, inventory, menu: () => menu,
    getLocation: () => location, moveTo(value) { location = value; },
    getInventory: () => inventory, getPacketSender: () => sender,
    getMovementQueue: () => ({ size: () => 0 }), getForceMovement: () => null,
    isRegistered: () => true, getHitpoints: () => 99,
    getUsername: () => "feedback-test", isPlayerBot: () => false,
    performAnimation: a => animations.push(a.getId()), performGraphic() {}, sendMessage() {},
    getClickDelay: () => ({ elapsedTime: () => true, reset() {} }),
    getSkill: () => null, setSkill() {}, setCreationMenu() {}, experienceLockedReturn: () => false,
    getUpdateFlag: () => ({ flag() {} }),
    getAttribute: k => attrs.get(k), setAttribute: (k, v) => attrs.set(k, v),
    getSkillManager: () => p.skills,
  };
  p.skills = new SkillManager(p);
  return p;
}

function registerFeedbackPlugin(name, core, extra = {}) {
  const hooks = {};
  const api = new Proxy({ core, log() {}, ...extra }, {
    get: (target, key) => target[key] ?? ((...args) => { hooks[key] = args.find(arg => typeof arg === "function"); }),
  });
  require(`../plugins/${name}.plugin`).register(api);
  return hooks;
}

test("every skill gets native level-up text, its own model, stats before hooks, and a working Continue", () => {
  const { PluginManager } = require("../dist/plugins/PluginManager");
  const core = PluginManager.getCoreApi();
  const hooks = registerFeedbackPlugin("interface/SkillLevelUp", core);
  const emit = PluginManager.emitPlayerLevelUp;
  PluginManager.emitPlayerLevelUp = event => {
    assert.equal(event.player.skills.getCurrentLevel(event.skill), event.newLevel);
    assert.ok(event.player.sent.some(([type, s]) => type === "sendSkill" && s === event.skill));
    hooks.onPlayerLevelUp(event);
  };
  const layers = [6, 17, 49, 30, 40, 38, 34, 12, 53, 25, 23, 21, 14, 47, 36, 28, 4, 51, 45, 19, 43, 9, 32, 57];
  try {
    for (const skill of Skill.values()) {
      const p = feedbackPlayer(core);
      p.skills.setCurrentLevels(skill, 1, false).setMaxLevel(skill, 1, false).setExperience(skill, 0);
      p.sent.length = 0;
      p.skills.addExperience(skill, SkillManager.getExperienceForLevel(2), false);
      assert.ok(p.sent.some(([type, id]) => type === "chatbox" && id === 233), skill.getName());
      assert.ok(p.sent.some(([type, text, id]) => type === "sendString" && id === ((233 << 16) | 2) && text.includes("2")));
      assert.deepEqual(p.sent.filter(([type, , hidden]) => type === "sendInterfaceDisplayState" && !hidden),
        [["sendInterfaceDisplayState", (233 << 16) | layers[skill.getIndex()], false]]);
      assert.equal(p.sent.filter(([type]) => type === "sendSkill").length, 1, "one stats update for the resolving tick");
      assert.equal(p.animations.at(-1), 65535);
      assert.equal(hooks.onInterfaceActionButton({ player: p }), true);
      assert.equal(p.getPacketSender().isChatboxInterface(233), false);
      assert.equal(hooks.onInterfaceActionButton({ player: p }), false, "stale continue does not close another dialog");
    }
  } finally { PluginManager.emitPlayerLevelUp = emit; }
});

test("burying resolves inventory and XP together on tick two; movement, logout and cancellation preserve the bone", () => {
  const { PluginManager } = require("../dist/plugins/PluginManager");
  const core = PluginManager.getCoreApi(), tasks = [];
  const hooks = registerFeedbackPlugin("skills/Prayer", core, {
    getTaskManager: () => ({ submit(task) { task.setRunning(true); tasks.push(task); } }),
  });
  for (const mode of ["complete", "walk-before-resolve", "logout", "cancel"]) {
    const p = feedbackPlayer(core);
    p.counts.set(core.ItemIdentifiers.BONES, 1);
    let xp = 0;
    p.skills = { stopSkillable() {}, addExperiences(s, n) { assert.equal(s, Skill.PRAYER); xp += n; } };
    assert.equal(hooks.onItemFirstAction({ player: p, itemId: core.ItemIdentifiers.BONES, slot: 0 }), true);
    const task = tasks.pop();
    assert.equal(task.key, p, "logout cancels tasks by player identity");
    assert.equal(p.counts.get(core.ItemIdentifiers.BONES), 1);
    task.tick();
    if (mode === "walk-before-resolve") p.moveTo(new core.Location(3001, 3000, 0));
    if (mode === "logout") p.isRegistered = () => false;
    if (mode === "cancel") task.stop();
    task.tick();
    assert.equal(xp > 0, mode === "complete", mode);
    assert.equal(p.counts.has(core.ItemIdentifiers.BONES), mode !== "complete", mode);
    assert.equal(task.isRunning(), false);
  }
});

test("Fletching cancels while waiting after movement and never restarts its animation after a level-up", () => {
  const { PluginManager } = require("../dist/plugins/PluginManager");
  const core = PluginManager.getCoreApi(), tasks = [];
  const hooks = registerFeedbackPlugin("skills/Fletching", core, {
    getTaskManager: () => ({ submit: task => tasks.push(task) }),
  });
  const feedback = registerFeedbackPlugin("interface/SkillLevelUp", core);
  for (const mode of ["walk", "level-up"]) {
    const p = feedbackPlayer(core);
    let xp = 0;
    p.skills = { getCurrentLevel: () => 99, addExperiences() {
      xp++;
      hooks.onPlayerLevelUp({ player: p });
      feedback.onPlayerLevelUp({ player: p, skill: Skill.FLETCHING, newLevel: 2 });
    } };
    p.counts.set(core.ItemIdentifiers.KNIFE, 1); p.counts.set(core.ItemIdentifiers.LOGS, 2);
    hooks.onItemOnItem({ player: p, usedItemId: core.ItemIdentifiers.KNIFE, usedWithItemId: core.ItemIdentifiers.LOGS });
    const menu = p.menu(); assert.ok(menu);
    menu.execute(menu.getItems()[0], 2);
    if (mode === "walk") p.moveTo(new core.Location(3001, 3000, 0));
    for (let n = 0; n < 7; n++) tasks[0].execute();
    assert.equal(xp, mode === "walk" ? 0 : 1);
    assert.equal(p.counts.get(core.ItemIdentifiers.LOGS), mode === "walk" ? 2 : 1);
    assert.equal(p.animations.at(-1), 65535);
    assert.equal(p.sent.some(([type]) => type === "sendSoundEffect"), false, "animation frames supply the audio");
  }
});

test("native autocast indicators clear on staff removal while remembering the default", () => {
  const { Autocasting } = require("../dist/game/content/combat/magic/Autocasting");
  const { CombatSpells } = require("../dist/game/content/combat/magic/CombatSpells");
  const { BonusManager } = require("../dist/game/model/equipment/BonusManager");
  const { WeaponInterfaceManager } = require("../dist/game/content/combat/WeaponInterfaceManager");
  const { CombatSpecial } = require("../dist/game/content/combat/CombatSpecial");
  const { Item } = require("../dist/game/model/Item");
  const update = BonusManager.update, assign = CombatSpecial.assign, bar = CombatSpecial.updateBar;
  BonusManager.update = CombatSpecial.assign = CombatSpecial.updateBar = () => {};
  try {
    let staff = true, selected = null, fightType = null;
    const varbits = new Map();
    const sender = new Proxy({ sendVarbit(id, n) { varbits.set(id, n); return sender; } }, { get: (t, key) => t[key] ?? (() => sender) });
    const p = { getCombat: () => ({ getAutocastSpell: () => selected, setAutocastSpell: s => { selected = s; } }),
      getEquipment: () => ({ hasStaffEquipped: () => staff, getItems: () => new Array(14).fill(new Item(-1, 0)) }),
      getPacketSender: () => sender, getFightType: () => fightType, setFightType: type => { fightType = type; },
      setWeapon() {}, autoRetaliateReturn: () => false, sendMessage() {} };
    Autocasting.setAutocast(p, CombatSpells.WIND_STRIKE);
    assert.equal(varbits.get(275), 1); assert.equal(varbits.get(276), 1);
    staff = false; WeaponInterfaceManager.assign(p);
    assert.equal(selected, CombatSpells.WIND_STRIKE);
    for (const id of [275, 276, 2668]) assert.equal(varbits.get(id), 0);
    staff = true; Autocasting.setAutocast(p, selected);
    assert.equal(varbits.get(275), 1);
  } finally { BonusManager.update = update; CombatSpecial.assign = assign; CombatSpecial.updateBar = bar; }
});


test("client feedback IDs and per-gem animations exist in the active OSRS cache", async () => {
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  const { CacheIndexDat2 } = require("../dist/game/cache/codec/rs/cache/CacheIndex");
  const { IndexType } = require("../dist/game/cache/codec/rs/cache/IndexType");
  const { ConfigType } = require("../dist/game/cache/codec/rs/cache/ConfigType");
  const { Sound } = require("../dist/game/Sound");
  const { PluginManager } = require("../dist/plugins/PluginManager");
  await CachePipeline.initialize(require("node:path").resolve(__dirname, ".."));
  const store = CachePipeline.getStore();
  const audio = CacheIndexDat2.fromStore(IndexType.DAT2.soundEffects, store);
  for (const [name, id] of Object.entries({ COOKING_COOK: 2577, CRAFT_RUNES: 2710,
    MINING_MINE: 3220, FISHING_FISH: 2600, CUTTING: 2605, SHEAR_SHEEP: 761,
    POTION_MIX: 2611, GEM_CUTTING: 2586, SMELTING: 2725, BURY_BONES: 2738 })) {
    assert.equal(Sound[name].getId(), id, name);
    assert.ok(audio.getFileSmart(id)?.data.length, `OSRS synth ${name} exists`);
  }
  const interfaces = CacheIndexDat2.fromStore(IndexType.DAT2.interfaces, store);
  for (const child of [1, 2, 3, 4, 6, 9, 12, 14, 17, 19, 21, 23, 25, 28, 30, 32, 34, 36, 38, 40, 43, 45, 47, 49, 51, 53, 57])
    assert.ok(interfaces.getFile(233, child)?.data.length, `level-up component ${child}`);
  const configs = CacheIndexDat2.fromStore(IndexType.DAT2.configs, store);
  const core = PluginManager.getCoreApi();
  const hooks = registerFeedbackPlugin("skills/Crafting", core);
  for (const [uncut, cut, animation] of [["OPAL", "OPAL", 890], ["JADE", "JADE", 891],
    ["RED_TOPAZ", "RED_TOPAZ", 892], ["SAPPHIRE", "SAPPHIRE", 888], ["EMERALD", "EMERALD", 889],
    ["RUBY", "RUBY", 887], ["DIAMOND", "DIAMOND", 886], ["DRAGONSTONE", "DRAGONSTONE", 885],
    ["ONYX", "ONYX", 2717], ["ZENYTE", "ZENYTE", 7185]]) {
    assert.ok(configs.getFile(ConfigType.DAT2.seqs, animation)?.data.length, `gem sequence ${animation}`);
    const p = feedbackPlayer(core), I = core.ItemIdentifiers;
    p.skills = { getCurrentLevel: () => 99, addExperiences() {} };
    p.counts.set(I.CHISEL, 1); p.counts.set(I[`UNCUT_${uncut}`], 1);
    hooks.onItemOnItem({ player: p, usedItemId: I.CHISEL, usedWithItemId: I[`UNCUT_${uncut}`] });
    assert.equal(p.animations.at(-1), animation, uncut);
    assert.equal(p.counts.get(I[cut]), 1);
    assert.equal(p.sent.filter(([type, id]) => type === "sendSoundEffect" && id === 2586).length, 1);
  }
});

test("Defence threshold changes update native prayer-unlock varbits", () => {
  const { PluginManager } = require("../dist/plugins/PluginManager");
  const p = feedbackPlayer(PluginManager.getCoreApi());
  p.skills.setMaxLevel(Skill.PRAYER, 99, false);
  for (const level of [59, 60, 69, 70]) {
    p.sent.length = 0;
    p.skills.setMaxLevel(Skill.DEFENCE, level);
    const bits = new Map(p.sent.filter(([type]) => type === "sendVarbit").map(([, id, n]) => [id, n]));
    assert.equal(bits.get(3909), level >= 60 ? 8 : 0);
    assert.equal(bits.get(5451), level >= 70 ? 1 : 0);
    assert.equal(bits.get(5452), level >= 70 ? 1 : 0);
  }
});


test("cancelling a combat target stops its animation and future attacks without clearing airborne hits", () => {
  const { Combat } = require("../dist/game/content/combat/Combat");
  const animations = [], hits = [{ launched: true }], target = {};
  const character = { isPlayer: () => true, isNpc: () => false,
    getAsPlayer: () => ({ getPacketSender: () => ({ sendConfig() {} }) }),
    getMovementQueue: () => ({ reset() {} }), setMobileInteraction() {}, setPositionToFace() {},
    performAnimation: animation => animations.push(animation.getId()),
  };
  const combat = { character, target, generation: 3, autoRetaliating: true,
    cycleState: { target }, specialAttackQueued: true, hitQueue: hits };
  Combat.prototype.reset.call(combat);
  assert.equal(combat.target, null); assert.equal(combat.generation, 4);
  assert.equal(combat.cycleState, null); assert.equal(combat.specialAttackQueued, false);
  assert.deepEqual(animations, [65535]); assert.deepEqual(hits, [{ launched: true }]);
  Combat.prototype.reset.call(combat);
  assert.equal(animations.length, 1, "unrelated reset does not cancel a skilling animation");
});

test("moving or disconnecting during pickpocketing cancels the resolving tick", () => {
  const { PluginManager } = require("../dist/plugins/PluginManager");
  const core = PluginManager.getCoreApi(), tasks = [], npcHooks = {};
  const hooks = registerFeedbackPlugin("skills/Thieving", core, {
    getTaskManager: () => ({ submit(task) { task.setRunning(true); tasks.push(task); } }),
    getCombatFactory: () => ({ inCombat: () => false }),
    onNpcInteraction: (name, actions) => { npcHooks[name] = actions; },
  });
  for (const disconnect of [false, true]) {
    const p = feedbackPlayer(core);
    p.getIndex = () => 1; p.getTimers = () => ({ has: () => false });
    p.setPositionToFace = () => {}; p.getMovementQueue = () => ({ size: () => 0, reset() {} });
    p.skills = { getCurrentLevel: () => 99, addExperiences() { assert.fail("interrupted action awarded XP"); } };
    const npc = { getDefinition: () => ({ getName: () => "Man" }),
      getTimers: () => ({ registers() {} }), getLocation: p.getLocation, isRegistered: () => true };
    npcHooks.Man.Pickpocket({ player: p, npc, definition: npc.getDefinition() });
    const task = tasks.pop(); assert.ok(task); task.tick();
    if (disconnect) p.isRegistered = () => false;
    else p.moveTo(new core.Location(3001, 3000, 0));
    task.tick();
    assert.equal(task.isRunning(), false);
    assert.equal(p.counts.size, 0, "interrupted action produced no loot");
    if (!disconnect) assert.equal(p.animations.at(-1), 65535);
  }
});
