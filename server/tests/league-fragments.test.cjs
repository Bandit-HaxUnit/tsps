// Run after `yarn build`: node --test tests/league-fragments.test.cjs
// Shattered Relics' fragments (docs/leagues.md "Shattered Relics"): fragment XP and levels, set
// tiers, the Unidentified fragment drops and Break, and batch 1 of the effects, with real players.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before, afterEach } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");
const { GameConstants } = require("../dist/game/GameConstants");
const { World } = require("../dist/game/World");

const uid = (group, child) => (group << 16) | child;
const CLASS = 737;
const FRAGMENTS = 735;
const SLOT_VARBITS = [13395, 13396, 13397, 13398, 13399, 13401, 13402];
const fragmentVarbit = (id) => 13403 + id - 1;
const ITEMS = { harvesting: 26544, production: 26545, skilling: 26546, combat: 26547, misc: 26548 };

let core;
let Fragments;
let Effects;
let Drops;
const hooks = {};
const custom = {};
const itemActions = {};
let worldLeague = 3;
const tasks = [];
const realRandom = Math.random;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  GameConstants.setWorldProfile("league");
  const lists = {};
  const on = (name) => (handler) => {
    (lists[name] ??= []).push(handler);
    hooks[name] = (...args) => {
      let result;
      for (const attached of lists[name]) {
        const answer = attached(...args);
        if (answer !== undefined) result = answer;
      }
      return result;
    };
  };
  const api = new Proxy({
    core,
    persistAttribute: (key, value) => PlayerSave.persistAttribute(key, value),
    getPluginConfig: (key, fallback) => (key === "league:type" ? worldLeague : fallback),
    setWorldProfile: (profile) => GameConstants.setWorldProfile(profile),
    getTaskManager: () => ({ submit: (task) => tasks.push(task) }),
    getSkillManager: () => require("../dist/game/content/skill/SkillManager").SkillManager,
    registerCommand: (name, handler) => (hooks[`command:${name}`] = handler),
    onInterfaceActionButton: (ids, handler) => {
      for (const id of [].concat(ids)) {
        const key = `button:${id}`;
        (lists[key] ??= []).push(handler);
        hooks[key] = (event) => {
          for (const attached of lists[key]) {
            if (attached(event) !== false) return (event.handled = true);
          }
          return false;
        };
      }
    },
    onItemAction: (name, actions) => Object.assign((itemActions[name] ??= {}), actions),
    onCustomEvent: (name, handler) => (custom[name] = (custom[name] ?? []).concat(handler)),
    emitCustomEvent: (name, payload) => {
      for (const handler of custom[name] ?? []) handler(payload);
    },
  }, { get: (target, key) => (key in target ? target[key] : on(String(key))) });
  require("../plugins/modes/LeagueMode.plugin").register(api);
  require("../plugins/modes/LeaguePoints.plugin").register(api);
  Fragments = require("../plugins/modes/league/Fragments.LeagueMode");
  Effects = require("../plugins/modes/league/FragmentEffects.LeagueMode")._test;
  Drops = require("../plugins/modes/league/FragmentDrops.LeagueMode")._test;
});

afterEach(() => {
  Math.random = realRandom;
});

function character(name, { league = 3 } = {}) {
  const player = new Player(null);
  player.setUsername(name);
  player.setProfile("league");
  const sent = { messages: [], varbits: new Map(), varps: new Map(), subs: [] };
  const sender = new Proxy({}, {
    get: (target, key) => {
      switch (key) {
        case "sendVarbit": return (id, value) => (sent.varbits.set(id, value), sender);
        case "sendConfig": return (id, value) => (sent.varps.set(id, value), sender);
        case "sendInterface": return (group) => (player.setInterfaceId(group), sent.subs.push(group), sender);
        case "sendInterfaceRemoval": return () => (player.setInterfaceId(-1), sender);
        default: return () => sender;
      }
    },
  });
  player.getPacketSender = () => sender;
  player.sendMessage = (text) => sent.messages.push(text);
  const previous = worldLeague;
  worldLeague = league;
  hooks.onPlayerLogin({ player, username: name, isNewAccount: true, profile: "league" });
  worldLeague = previous;
  tasks.length = 0;
  return Object.assign(player, { sent });
}

function click(player, group, child, extra = {}) {
  return hooks[`button:${uid(group, child)}`]({ player, buttonId: uid(group, child), ...extra });
}

function emit(name, payload) {
  for (const handler of custom[name] ?? []) handler(payload);
  return payload;
}

/** A Warrior (Unholy Warrior owned) with `points` League Points, so that many slots are open. */
function warrior(name, points = 0) {
  const player = character(name);
  player.setInterfaceId(CLASS);
  click(player, CLASS, 6);
  click(player, CLASS, 26);
  if (points) hooks["command:leaguetask"]({ player, parts: ["leaguetask", `points-${name}`, String(points)] });
  return player;
}

function equip(player, ...ids) {
  player.setInterfaceId(FRAGMENTS);
  for (const id of ids) {
    if (!(Number(Fragments._test.owned(player)[id]) > 0)) emit("league:grant-fragment", { player, id });
    click(player, FRAGMENTS, 18, { slot: 9 * (id - 1), opId: 2 });
  }
  player.setInterfaceId(-1);
}

function setXp(player, id, xp) {
  player.setAttribute(Fragments._test.FRAGMENTS_ATTRIBUTE, { ...Fragments._test.owned(player), [id]: xp });
}

function gain(player, skill = "ATTACK", experience = 10) {
  hooks.onExperienceGained({ player, skill: core.Skill[skill], experience });
}

// ---- Fragment XP, levels, sets ----

test("equipped fragments gain 1 XP per XP gain, at most once every 4 ticks", () => {
  const player = warrior("gainer", 10);
  equip(player, 1);
  emit("league:grant-fragment", { player, id: 4 });
  World.processCycle = 1000;
  gain(player);
  assert.equal(Fragments._test.owned(player)[1], 2);
  assert.equal(player.sent.varbits.get(fragmentVarbit(1)), 2, "its varbit follows");
  gain(player);
  World.processCycle = 1003;
  gain(player);
  assert.equal(Fragments._test.owned(player)[1], 2, "not again within 4 ticks");
  World.processCycle = 1004;
  gain(player);
  assert.equal(Fragments._test.owned(player)[1], 3);
  assert.equal(Fragments._test.owned(player)[4], 1, "an unequipped fragment doesn't gain");
});

test("levels follow script 5789's thresholds and stop at the last one", () => {
  const player = warrior("leveller");
  equip(player, 1);
  setXp(player, 1, 1999);
  assert.equal(Fragments.equippedLevel(player, 1), 1);
  World.processCycle = 2000;
  gain(player);
  assert.equal(Fragments.equippedLevel(player, 1), 2, "2,000 XP is level 2");
  setXp(player, 1, 7999);
  World.processCycle = 2010;
  gain(player);
  assert.equal(Fragments.equippedLevel(player, 1), 3);
  World.processCycle = 2020;
  gain(player);
  assert.equal(Fragments._test.owned(player)[1], 8000, "it stops at 8,000");
  assert.equal(Fragments.findable(player, 1), false, "and leaves the drop pool");
  assert.equal(Fragments.equippedLevel(player, 4), 0, "not equipped, no level");
});

test("a set's tier counts the equipped fragments that list it (enum 4137)", () => {
  const player = warrior("collector", 300);
  assert.equal(Fragments.setTier(player, 1), 0);
  equip(player, 9, 20);
  assert.equal(Fragments.setTier(player, 1), 1, "Absolute Unit: Divine Restoration and Saradominist Defence make 2 pieces");
  equip(player, 13);
  assert.equal(Fragments.setTier(player, 1), 2, "Venomaster makes 3: tier 2");
});

// ---- Drops and Break ----

test("skilling XP may turn up its category's Unidentified fragment; combat kills by the NPC's tier", () => {
  const player = warrior("finder");
  Math.random = () => 0;
  gain(player, "FISHING", 50);
  assert.equal(player.getInventory().contains(ITEMS.harvesting), true, "fishing: harvesting");
  gain(player, "COOKING", 50);
  assert.equal(player.getInventory().contains(ITEMS.production), true, "cooking: production");
  gain(player, "ATTACK", 50);
  assert.equal(player.getInventory().contains(ITEMS.combat), false, "combat XP rolls on kills instead");
  Math.random = () => 0.999;
  gain(player, "THIEVING", 50);
  assert.equal(player.getInventory().contains(ITEMS.skilling), false, "a miss drops nothing");
  Math.random = () => 0;
  const graardor = core.NpcDefinition.forId(2215);
  hooks.onNpcDeath({ killer: player, npc: { getCurrentDefinition: () => graardor, getDefinition: () => graardor } });
  assert.equal(player.getInventory().contains(ITEMS.combat), true);
  assert.deepEqual(player.getAttribute(Drops.PENDING_ATTRIBUTE), [4], "General Graardor drops tier 4");
  assert.equal(Drops.tierOf("Goblin"), 1, "any other NPC is tier 1");
});

test("Break opens a fragment of the item's kind; a known one gains 500 XP instead", () => {
  const player = warrior("breaker");
  hooks["command:fragment"]({ player, parts: ["fragment", "combat", "4"] });
  const name = core.CacheDefinitions.getItem(ITEMS.combat).name;
  Math.random = () => 0;
  itemActions[name].Break({ player, itemId: ITEMS.combat });
  assert.equal(player.getInventory().contains(ITEMS.combat), false, "the item is used");
  assert.equal(Fragments._test.owned(player)[17], 1, "a tier 4 fragment: Bandosian Might");
  assert.match(player.sent.messages.at(-1), /Bandosian Might/);
  hooks["command:fragment"]({ player, parts: ["fragment", "combat", "4"] });
  itemActions[name].Break({ player, itemId: ITEMS.combat });
  assert.equal(Fragments._test.owned(player)[17], 501, "a duplicate gives 500 XP");
  for (const id of [17, 18, 19, 20]) setXp(player, id, 8000);
  hooks["command:fragment"]({ player, parts: ["fragment", "combat", "4"] });
  itemActions[name].Break({ player, itemId: ITEMS.combat });
  assert.equal(Fragments.findable(player, 17), false);
  assert.equal(Fragments._test.owned(player)[8], 1, "a mastered tier falls to the nearest other (tier 3: Livin' On A Prayer)");
  for (const [category, item] of Object.entries(ITEMS)) {
    assert.ok(itemActions[core.CacheDefinitions.getItem(item).name]?.Break, `${category} has Break`);
  }
});

test("when every fragment of a kind is mastered, Break keeps the item", () => {
  const player = warrior("master");
  for (const id of [49, 50, 51, 52, 53]) setXp(player, id, 8000);
  hooks["command:fragment"]({ player, parts: ["fragment", "misc"] });
  const name = core.CacheDefinitions.getItem(ITEMS.misc).name;
  itemActions[name].Break({ player, itemId: ITEMS.misc });
  assert.equal(player.getInventory().contains(ITEMS.misc), true);
  assert.match(player.sent.messages.at(-1), /mastered every fragment/);
});

// ---- Effects ----

test("Unholy Warrior: melee accuracy up at 0 Prayer points only", () => {
  const player = warrior("unholy");
  equip(player, 1);
  const melee = Effects.accuracy("melee");
  const skills = player.getSkillManager();
  skills.setCurrentLevel(core.Skill.PRAYER, 1, false);
  assert.equal(melee(player, 1000), 1000, "with prayer points, no change");
  skills.setCurrentLevel(core.Skill.PRAYER, 0, false);
  assert.equal(melee(player, 1000), 1120, "level 1: +12%");
  setXp(player, 1, 8000);
  assert.equal(melee(player, 1000), 1300, "level 3: +30%");
  assert.equal(Effects.accuracy("ranged")(player, 1000), 1000, "only its own style");
});

test("Bottomless Quiver and Arcane Conduit save ammunition, runes and charges", () => {
  const player = warrior("saver", 10);
  equip(player, 4, 6);
  Math.random = () => 0;
  const bow = { player, weaponId: 841, saved: false };
  Effects.ammoSaving(bow);
  assert.equal(bow.saved, true, "a shortbow's arrow saved");
  const chin = { player, weaponId: 10033, saved: false };
  Effects.ammoSaving(chin);
  assert.equal(chin.saved, false, "not chinchompas");
  const runes = { player, saved: false };
  Effects.runeSaving(runes);
  assert.equal(runes.saved, true);
  const charge = { player, itemId: 11905, skip: false };
  Effects.chargeSaving(charge);
  assert.equal(charge.skip, true, "a powered staff's charge too");
  Math.random = () => 0.5;
  const miss = { player, saved: false };
  Effects.runeSaving(miss);
  assert.equal(miss.saved, false, "40% at level 1: a 50 roll misses");
});

test("Larger Recharger, Divine Restoration and Slay All Day", () => {
  const player = warrior("restorer", 300);
  equip(player, 11, 9, 14);
  assert.equal(Effects.specialRestore(player, 50), 42, "special energy every 25 s at level 1");
  const skills = player.getSkillManager();
  skills.setMaxLevel?.(core.Skill.PRAYER, 10, false);
  skills.setCurrentLevel(core.Skill.PRAYER, 0, false);
  const max = skills.getMaxLevel(core.Skill.PRAYER);
  for (let tick = 0; tick < 25; tick++) Effects.perTick({ player });
  assert.equal(skills.getCurrentLevel(core.Skill.PRAYER), Math.min(1, max), "a prayer point every 15 s (25 ticks) at level 1");
  skills.setCurrentLevel(core.Skill.HITPOINTS, 5, false);
  Effects.slayerKill({ player });
  assert.equal(skills.getCurrentLevel(core.Skill.HITPOINTS), 6, "an on-task kill heals 1");
});

test("Absolute Unit and Drakan's Touch at their set tiers", () => {
  const player = warrior("unit", 300);
  equip(player, 9, 20);
  const hit = { damage: 20, getDamage() { return this.damage; }, setDamage(value) { this.damage = value; } };
  Effects.incomingDamage(player, hit, { attacker: { isNpc: () => true } });
  assert.equal(hit.damage, 14, "30% less from monsters at 2 pieces");
  const pvp = { damage: 20, getDamage() { return this.damage; }, setDamage(value) { this.damage = value; } };
  Effects.incomingDamage(player, pvp, { attacker: { isNpc: () => false } });
  assert.equal(pvp.damage, 20, "not from players");
  const touch = warrior("touch", 300);
  equip(touch, 3, 5);
  assert.equal(Fragments.setTier(touch, 6), 1, "Unholy Ranger and Unholy Wizard both list Drakan's Touch");
  const skills = touch.getSkillManager();
  skills.setCurrentLevel(core.Skill.HITPOINTS, 5, false);
  Math.random = () => 0;
  Effects.hitResolved({
    attacker: touch,
    target: { isPlayer: () => false, isNpc: () => true },
    hit: { getTotalDamage: () => 40, isAccurate: () => false, getCombatType: () => core.CombatType.MAGIC },
  });
  assert.equal(skills.getCurrentLevel(core.Skill.HITPOINTS), 7, "5% of 40 healed");
});

test("another league's character gets none of it", () => {
  const echoes = character("echoes-frag", { league: 5 });
  worldLeague = 5;
  try {
    Math.random = () => 0;
    gain(echoes, "FISHING", 500);
    assert.equal(echoes.getInventory().contains(ITEMS.harvesting), false);
    echoes.getSkillManager().setCurrentLevel(core.Skill.PRAYER, 0, false);
    assert.equal(Effects.accuracy("melee")(echoes, 1000), 1000);
    assert.equal(Fragments.equippedLevel(echoes, 1), 0);
  } finally {
    worldLeague = 3;
  }
});
