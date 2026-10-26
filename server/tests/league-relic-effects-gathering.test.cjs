// Run after `yarn build`: node --test tests/league-relic-effects-gathering.test.cjs
// The gathering relics (docs/leagues.md): Endless Harvest and Trickster (Trailblazer Reloaded),
// Power Miner, Lumberjack, Animal Wrangler, Corner Cutter and Dodgy Deals (Raging Echoes). Each
// works for a character of its league who chose it, and for nobody else: not a character of that
// league without it, not the other league's character with the same slots, not a main character.
// The skills' lookups (a bar for an ore, a cut gem, a cooked fish, a log's shafts and its
// Firemaking XP) are answered here as their plugins would.
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
let I;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  I = core.ItemIdentifiers;
  GameConstants.LEAGUE_WORLD_TYPE = 4;
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
    onItemAction: (name, actions) => itemActions.set(name, actions),
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
  // The owners' answers to the relics' lookups, as Smelting, Gems, Cooking, Fletching and Firemaking give them.
  custom["smithing:bar-for-ore"] = [(request) => { if (request.oreId === I.IRON_ORE) Object.assign(request, { barId: I.IRON_BAR, xp: 12.5 }); }];
  custom["crafting:cut-gem"] = [(request) => { if (request.uncutId === I.UNCUT_SAPPHIRE) Object.assign(request, { cutId: I.SAPPHIRE, xp: 50 }); }];
  custom["cooking:cooked"] = [(request) => { if (request.rawId === I.RAW_SHRIMPS) Object.assign(request, { cookedId: I.SHRIMPS, xp: 30 }); }];
  custom["fletching:shafts"] = [(request) => { if (request.logId === I.LOGS) Object.assign(request, { itemId: I.ARROW_SHAFT, amount: 15, xp: 5 }); }];
  custom["firemaking:log-xp"] = [(request) => { if (request.logId === I.LOGS) request.xp = 40; }];
});

afterEach(() => {
  Math.random = realRandom;
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

function gather(player, itemId, amount, skill, experience = 0) {
  return emit("storage:gather", { player, itemId, amount, stored: 0, skill, xp: experience });
}

const ENDLESS_HARVEST = { 0: 1 };
const TRICKSTER = { 0: 3 };
const POWER_MINER = { 0: 1 };
const LUMBERJACK = { 0: 2 };
const ANIMAL_WRANGLER = { 0: 3 };
const CORNER_CUTTER = { 1: 1 };
const DODGY_DEALS = { 1: 3 };

test("Endless Harvest: twice the ore, log or fish, banked, with the second resource's XP", () => {
  const who = cases(ENDLESS_HARVEST);
  const before = xp(who.relic, Skill.MINING);
  const request = gather(who.relic, I.IRON_ORE, 1, Skill.MINING, 35);
  assert.equal(request.stored, 1, "the inventory gets nothing");
  assert.equal(banked(who.relic, I.IRON_ORE), 2, "two ores in the bank");
  assert.ok(xp(who.relic, Skill.MINING) > before, "the extra ore pays its XP");
  assert.equal(gather(who.relic, I.LOGS, 1, Skill.WOODCUTTING, 25).stored, 1);
  assert.equal(gather(who.relic, I.RAW_SHRIMPS, 1, Skill.FISHING, 10).stored, 1);
  assert.deepEqual([banked(who.relic, I.LOGS), banked(who.relic, I.RAW_SHRIMPS)], [2, 2]);
  assert.equal(gather(who.relic, I.IRON_ORE, 1, undefined, 0).stored, 0, "a stall's take is not a harvest");
  assert.equal(emit("storage:room", { player: who.relic, itemId: I.IRON_ORE, room: false }).room, true, "the bank's room counts");
  // The other league's slot is Power Miner, which banks ore (not logs) itself, so logs tell them apart.
  for (const player of others(who)) {
    assert.equal(gather(player, I.LOGS, 1, Skill.WOODCUTTING, 25).stored, 0, `${player.getUsername()} keeps the log`);
    assert.equal(banked(player, I.LOGS), 0);
  }
  for (const player of [who.without, who.main]) {
    assert.equal(gather(player, I.IRON_ORE, 1, Skill.MINING, 35).stored, 0, `${player.getUsername()} keeps the ore`);
    assert.equal(emit("storage:room", { player, itemId: I.IRON_ORE, room: false }).room, false);
  }
});

test("Trickster: sure thieving, agility, hunter and firemaking, tripled pouches, doubled noted loot, a repeat, nine logs", () => {
  const who = cases(TRICKSTER);
  const target = { name: "Man", low: 50, high: 240, xp: 8 };
  const picked = emit("thieving:pickpocket-target", { player: who.relic, target, unconscious: false, pouchLimit: 28 });
  assert.deepEqual([picked.target.low, picked.target.high, picked.pouchLimit], [256, 256, 84]);
  const notedLogs = core.ItemDefinition.forId(I.LOGS).getNoteId();
  const loot = emit("thieving:loot", { player: who.relic, npc: null, target: "Man", loot: [{ id: I.LOGS, amount: 3 }, { id: I.COINS, amount: 40 }, { id: I.CLUE_SCROLL_EASY_, amount: 1, clue: true }] });
  assert.deepEqual(loot.loot, [{ id: notedLogs, amount: 6 }, { id: I.COINS, amount: 40 }, { id: I.COINS, amount: 40 }, { id: I.CLUE_SCROLL_EASY_, amount: 1, clue: true }], "doubled and noted; coins a second pouch; a clue once");
  assert.equal(emit("thieving:done", { player: who.relic, kind: "pickpocket", npc: null, succeeded: true, again: false }).again, true);
  assert.equal(emit("thieving:done", { player: who.relic, kind: "stall", object: null, succeeded: true, again: false }).again, false, "stalls are not repeated");
  assert.equal(emit("agility:roll", { player: who.relic, objectId: 1, success: false }).success, true);
  assert.equal(emit("hunter:catch-chance", { player: who.relic, npcId: 1, chance: 0.3 }).chance, 1);
  const box = emit("hunter:rewards", { player: who.relic, kind: "box", npcId: 1, rewards: [[I.CHINCHOMPA, 1]], xp: 198.5 });
  assert.deepEqual([box.rewards, box.xp], [[[I.CHINCHOMPA, 2]], 397]);
  const bird = emit("hunter:rewards", { player: who.relic, kind: "bird", npcId: 2, rewards: [[I.RAW_BIRD_MEAT, 1]], xp: 34 });
  assert.deepEqual([bird.rewards, bird.xp], [[[I.RAW_BIRD_MEAT, 1]], 34], "only box traps");
  assert.equal(emit("hunter:lure-interval", { player: who.relic, kind: "box", ticks: 5 }).ticks, 2);
  assert.equal(emit("hunter:jar-kept", { player: who.relic, kept: false }).kept, true);
  assert.equal(emit("firemaking:light-roll", { player: who.relic, success: false }).success, true);
  assert.equal(emit("firemaking:logs-per-action", { player: who.relic, logId: I.LOGS, amount: 1 }).amount, 9);
  for (const player of others(who)) {
    assert.equal(emit("thieving:pickpocket-target", { player, target, unconscious: false, pouchLimit: 28 }).pouchLimit, 28, `${player.getUsername()} as usual`);
    assert.deepEqual(emit("thieving:loot", { player, npc: null, target: "Man", loot: [{ id: I.LOGS, amount: 3 }] }).loot, [{ id: I.LOGS, amount: 3 }]);
    assert.equal(emit("thieving:done", { player, kind: "pickpocket", npc: null, succeeded: true, again: false }).again, false);
    assert.equal(emit("agility:roll", { player, objectId: 1, success: false }).success, false);
    assert.equal(emit("firemaking:light-roll", { player, success: false }).success, false);
    assert.equal(emit("firemaking:logs-per-action", { player, logId: I.LOGS, amount: 1 }).amount, 1);
  }
  // The other league's slot is Animal Wrangler, which shares the hunter effects.
  for (const player of [who.without, who.main]) {
    assert.equal(emit("hunter:catch-chance", { player, npcId: 1, chance: 0.3 }).chance, 0.3);
    assert.equal(emit("hunter:jar-kept", { player, kept: false }).kept, false);
  }
});

test("Power Miner: a second chance, four ores a rock, ore banked as bars and gems as cut gems, a toggle", () => {
  const who = cases(POWER_MINER, 5);
  const rolls = [];
  Math.random = () => rolls.shift() ?? 0.5;
  const attempt = (player, roll) => {
    rolls.push(roll);
    return emit("mining:attempt", { player, object: {}, oreId: I.IRON_ORE, success: false }).success;
  };
  assert.equal(attempt(who.relic, 0.2), true, "a 20 passes the 50%");
  assert.equal(attempt(who.relic, 0.7), false);
  for (const player of others(who)) assert.equal(attempt(player, 0.2), false, `${player.getUsername()} misses`);

  const rock = {};
  const deplete = (player) => emit("mining:deplete-rock", { player, object: rock, rock: "Iron rocks", handled: false }).handled;
  assert.deepEqual([deplete(who.relic), deplete(who.relic), deplete(who.relic), deplete(who.relic)], [true, true, true, false], "the fourth ore takes the rock");
  assert.equal(deplete(who.relic), true, "and the count starts again");
  for (const player of others(who)) assert.equal(deplete(player), false);

  const smithing = xp(who.relic, Skill.SMITHING);
  assert.equal(gather(who.relic, I.IRON_ORE, 1, Skill.MINING, 35).stored, 1);
  assert.deepEqual([banked(who.relic, I.IRON_BAR), banked(who.relic, I.IRON_ORE)], [1, 0], "smelted on the way");
  assert.ok(xp(who.relic, Skill.SMITHING) > smithing);
  const crafting = xp(who.relic, Skill.CRAFTING);
  assert.equal(gather(who.relic, I.UNCUT_SAPPHIRE, 1, Skill.MINING, 0).stored, 1);
  assert.equal(banked(who.relic, I.SAPPHIRE), 1, "cut on the way");
  assert.ok(xp(who.relic, Skill.CRAFTING) > crafting);
  assert.equal(gather(who.relic, I.COAL, 1, Skill.MINING, 50).stored, 1);
  assert.equal(banked(who.relic, I.COAL), 1, "an ore with no bar of its own is banked as it is");
  assert.equal(gather(who.relic, I.LOGS, 1, Skill.WOODCUTTING, 25).stored, 0, "not another skill's take");

  const toggle = itemActions.get("Echo pickaxe").Toggle;
  toggle({ player: who.relic });
  assert.equal(who.relic.getAttribute("league:power-miner-mode"), "smelt");
  toggle({ player: who.relic });
  assert.equal(who.relic.getAttribute("league:power-miner-mode"), "cut");
  gather(who.relic, I.IRON_ORE, 1, Skill.MINING, 35);
  assert.equal(banked(who.relic, I.IRON_ORE), 1, "cut only: the ore stays ore");
  toggle({ player: who.relic });
  assert.equal(who.relic.getAttribute("league:power-miner-mode"), "off");
  toggle({ player: who.relic });
  assert.equal(who.relic.getAttribute("league:power-miner-mode"), "smelt and cut", "round again");
  // The other league's slot is Endless Harvest, which banks the ore itself, as ore.
  for (const player of others(who)) {
    gather(player, I.IRON_ORE, 1, Skill.MINING, 35);
    assert.equal(banked(player, I.IRON_BAR), 0, `${player.getUsername()} smelts nothing`);
  }
  for (const player of [who.without, who.main]) assert.equal(gather(player, I.IRON_ORE, 1, Skill.MINING, 35).stored, 0);
});

test("Lumberjack: a second chance, logs burnt, fletched or banked by the axe's toggle, fires that always light", () => {
  const who = cases(LUMBERJACK, 5);
  const rolls = [];
  Math.random = () => rolls.shift() ?? 0.5;
  rolls.push(0.2);
  assert.equal(emit("woodcutting:attempt", { player: who.relic, object: {}, logId: I.LOGS, success: false }).success, true);
  rolls.push(0.2);
  assert.equal(emit("woodcutting:attempt", { player: who.without, object: {}, logId: I.LOGS, success: false }).success, false);

  const firemaking = xp(who.relic, Skill.FIREMAKING);
  assert.equal(gather(who.relic, I.LOGS, 1, Skill.WOODCUTTING, 25).stored, 1, "burnt: no log anywhere");
  assert.equal(banked(who.relic, I.LOGS), 0);
  assert.ok(xp(who.relic, Skill.FIREMAKING) > firemaking, "the Firemaking XP");
  const toggle = itemActions.get("Echo axe").Toggle;
  toggle({ player: who.relic });
  const fletching = xp(who.relic, Skill.FLETCHING);
  assert.equal(gather(who.relic, I.LOGS, 1, Skill.WOODCUTTING, 25).stored, 1);
  assert.equal(banked(who.relic, I.ARROW_SHAFT), 15, "fletched into shafts for the bank");
  assert.ok(xp(who.relic, Skill.FLETCHING) > fletching);
  toggle({ player: who.relic });
  assert.equal(gather(who.relic, I.LOGS, 1, Skill.WOODCUTTING, 25).stored, 1);
  assert.equal(banked(who.relic, I.LOGS), 1, "off: the log itself is banked");
  assert.equal(gather(who.relic, I.IRON_ORE, 1, Skill.MINING, 35).stored, 0, "not another skill's take");
  assert.equal(emit("firemaking:light-roll", { player: who.relic, success: false }).success, true);
  for (const player of others(who)) {
    assert.equal(gather(player, I.LOGS, 1, Skill.WOODCUTTING, 25).stored, 0, `${player.getUsername()} keeps the log`);
    assert.equal(emit("firemaking:light-roll", { player, success: false }).success, false);
  }
});

test("Animal Wrangler: the harpoon as any tool, a tick faster, a second chance, fish banked and half cooked, never burning", () => {
  const who = cases(ANIMAL_WRANGLER, 5);
  const rolls = [];
  Math.random = () => rolls.shift() ?? 0.5;
  rolls.push(0.2);
  assert.equal(emit("fishing:attempt", { player: who.relic, success: false }).success, true);
  rolls.push(0.2);
  assert.equal(emit("fishing:attempt", { player: who.other, success: false }).success, false);
  rolls.length = 0;
  assert.equal(emit("fishing:interval", { player: who.relic, ticks: 5 }).ticks, 4);
  assert.equal(emit("fishing:interval", { player: who.without, ticks: 5 }).ticks, 5);

  assert.equal(emit("fishing:tool", { player: who.relic, variants: [], variant: null }).variant, null, "no harpoon in hand, no tool");
  who.relic.getInventory().adds(I.ECHO_HARPOON, 1);
  assert.deepEqual(emit("fishing:tool", { player: who.relic, variants: [], variant: null }).variant, { ids: [I.ECHO_HARPOON], level: 1, bonus: 135 });
  who.main.getInventory().adds(I.ECHO_HARPOON, 1);
  assert.equal(emit("fishing:tool", { player: who.main, variants: [], variant: null }).variant, null);

  const cooking = xp(who.relic, Skill.COOKING);
  rolls.push(0.2);
  assert.equal(gather(who.relic, I.RAW_SHRIMPS, 1, Skill.FISHING, 10).stored, 1);
  assert.deepEqual([banked(who.relic, I.SHRIMPS), banked(who.relic, I.RAW_SHRIMPS)], [1, 0], "a 20 cooks it");
  assert.ok(xp(who.relic, Skill.COOKING) > cooking);
  rolls.push(0.7);
  gather(who.relic, I.RAW_SHRIMPS, 1, Skill.FISHING, 10);
  assert.deepEqual([banked(who.relic, I.SHRIMPS), banked(who.relic, I.RAW_SHRIMPS)], [1, 1], "a 70 leaves it raw");
  assert.equal(gather(who.relic, I.RAW_KARAMBWANJI, 5, Skill.FISHING, 5).stored, 0, "karambwanji stay with the player");
  rolls.push(0.2);
  gather(who.relic, I.BIG_SHARK, 1, Skill.FISHING, 110);
  assert.equal(banked(who.relic, I.BIG_SHARK), 1, "a trophy fish is never cooked");
  itemActions.get("Echo harpoon").Toggle({ player: who.relic });
  rolls.push(0.2);
  gather(who.relic, I.RAW_SHRIMPS, 1, Skill.FISHING, 10);
  assert.equal(banked(who.relic, I.RAW_SHRIMPS), 2, "off: raw");
  assert.equal(emit("cooking:burn", { player: who.relic, rawId: I.RAW_SHRIMPS, itemId: I.SHRIMPS, burn: true }).burn, false);
  assert.equal(emit("hunter:catch-chance", { player: who.relic, npcId: 1, chance: 0.3 }).chance, 1);
  assert.equal(emit("hunter:jar-kept", { player: who.relic, kept: false }).kept, true);
  assert.deepEqual(emit("hunter:rewards", { player: who.relic, kind: "box", npcId: 1, rewards: [[I.CHINCHOMPA, 1]], xp: 198.5 }).rewards, [[I.CHINCHOMPA, 2]]);
  for (const player of others(who)) {
    assert.equal(gather(player, I.RAW_SHRIMPS, 1, Skill.FISHING, 10).stored, 0, `${player.getUsername()} keeps the fish`);
    assert.equal(emit("cooking:burn", { player, rawId: I.RAW_SHRIMPS, itemId: I.SHRIMPS, burn: true }).burn, true);
  }
  // The other league's slot is Trickster, which shares the hunter effects.
  for (const player of [who.without, who.main]) assert.equal(emit("hunter:catch-chance", { player, npcId: 1, chance: 0.3 }).chance, 0.3);
});

test("Corner Cutter: sure agility, two laps and 25% more a lap, 10,000 coins with a mark", () => {
  const who = cases(CORNER_CUTTER, 5);
  assert.equal(emit("agility:roll", { player: who.relic, objectId: 1, success: false }).success, true);
  const lap = emit("agility:lap-reward", { player: who.relic, course: "gnome", count: 1, xp: 39.5 });
  assert.deepEqual([lap.count, lap.xp], [2, 49.375]);
  const mark = emit("agility:mark", { player: who.relic, location: new Location(3200, 3200, 0), items: [[I.MARK_OF_GRACE, 1]] });
  assert.deepEqual(mark.items, [[I.MARK_OF_GRACE, 1], [I.COINS, 10000]]);
  for (const player of others(who)) {
    assert.equal(emit("agility:roll", { player, objectId: 1, success: false }).success, false, `${player.getUsername()} rolls as usual`);
    assert.deepEqual(emit("agility:lap-reward", { player, course: "gnome", count: 1, xp: 39.5 }).count, 1);
    assert.deepEqual(emit("agility:mark", { player, location: new Location(3200, 3200, 0), items: [[I.MARK_OF_GRACE, 1]] }).items, [[I.MARK_OF_GRACE, 1]]);
  }
});

test("Dodgy Deals: sure thieving, loot noted and multiplied by the crowd, tripled pouches, repeats, stalls that never run out", () => {
  const who = cases(DODGY_DEALS, 5);
  const target = { name: "Man", low: 50, high: 240, xp: 8 };
  const picked = emit("thieving:pickpocket-target", { player: who.relic, target, unconscious: false, pouchLimit: 28 });
  assert.deepEqual([picked.target.low, picked.target.high, picked.pouchLimit], [256, 256, 84]);
  const npc = (id, x, y, hitpoints = 10) => ({ getId: () => id, getHitpoints: () => hitpoints, getLocation: () => new Location(x, y, 0) });
  const man = npc(3106, 3201, 3200);
  who.relic.getLocalNpcs().push(man, npc(3106, 3204, 3203), npc(3106, 3190, 3200), npc(3107, 3201, 3201), npc(3106, 3202, 3202, 0));
  const notedLogs = core.ItemDefinition.forId(I.LOGS).getNoteId();
  const loot = emit("thieving:loot", { player: who.relic, npc: man, target: "Man", loot: [{ id: I.LOGS, amount: 2 }, { id: I.COINS, amount: 40 }, { id: I.CLUE_SCROLL_EASY_, amount: 1, clue: true }] });
  assert.deepEqual(loot.loot, [{ id: notedLogs, amount: 4 }, { id: I.COINS, amount: 40 }, { id: I.COINS, amount: 40 }, { id: I.CLUE_SCROLL_EASY_, amount: 1, clue: true }],
    "two men within 5 tiles (not the far one, the other kind, or the dead one): twice, noted; coins a pouch each; a clue once");
  assert.equal(emit("thieving:done", { player: who.relic, kind: "pickpocket", npc: man, succeeded: true, again: false }).again, true);
  assert.equal(emit("thieving:done", { player: who.relic, kind: "stall", object: {}, succeeded: true, again: false }).again, true);
  assert.equal(emit("thieving:deplete-stall", { player: who.relic, object: {}, handled: false }).handled, true);
  for (const player of others(who)) {
    assert.equal(emit("thieving:pickpocket-target", { player, target, unconscious: false, pouchLimit: 28 }).pouchLimit, 28, `${player.getUsername()} as usual`);
    assert.deepEqual(emit("thieving:loot", { player, npc: man, target: "Man", loot: [{ id: I.LOGS, amount: 2 }] }).loot, [{ id: I.LOGS, amount: 2 }]);
    assert.equal(emit("thieving:done", { player, kind: "stall", object: {}, succeeded: true, again: false }).again, false);
    assert.equal(emit("thieving:deplete-stall", { player, object: {}, handled: false }).handled, false);
  }
});
