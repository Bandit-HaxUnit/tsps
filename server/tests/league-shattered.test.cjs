// Run after `yarn build`: node --test tests/league-shattered.test.cjs
// Leagues III - Shattered Relics' own screens (docs/leagues.md "Shattered Relics"): the side panel
// (736) the journal mounts for it, Sage's Renown, the starting class choice (737), the fragments
// screen (735) and the unlocks screen (733), with real players and real saves.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");
const { GameConstants } = require("../dist/game/GameConstants");

const uid = (group, child) => (group << 16) | child;
const OP1 = 1 << 1;
const OP2 = 1 << 2;
const SIDE_PANEL = 736;
const CLASS = 737;
const FRAGMENTS = 735;
const UNLOCKS = 733;
const RENOWN = 3276;
const CLASS_VARP = 3345;
const TAB_VARP = 3343;
const ENTRY_VARP = 3344;
const SLOT_VARBITS = [13395, 13396, 13397, 13398, 13399, 13401, 13402];
const fragmentVarbit = (id) => 13403 + id - 1;

let core;
const hooks = {};
const custom = {};
let worldLeague = 3;
const tasks = [];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  GameConstants.setWorldProfile("league");
  const lists = {};
  const on = (name) => (handler) => {
    (lists[name] ??= []).push(handler);
    hooks[name] = (event) => {
      let result;
      for (const attached of lists[name]) {
        const answer = attached(event);
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
    // As PluginManager runs them: the first handler that doesn't return false takes the click.
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
    onCustomEvent: (name, handler) => (custom[name] = (custom[name] ?? []).concat(handler)),
    emitCustomEvent: (name, payload) => {
      for (const handler of custom[name] ?? []) handler(payload);
    },
  }, { get: (target, key) => (key in target ? target[key] : on(String(key))) });
  require("../plugins/modes/LeagueMode.plugin").register(api);
  require("../plugins/modes/LeaguePoints.plugin").register(api);
});

/** A real league character whose packets are recorded, logged in on a world running `league`. */
function character(name, { league = 3, restore = null } = {}) {
  const player = new Player(null);
  player.setUsername(name);
  player.setProfile("league");
  if (restore) restore.applyToPlayer(player);
  const sent = { messages: [], varbits: new Map(), varps: new Map(), subs: [], flags: [] };
  const sender = new Proxy({}, {
    get: (target, key) => {
      switch (key) {
        case "sendVarbit": return (id, value) => (sent.varbits.set(id, value), sender);
        case "sendConfig": return (id, value) => (sent.varps.set(id, value), sender);
        case "sendInterface": return (group) => (player.setInterfaceId(group), sent.subs.push(["main", group]), sender);
        case "sendSubInterface": return (targetUid, group) => (sent.subs.push([targetUid, group]), sender);
        case "sendInterfaceRemoval": return () => (player.setInterfaceId(-1), sent.subs.push(["closed"]), sender);
        case "sendInterfaceFlagsRange": return (...args) => (sent.flags.push(args), sender);
        default: return () => sender;
      }
    },
  });
  player.getPacketSender = () => sender;
  player.sendMessage = (text) => sent.messages.push(text);
  const previous = worldLeague;
  worldLeague = league;
  hooks.onPlayerLogin({ player, username: name, isNewAccount: !restore, profile: "league" });
  worldLeague = previous;
  return Object.assign(player, { sent });
}

function runTasks() {
  for (const task of tasks.splice(0)) task.execute();
}

function click(player, group, child, extra = {}) {
  return hooks[`button:${uid(group, child)}`]({ player, buttonId: uid(group, child), ...extra });
}

function emit(name, payload) {
  for (const handler of custom[name] ?? []) handler(payload);
  return payload;
}

function points(player, amount) {
  hooks["command:leaguetask"]({ player, parts: ["leaguetask", `task-${amount}-${Math.random()}`, String(amount)] });
}

/** A character past the class choice (Warrior), with the screen closed. */
function settled(name) {
  const player = character(name);
  tasks.length = 0;
  player.setInterfaceId(CLASS);
  click(player, CLASS, 6);
  click(player, CLASS, 26);
  return player;
}

test("the journal mounts Shattered Relics' own side panel; other leagues keep 656", () => {
  const shattered = settled("journal-3");
  click(shattered, 629, 34);
  assert.deepEqual(shattered.sent.subs.at(-1), [uid(629, 43), SIDE_PANEL]);
  const echoes = character("journal-5", { league: 5 });
  worldLeague = 5;
  try {
    click(echoes, 629, 34);
    assert.deepEqual(echoes.sent.subs.at(-1), [uid(629, 43), 656]);
  } finally {
    worldLeague = 3;
  }
});

test("the side panel's buttons open Info, the task list, fragments and unlocks", () => {
  const player = settled("panel");
  click(player, SIDE_PANEL, 21);
  assert.deepEqual(player.sent.subs.at(-1), ["main", 654], "the Info panel");
  const opened = [];
  const listen = (event) => opened.push(event.player);
  custom["league:open-tasks"] = (custom["league:open-tasks"] ?? []).concat(listen);
  click(player, SIDE_PANEL, 25);
  assert.deepEqual(opened, [player], "the task list's open event");
  click(player, SIDE_PANEL, 30);
  assert.deepEqual(player.sent.subs.at(-1), ["main", FRAGMENTS]);
  assert.deepEqual(player.sent.flags.slice(-2), [[uid(FRAGMENTS, 18), 0, 476, OP1 | OP2], [uid(FRAGMENTS, 36), 0, 41, OP1 | OP2]],
    "53 fragments x 9 children, 7 slots x 6 children");
  click(player, SIDE_PANEL, 35);
  assert.deepEqual(player.sent.subs.at(-1), ["main", UNLOCKS]);
  assert.deepEqual(player.sent.flags.slice(-2), [[uid(UNLOCKS, 9), 0, 26, OP1], [uid(UNLOCKS, 18), 0, 239, OP1]]);
  assert.equal(player.sent.varps.get(TAB_VARP), 0);
});

test("Sage's Renown is awarded, spent all or nothing, and sent as varp 3276", () => {
  const player = settled("renown");
  assert.equal(player.sent.varps.get(RENOWN), 0, "sent at login");
  assert.equal(emit("league:award-renown", { player, amount: 25 }).awarded, true);
  assert.equal(player.sent.varps.get(RENOWN), 25);
  assert.equal(emit("league:spend-renown", { player, amount: 30 }).spent, false, "not more than it has");
  assert.equal(emit("league:spend-renown", { player, amount: 10 }).spent, true);
  assert.equal(emit("league:renown", { player }).renown, 15);
  hooks["command:renown"]({ player, parts: ["renown", "5"] });
  assert.equal(player.sent.varps.get(RENOWN), 20);
  assert.match(player.sent.messages.at(-1), /Granted 5 Sage's Renown/);
  const echoes = character("renown-5", { league: 5 });
  assert.equal(emit("league:award-renown", { player: echoes, amount: 5 }).awarded, false, "only Shattered Relics has renown");
});

test("a new character chooses a class: select, decline, accept", () => {
  const player = character("warrior");
  assert.equal(player.sent.subs.some(([, group]) => group === CLASS), false, "after the login's other packets");
  runTasks();
  assert.deepEqual(player.sent.subs.at(-1), ["main", CLASS]);
  click(player, CLASS, 11);
  assert.equal(player.sent.varps.get(CLASS_VARP), 2, "Ranger's confirm panel");
  click(player, CLASS, 23);
  assert.equal(player.sent.varps.get(CLASS_VARP), 0, "Decline");
  click(player, CLASS, 26);
  assert.equal(player.getAttribute("league:class") ?? 0, 0, "Accept with nothing selected does nothing");
  click(player, CLASS, 6);
  click(player, CLASS, 26);
  assert.equal(player.getAttribute("league:class"), 1);
  assert.equal(player.sent.varbits.get(13344), 1, "Attack unlocked (script 5830)");
  assert.equal(player.sent.varbits.get(fragmentVarbit(1)), 1, "Unholy Warrior owned, level 1");
  assert.equal(CacheDefinitions.getItem(1325).name, "Steel scimitar");
  assert.equal(player.getInventory().contains(1325), true);
  assert.deepEqual(player.sent.subs.at(-1), ["closed"]);

  const again = character("warrior", { restore: PlayerSave.fromPlayer(player) });
  runTasks();
  assert.equal(again.sent.subs.some(([, group]) => group === CLASS), false, "never offered again");
});

test("the other classes' items, skills and fragments", () => {
  for (const [select, skillVarbit, fragment, items] of [[11, 13346, 4, [845, 884]], [16, 13347, 6, [1379, 556, 558]]]) {
    const player = character(`class-${select}`);
    runTasks();
    click(player, CLASS, select);
    click(player, CLASS, 26);
    assert.equal(player.sent.varbits.get(skillVarbit), 1);
    assert.equal(player.sent.varbits.get(fragmentVarbit(fragment)), 1);
    for (const item of items) assert.equal(player.getInventory().contains(item), true, `item ${item}`);
  }
  assert.deepEqual([845, 884, 1379, 556, 558].map((item) => CacheDefinitions.getItem(item).name),
    ["Oak longbow", "Iron arrow", "Staff", "Air rune", "Mind rune"]);
});

test("fragments: equip owned ones into open slots, unequip, unequip all, and keep them over a relog", () => {
  const player = settled("fragments");
  emit("league:grant-fragment", { player, id: 4 });
  emit("league:grant-fragment", { player, id: 6 });
  click(player, SIDE_PANEL, 30);
  const equip = (id) => click(player, FRAGMENTS, 18, { slot: 9 * (id - 1), opId: 2 });
  equip(1);
  assert.equal(player.sent.varbits.get(SLOT_VARBITS[0]), 1, "Unholy Warrior in slot 1");
  equip(4);
  assert.equal(player.sent.varbits.get(SLOT_VARBITS[1]) ?? 0, 0, "no second slot at 0 points (enum 4127)");
  points(player, 300);
  equip(4);
  equip(6);
  equip(1);
  assert.deepEqual(SLOT_VARBITS.slice(0, 3).map((varbit) => player.sent.varbits.get(varbit)), [1, 4, 6], "three slots at 300 points; no duplicates");
  equip(9);
  assert.equal(player.sent.varbits.get(SLOT_VARBITS[3]) ?? 0, 0, "an unowned fragment can't go in");
  click(player, FRAGMENTS, 36, { slot: 6 * 1 + 1, opId: 2 });
  assert.equal(player.sent.varbits.get(SLOT_VARBITS[1]), 0, "Unequip slot 2");

  const again = character("fragments", { restore: PlayerSave.fromPlayer(player) });
  assert.equal(again.sent.varbits.get(SLOT_VARBITS[0]), 1, "the loadout survives a relog");
  assert.equal(again.sent.varbits.get(SLOT_VARBITS[2]), 6);
  assert.equal(again.sent.varbits.get(fragmentVarbit(4)), 1);

  click(player, FRAGMENTS, 16);
  assert.deepEqual(SLOT_VARBITS.map((varbit) => player.sent.varbits.get(varbit)), [0, 0, 0, 0, 0, 0, 0], "Unequip all");
  player.getPacketSender().sendInterfaceRemoval();
  equip(1);
  assert.equal(player.sent.varbits.get(SLOT_VARBITS[0]), 0, "nothing with the screen closed");
});

test("unlocks: tabs, entries, and Accept paid in renown", () => {
  const player = settled("unlocker");
  const skills = [...CacheDefinitions.getEnumValues(4129).entries()].sort(([a], [b]) => a - b)
    .map(([, struct]) => CacheDefinitions.getStructParams(Number(struct)));
  const agility = skills.findIndex((params) => params.get(1437) === "Agility");
  click(player, SIDE_PANEL, 35);
  click(player, UNLOCKS, 18, { slot: 12 * agility + 9 });
  assert.equal(player.sent.varps.get(ENTRY_VARP), agility + 1);
  click(player, UNLOCKS, 47);
  assert.equal(player.sent.varbits.get(13350), 0, "no renown, no unlock");
  emit("league:award-renown", { player, amount: 12 });
  click(player, UNLOCKS, 47);
  assert.equal(player.sent.varbits.get(13350), 1, "Agility unlocked (script 5830: skill 16)");
  assert.equal(emit("league:renown", { player }).renown, 7, "it cost 5 (struct param 1442)");
  assert.equal(player.sent.varps.get(TAB_VARP), 0, "the tab varp is resent to hide the confirm panel");
  click(player, UNLOCKS, 47);
  assert.equal(emit("league:renown", { player }).renown, 7, "an unlocked skill isn't bought twice");

  click(player, UNLOCKS, 9, { slot: 9 });
  assert.equal(player.sent.varps.get(TAB_VARP), 1, "the Bosses tab");
  assert.equal(player.sent.varps.get(ENTRY_VARP), 0);
  const bosses = [...CacheDefinitions.getEnumValues(4130).entries()].sort(([a], [b]) => a - b)
    .map(([, struct]) => CacheDefinitions.getStructParams(Number(struct)));
  const obor = bosses.findIndex((params) => params.get(1437) === "Obor");
  click(player, UNLOCKS, 18, { slot: 5 * obor });
  click(player, UNLOCKS, 47);
  assert.equal(player.sent.varbits.get(13367), 1, "Obor (NPC 7416, script 5831)");
  assert.equal(emit("league:renown", { player }).renown, 2);
  assert.deepEqual(emit("league:unlocks", { player }).bosses, [7416]);
});

test("quest packs: prices include incomplete prerequisites, and a pack unlocks its prerequisites", () => {
  const { questPrice } = require("../plugins/modes/league/Unlocks.LeagueMode")._test;
  assert.equal(questPrice("Elf II", new Set()), 31, "the Wiki's Initial Cost");
  assert.equal(questPrice("Elf II", new Set(["Elf I"])), 23, "less Elf I's 8");
  assert.equal(questPrice("Elf III", new Set(["Elf I", "Elf II"])), 29, "less Elf II's 31 only: it includes Elf I");
  assert.equal(questPrice("Legends", new Set(["Heroes", "Karamja I", "Elf I"])), 16, "47 less 16, 7 and 8");
  assert.equal(questPrice("Elf I", new Set(["Elf I"])), 0, "0 = unlocked (script 5816)");

  const player = settled("quester");
  const packs = [...CacheDefinitions.getEnumValues(4131).entries()].sort(([a], [b]) => a - b)
    .map(([, struct]) => CacheDefinitions.getStructParams(Number(struct)));
  const elf2 = packs.findIndex((params) => params.get(1437) === "Elf II");
  const varbitOf = (name) => 13544 + packs.find((params) => params.get(1437) === name).get(1444);
  assert.equal(player.sent.varbits.get(varbitOf("Elf II")), 31, "prices go out at login");
  emit("league:award-renown", { player, amount: 40 });
  click(player, SIDE_PANEL, 35);
  click(player, UNLOCKS, 9, { slot: 18 });
  click(player, UNLOCKS, 18, { slot: 6 * elf2 });
  click(player, UNLOCKS, 47);
  assert.equal(emit("league:renown", { player }).renown, 9);
  assert.equal(player.sent.varbits.get(varbitOf("Elf II")), 0);
  assert.equal(player.sent.varbits.get(varbitOf("Elf I")), 0, "its prerequisite comes with it");
  assert.equal(player.sent.varbits.get(varbitOf("Elf III")), 29);
  assert.deepEqual(emit("league:unlocks", { player }).quests.sort(), ["Elf I", "Elf II"]);
});

test("another league's character sees none of it", () => {
  const echoes = character("echoes", { league: 5 });
  worldLeague = 5;
  try {
    runTasks();
    assert.equal(echoes.sent.subs.some(([, group]) => group === CLASS), false, "no class choice");
    assert.equal(echoes.sent.varps.has(RENOWN), false);
    echoes.setInterfaceId(FRAGMENTS);
    assert.equal(click(echoes, FRAGMENTS, 18, { slot: 0, opId: 2 }), false, "the click falls through");
  } finally {
    worldLeague = 3;
  }
});
