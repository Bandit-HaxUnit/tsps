// Run after `yarn build`: node --test tests/league-relic-effects-production.test.cjs
// The production relics (docs/leagues.md): Production Prodigy (Trailblazer Reloaded), Production
// Master and Friendly Forager (Raging Echoes). Each works for a character of its league who chose
// it, and for nobody else: not a character of that league without it, not the other league's
// character with the same slots, not a main character. Herblore's own herb lookup answers.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before, afterEach } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { GameConstants } = require("../dist/game/GameConstants");
const { Skill } = require("../dist/game/model/Skill");
const { Location } = require("../dist/game/model/Location");

let core;
const hooks = {};
const custom = {};
const itemActions = new Map();
const realRandom = Math.random;
let cycle = 100;
let realCycle;
let I;
let obj;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  I = core.ItemIdentifiers;
  obj = (name) => core.CacheDefinitions.getObjId(name);
  realCycle = core.World.getProcessCycle;
  core.World.getProcessCycle = () => cycle;
  GameConstants.setWorldProfile("league"); // a Trailblazer Reloaded world (the league type is the plugin config below)
  const lists = {};
  const on = (name) => (handler) => {
    (lists[name] ??= []).push(handler);
    hooks[name] = (event) => {
      for (const attached of lists[name]) attached(event);
    };
  };
  const api = new Proxy({
    core,
    persistAttribute() {},
    getPluginConfig: (key, fallback) => (key === "league:type" ? 4 : fallback),
    setWorldProfile: (profile) => GameConstants.setWorldProfile(profile),
    getSkillManager: () => require("../dist/game/content/skill/SkillManager").SkillManager,
    getAreaManager: () => ({ inMulti: () => false }),
    registerCommand: (name, handler) => (hooks[`command:${name}`] = handler),
    registerMagicAttackAccuracyModifier() {},
    registerMagicDamageBonusModifier() {},
    registerMeleeAttackAccuracyModifier() {},
    registerRangedAttackAccuracyModifier() {},
    registerMeleeDefenseModifier() {},
    registerMagicDefenseModifier() {},
    registerWeaponProfile() {},
    registerRangedAmmoHandler() {},
    onItemAction: (name, actions) => itemActions.set(name, { ...(itemActions.get(name) ?? {}), ...actions }),
    onInterfaceActionButton: (ids, handler) => {
      for (const id of [].concat(ids)) on(`button:${id}`)(handler);
    },
    onCustomEvent: (name, handler) => (custom[name] = (custom[name] ?? []).concat(handler)),
    emitCustomEvent: (name, payload) => {
      for (const handler of custom[name] ?? []) handler(payload);
    },
  }, { get: (target, key) => (key in target ? target[key] : on(String(key))) });
  require("../plugins/modes/LeagueMode.plugin").register(api);
  require("../plugins/modes/LeaguePoints.plugin").register(api);
  require("../plugins/modes/LeagueRelics.plugin").register(api);
  require("../plugins/skills/herblore/Events.Herblore")(api);
});

afterEach(() => {
  Math.random = realRandom;
});

test.after(() => {
  core.World.getProcessCycle = realCycle;
});

function emit(name, payload) {
  for (const handler of custom[name] ?? []) handler(payload);
  return payload;
}

/** A real player of `profile`, logged in, with the given relic picks (tier index -> slot). */
function character(name, profile, picks = {}, leagueType = 4) {
  const player = new Player(null);
  player.setUsername(name);
  player.setProfile(profile);
  player.setLocation(new Location(3200, 3200, 0));
  player.setRegistered(true);
  const sender = new Proxy({}, { get: () => () => sender });
  player.getPacketSender = () => sender;
  player.sendMessage = () => {};
  if (profile === "league") {
    player.setAttribute("league:type", leagueType);
    player.setAttribute("league:relics", picks);
  }
  hooks.onPlayerLogin({ player, username: name, isNewAccount: false, profile });
  return player;
}

function cases(picks, league = 4) {
  return {
    relic: character("relic", "league", picks, league),
    without: character("without", "league", {}, league),
    other: character("other", "league", picks, league === 4 ? 5 : 4),
    main: character("main", "main"),
  };
}

function others(who) {
  return [who.without, who.other, who.main];
}

function banked(player, itemId) {
  return player.getBank(core.Bank.getTabForItem(player, itemId)).getAmount(itemId);
}

function xp(player, skill) {
  return player.getSkillManager().getExperience(skill);
}

const boost = (player, skill) => emit("skills:level-boost", { player, skill, boost: 0 }).boost;
const actions = (player, skill, kind, recipe = null) => emit("skills:actions-per-cycle", { player, skill, kind, recipe, actions: 1 }).actions;

const PRODIGY = { 0: 2 };
const MASTER = { 4: 2 };
const FORAGER = { 1: 2 };

test("Production Prodigy: +12 in its five skills, its activities all at once, a 25% extra product banked with XP", () => {
  const who = cases(PRODIGY);
  for (const skill of [Skill.CRAFTING, Skill.SMITHING, Skill.HERBLORE, Skill.FLETCHING, Skill.COOKING]) {
    assert.equal(boost(who.relic, skill), 12, skill.getName());
    for (const player of others(who)) assert.equal(boost(player, skill), 0, `${player.getUsername()} ${skill.getName()}`);
  }
  assert.equal(boost(who.relic, Skill.MINING), 0, "not another skill");

  assert.equal(actions(who.relic, Skill.SMITHING, "smelt"), 28);
  assert.equal(actions(who.relic, Skill.FLETCHING, "logs"), 28);
  assert.equal(actions(who.relic, Skill.CRAFTING, "gems"), 28);
  assert.equal(actions(who.relic, Skill.HERBLORE, "clean"), 28);
  assert.equal(actions(who.relic, Skill.COOKING, "cook"), 28);
  assert.equal(actions(who.relic, Skill.FLETCHING, "arrows"), 1, "arrows are Production Master's, not the Prodigy's");
  assert.equal(actions(who.relic, Skill.CRAFTING, "weaving"), 1, "weaving is not on the Wiki's list");
  const plain = { ingredients: [{ id: obj("guamvial"), count: 1 }, { id: obj("eye_of_newt"), count: 1 }] };
  const stackable = { ingredients: [{ id: obj("antidote++4"), count: 1 }, { id: obj("snakeboss_scale"), count: 20 }] };
  assert.equal(actions(who.relic, Skill.HERBLORE, "mix", plain), 28);
  assert.equal(actions(who.relic, Skill.HERBLORE, "mix", stackable), 1, "a stackable secondary (Zulrah's scales) one at a time");
  for (const player of others(who)) assert.equal(actions(player, Skill.SMITHING, "smelt"), 1, `${player.getUsername()} one at a time`);

  const rolls = [];
  Math.random = () => rolls.shift() ?? 0.5;
  const before = xp(who.relic, Skill.SMITHING);
  rolls.push(0.1);
  emit("skills:produced", { player: who.relic, skill: Skill.SMITHING, itemId: I.IRON_BAR, amount: 1, xp: 12.5 });
  assert.equal(banked(who.relic, I.IRON_BAR), 1, "a 10 passes the 25%: another bar in the bank");
  assert.ok(xp(who.relic, Skill.SMITHING) > before, "with its XP");
  rolls.push(0.6);
  emit("skills:produced", { player: who.relic, skill: Skill.SMITHING, itemId: I.IRON_BAR, amount: 1, xp: 12.5 });
  assert.equal(banked(who.relic, I.IRON_BAR), 1, "a 60 misses");
  rolls.push(0.1);
  emit("skills:produced", { player: who.relic, skill: Skill.FLETCHING, itemId: I.ARROW_SHAFT, amount: 15, xp: 5 });
  assert.equal(banked(who.relic, I.ARROW_SHAFT), 15, "the same amount the action made");
  rolls.push(0.1);
  emit("skills:produced", { player: who.relic, skill: Skill.MINING, itemId: I.IRON_ORE, amount: 1, xp: 35 });
  assert.equal(banked(who.relic, I.IRON_ORE), 0, "not another skill's product");
  for (const player of others(who)) {
    rolls.push(0.1);
    emit("skills:produced", { player, skill: Skill.SMITHING, itemId: I.IRON_BAR, amount: 1, xp: 12.5 });
    assert.equal(banked(player, I.IRON_BAR), 0, `${player.getUsername()} gets none`);
  }
});

test("Production Master: its activities all at once, ammunition ten at a time; no boost and no extra product", () => {
  const who = cases(MASTER, 5);
  assert.equal(actions(who.relic, Skill.SMITHING, "smith"), 28);
  assert.equal(actions(who.relic, Skill.FLETCHING, "arrows"), 10, "ammunition capped at 10x");
  assert.equal(actions(who.relic, Skill.FLETCHING, "darts"), 10);
  assert.equal(actions(who.relic, Skill.CRAFTING, "amethyst"), 28, "amethyst (10 December 2024)");
  assert.equal(actions(who.relic, Skill.CRAFTING, "weaving"), 1);
  assert.equal(boost(who.relic, Skill.SMITHING), 0, "no level boost");
  const rolls = [0.1];
  Math.random = () => rolls.shift() ?? 0.5;
  emit("skills:produced", { player: who.relic, skill: Skill.SMITHING, itemId: I.IRON_BAR, amount: 1, xp: 12.5 });
  assert.equal(banked(who.relic, I.IRON_BAR), 0, "no extra product");
  for (const player of others(who)) {
    assert.equal(actions(player, Skill.FLETCHING, "arrows"), 1, `${player.getUsername()} one at a time`);
    assert.equal(actions(player, Skill.SMITHING, "smith"), 1);
  }
});

test("Friendly Forager: the pouch finds a herb on gathering, every 9 ticks, within level + 25 and 30 of each; Check, Fill, Withdraw", () => {
  const who = cases(FORAGER, 5);
  const pouch = I.FORAGERS_POUCH;
  for (const player of Object.values(who)) player.getInventory().adds(pouch, 1);
  const skills = who.relic.getSkillManager();
  skills.setMaxLevels(Skill.HERBLORE, 1, false);
  skills.setCurrentLevels(Skill.HERBLORE, 1, false);
  const held = (player) => player.getInventory().getItems().find((item) => item?.getId() === pouch).getMetaValue("league:forager-pouch") ?? {};
  const total = (player) => Object.values(held(player)).reduce((sum, amount) => sum + amount, 0);
  const herbs = emit("herblore:herbs", { herbs: [] }).herbs;
  assert.ok(herbs.length > 10, "Herblore lists its herbs");

  cycle = 100;
  emit("mining:success", { player: who.relic });
  assert.equal(total(who.relic), 1, "a herb on a gathering action");
  const found = Number(Object.keys(held(who.relic))[0]);
  assert.ok(herbs.find((herb) => herb.grimyId === found).level <= 26, "one a level 1 player could clean at level 26");
  emit("fishing:success", { player: who.relic });
  assert.equal(total(who.relic), 1, "not again within 9 ticks");
  cycle = 109;
  emit("woodcutting:success", { player: who.relic });
  assert.equal(total(who.relic), 2, "again after 9");
  cycle = 118;
  emit("hunter:success", { player: who.relic });
  assert.equal(total(who.relic), 3);
  for (const player of others(who)) {
    cycle += 10;
    emit("mining:success", { player });
    assert.equal(total(player), 0, `${player.getUsername()} finds nothing`);
  }

  const guam = obj("unidentified_guam");
  who.relic.getInventory().adds(guam, 5);
  itemActions.get("Forager's pouch").Fill({ player: who.relic });
  assert.equal(who.relic.getInventory().getAmount(guam), 0, "Fill takes the grimy herbs");
  assert.ok(held(who.relic)[guam] >= 5);
  const messages = [];
  who.relic.sendMessage = (text) => messages.push(text);
  itemActions.get("Forager's pouch").Check({ player: who.relic });
  assert.match(messages.at(-1), /holds: .*guam/i);
  const inPouch = total(who.relic);
  itemActions.get("Forager's pouch").Withdraw({ player: who.relic });
  assert.equal(total(who.relic), 0, "Withdraw empties it");
  const notedGuam = core.ItemDefinition.forId(guam).getNoteId();
  assert.ok(who.relic.getInventory().getAmount(notedGuam) >= 5, "as notes");
  assert.ok(inPouch >= 8);

  const contents = { [guam]: 30 };
  const lowHerbs = herbs.filter((herb) => herb.level <= 26).map((herb) => herb.grimyId);
  for (const id of lowHerbs) contents[id] = 30;
  who.relic.getInventory().getItems().find((item) => item?.getId() === pouch).setMetaValue("league:forager-pouch", contents);
  cycle = 500;
  emit("mining:success", { player: who.relic });
  assert.equal(total(who.relic), lowHerbs.length * 30, "every herb it could give is full: nothing more");
});

test("Friendly Forager: a secondary kept 90% of the time, a 3-dose potion made with 4 doses; herbs, crystal dust and unfinished potions as usual", () => {
  const who = cases(FORAGER, 5);
  const rolls = [];
  Math.random = () => rolls.shift() ?? 0.5;
  const mix = (player, product, ingredients, roll) => {
    rolls.length = 0;
    rolls.push(roll, roll, roll, roll);
    const recipe = { product, productId: obj(product), ingredients: ingredients.map(([name, count]) => ({ id: obj(name), count })) };
    return emit("herblore:mix", { player, recipe, consume: recipe.ingredients.map((item) => ({ ...item })), productId: recipe.productId });
  };
  const attack = mix(who.relic, "3dose1attack", [["guamvial", 1], ["eye_of_newt", 1]], 0.2);
  assert.deepEqual(attack.consume.map((item) => item.count), [1, 0], "a 20 keeps the eye of newt; the unfinished potion goes");
  assert.equal(attack.productId, obj("4dose1attack"), "4 doses");
  assert.deepEqual(mix(who.relic, "3dose1attack", [["guamvial", 1], ["eye_of_newt", 1]], 0.95).consume.map((item) => item.count), [1, 1], "a 95 uses it");
  assert.deepEqual(mix(who.relic, "guamvial", [["guam_leaf", 1], ["vial_water", 1]], 0.2).consume.map((item) => item.count), [1, 1], "an unfinished potion's herb is not a secondary");
  assert.deepEqual(mix(who.relic, "4dose2combat", [["4dose2attack", 1], ["4dose2defense", 1], ["4dose2strength", 1], ["torstolvial", 1]], 0.2).consume.map((item) => item.count),
    [1, 1, 1, 0], "a super combat's torstol potion (unf) is kept (Wiki)");
  assert.deepEqual(mix(who.relic, "4dosedivineattack", [["4dose2attack", 1], ["prif_crystal_shard_crushed", 1]], 0.2).consume.map((item) => item.count),
    [1, 1], "crystal dust never is (Wiki)");
  for (const player of others(who)) {
    const usual = mix(player, "3dose1attack", [["guamvial", 1], ["eye_of_newt", 1]], 0.2);
    assert.deepEqual([usual.consume.map((item) => item.count), usual.productId], [[1, 1], obj("3dose1attack")], `${player.getUsername()} as usual`);
  }
});

test("through Herblore's own cleaning: one click cleans every grimy herb of the kind for Production Master, one for the others", () => {
  require("../plugins/skills/herblore/Cleaning.Herblore")(new Proxy({ core }, {
    get: (target, key) => (key in target ? target[key] : (handler) => { if (key === "onItemFirstAction") hooks.cleanHerb = handler; }),
  }));
  const who = cases(MASTER, 5);
  const grimy = obj("unidentified_guam");
  const clean = obj("guam_leaf");
  for (const player of Object.values(who)) {
    const skills = player.getSkillManager();
    skills.setMaxLevels(Skill.HERBLORE, 10, false);
    skills.setCurrentLevels(Skill.HERBLORE, 10, false);
    player.getInventory().adds(grimy, 1).adds(grimy, 1).adds(grimy, 1);
    const slot = player.getInventory().getItems().findIndex((item) => item?.getId() === grimy);
    hooks.cleanHerb({ player, itemId: grimy, slot });
  }
  assert.deepEqual([who.relic.getInventory().getAmount(clean), who.relic.getInventory().getAmount(grimy)], [3, 0], "all three at once");
  for (const player of others(who)) {
    assert.deepEqual([player.getInventory().getAmount(clean), player.getInventory().getAmount(grimy)], [1, 2], `${player.getUsername()} cleans one`);
  }
});
