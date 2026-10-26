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
  const sent = { messages: [], varbits: new Map(), varps: new Map(), varpLog: [], subs: [], flags: [], hidden: [] };
  const sender = new Proxy({}, {
    get: (target, key) => {
      switch (key) {
        case "sendVarbit": return (id, value) => (sent.varbits.set(id, value), sender);
        case "sendConfig": return (id, value) => (sent.varps.set(id, value), sent.varpLog.push([id, value]), sender);
        case "sendInterface": return (group) => (player.setInterfaceId(group), sent.subs.push(["main", group]), sender);
        case "sendSubInterface": return (targetUid, group) => (sent.subs.push([targetUid, group]), sender);
        case "sendInterfaceRemoval": return () => {
          const closed = player.getInterfaceId();
          player.setInterfaceId(-1);
          sent.subs.push(["closed"]);
          emit("interface:closed", { player, interfaceId: closed });
          return sender;
        };
        case "sendInterfaceFlagsRange": return (...args) => (sent.flags.push(args), sender);
        case "sendInterfaceDisplayState": return (target, hide) => (sent.hidden.push([target, hide]), sender);
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
  assert.deepEqual(player.sent.flags.slice(-2), [[uid(UNLOCKS, 9), 0, 26, OP1], [uid(UNLOCKS, 18), 0, 239, OP1]],
    "skills 20 x 12 children is the longest list (bosses 31 x 4, quests 36 x 5)");
  assert.equal(player.sent.varps.has(TAB_VARP), false, "nothing with the open itself");
  runTasks();
  assert.deepEqual(player.sent.hidden.at(-1), [uid(UNLOCKS, 40), true], "a tick later the confirm panel the open showed is hidden");
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

test("the class choice waits for the welcome screen, comes back if closed, and again after a relog", () => {
  const player = character("undecided");
  emit("welcome-screen:shown", { player });
  runTasks();
  assert.equal(player.sent.subs.some(([, group]) => group === CLASS), false, "not over the welcome screen");
  click(player, 378, 72);
  runTasks();
  assert.deepEqual(player.sent.subs.at(-1), ["main", CLASS], "after its Play");
  player.getPacketSender().sendInterfaceRemoval();
  runTasks();
  assert.deepEqual(player.sent.subs.at(-1), ["main", CLASS], "closed without a class, it opens again");
  const again = character("undecided", { restore: PlayerSave.fromPlayer(player) });
  runTasks();
  assert.deepEqual(again.sent.subs.at(-1), ["main", CLASS], "and after a relog");
});

test("class items that don't fit go to the bank", () => {
  const player = character("packed");
  runTasks();
  for (let slot = 0; slot < 28; slot++) player.getInventory().adds(1511, 1);
  click(player, CLASS, 11);
  click(player, CLASS, 26);
  assert.equal(player.getInventory().contains(884), false);
  assert.equal(player.getBanks().some((bank) => bank?.getAmount?.(884) === 150), true, "150 iron arrows in the bank");
  assert.equal(player.getBanks().some((bank) => bank?.contains?.(845)), true, "and the oak longbow");
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
  click(player, UNLOCKS, 18, { slot: 12 * agility });
  assert.equal(player.sent.varps.get(ENTRY_VARP), agility + 1);
  click(player, UNLOCKS, 47);
  assert.equal(player.sent.varbits.get(13350), 0, "no renown, no unlock");
  emit("league:award-renown", { player, amount: 12 });
  click(player, UNLOCKS, 18, { slot: 12 * agility });
  tasks.length = 0;
  click(player, UNLOCKS, 47);
  assert.equal(player.sent.varbits.get(13350), 1, "Agility unlocked (script 5830: skill 16)");
  assert.equal(emit("league:renown", { player }).renown, 7, "it cost 5 (struct param 1442)");
  assert.deepEqual(player.sent.varpLog.at(-1), [ENTRY_VARP, 0], "no entry: the list redraws with the unlock");
  runTasks();
  assert.deepEqual(player.sent.hidden.at(-1), [uid(UNLOCKS, 40), true], "and the confirm panel is hidden a tick later");
  click(player, UNLOCKS, 47);
  assert.equal(emit("league:renown", { player }).renown, 7, "an unlocked skill isn't bought twice");

  click(player, UNLOCKS, 9, { slot: 9 });
  assert.equal(player.sent.varps.get(TAB_VARP), 1, "the Bosses tab");
  assert.equal(player.sent.varps.get(ENTRY_VARP), 0);
  const bosses = [...CacheDefinitions.getEnumValues(4130).entries()].sort(([a], [b]) => a - b)
    .map(([, struct]) => CacheDefinitions.getStructParams(Number(struct)));
  const obor = bosses.findIndex((params) => params.get(1437) === "Obor");
  click(player, UNLOCKS, 18, { slot: 4 * obor });
  click(player, UNLOCKS, 47);
  assert.equal(player.sent.varbits.get(13367), 1, "Obor (NPC 7416, script 5831)");
  assert.equal(emit("league:renown", { player }).renown, 2);
  assert.deepEqual(emit("league:unlocks", { player }).bosses, [7416]);
});

test("every tab's entries are clickable where scripts 5813 / 5815 / 5817 put Select (12, 4 and 5 children apart)", () => {
  const player = settled("rows");
  click(player, SIDE_PANEL, 35);
  for (const [tab, table, spacing] of [[0, 4129, 12], [1, 4130, 4], [2, 4131, 5]]) {
    click(player, UNLOCKS, 9, { slot: 9 * tab });
    const count = CacheDefinitions.getEnumValues(table).size;
    for (const entry of [0, Math.floor(count / 2), count - 1]) {
      click(player, UNLOCKS, 18, { slot: spacing * entry });
      assert.equal(player.sent.varps.get(ENTRY_VARP), entry + 1, `tab ${tab}, entry ${entry}`);
    }
    const before = player.sent.varps.get(ENTRY_VARP);
    click(player, UNLOCKS, 18, { slot: spacing * count });
    click(player, UNLOCKS, 18, { slot: spacing + 1 });
    assert.equal(player.sent.varps.get(ENTRY_VARP), before, "a child that isn't an entry's Select, or past the list, is ignored");
  }
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
  click(player, UNLOCKS, 18, { slot: 5 * elf2 });
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
    echoes.setInterfaceId(UNLOCKS);
    assert.equal(click(echoes, UNLOCKS, 18, { slot: 0 }), false);
    assert.equal(click(echoes, UNLOCKS, 47), false);
    echoes.setInterfaceId(CLASS);
    assert.equal(click(echoes, CLASS, 6), false);
    assert.equal(click(echoes, CLASS, 26), false);
    for (const child of [21, 25, 30, 35]) assert.equal(click(echoes, SIDE_PANEL, child), false, `736:${child}`);
  } finally {
    worldLeague = 3;
  }
});

// ---- The locks and renown from tasks ----

function gainXp(player, skill) {
  const event = { player, skill: core.Skill[skill], experience: 100, allow: null, multiplier: 1 };
  hooks.onCanGainExperience(event);
  return event.allow !== false;
}

/** A stand-in NPC with the cache's real definition for `id`. */
function npc(id) {
  const definition = core.NpcDefinition.forId(id);
  return { isNpc: () => true, isPlayer: () => false, getCurrentDefinition: () => definition, getDefinition: () => definition };
}

function attack(player, target) {
  const event = { attacker: player, target, allow: null };
  hooks.onCanAttack(event);
  return event.allow !== false;
}

/** The unlock entry for a boss name, as the client lists it. */
function bossEntry(name) {
  return [...CacheDefinitions.getEnumValues(4130).entries()].sort(([a], [b]) => a - b)
    .findIndex(([, struct]) => CacheDefinitions.getStructParams(Number(struct)).get(1437) === name);
}

function buyBoss(player, name, renown) {
  emit("league:award-renown", { player, amount: renown });
  click(player, SIDE_PANEL, 35);
  click(player, UNLOCKS, 9, { slot: 9 });
  click(player, UNLOCKS, 18, { slot: 4 * bossEntry(name) });
  click(player, UNLOCKS, 47);
  player.getPacketSender().sendInterfaceRemoval();
}

test("a locked skill gives no XP until it is unlocked; the starting skills and the class's always do", () => {
  const player = settled("trainer");
  assert.equal(gainXp(player, "WOODCUTTING"), false, "Woodcutting is locked (Wiki: trained, but no experience)");
  for (const skill of ["DEFENCE", "FISHING", "THIEVING", "ATTACK"]) assert.equal(gainXp(player, skill), true, `${skill} is unlocked`);
  assert.equal(gainXp(player, "SAILING"), true, "a skill outside the unlock list is untouched");
  const skills = [...CacheDefinitions.getEnumValues(4129).entries()].sort(([a], [b]) => a - b)
    .map(([, struct]) => CacheDefinitions.getStructParams(Number(struct)));
  const woodcutting = skills.findIndex((params) => params.get(1437) === "Woodcutting");
  emit("league:award-renown", { player, amount: 5 });
  click(player, SIDE_PANEL, 35);
  click(player, UNLOCKS, 18, { slot: 12 * woodcutting });
  click(player, UNLOCKS, 47);
  assert.equal(gainXp(player, "WOODCUTTING"), true, "unlocked, it gives XP");
  const echoes = character("trainer-5", { league: 5 });
  worldLeague = 5;
  try {
    assert.equal(gainXp(echoes, "WOODCUTTING"), true, "other leagues have no locks");
  } finally {
    worldLeague = 3;
  }
});

test("a locked boss can't be attacked by any of its NPCs until it is unlocked", () => {
  const player = settled("slayer");
  for (const id of [1672, 1673, 1674, 1675, 1676, 1677]) {
    assert.equal(attack(player, npc(id)), false, `${core.NpcDefinition.forId(id).getName()} is part of Barrows`);
  }
  assert.match(player.sent.messages.at(-1), /unlock Barrows with Sage's Renown/);
  assert.equal(attack(player, npc(2215)), false, "General Graardor");
  assert.equal(attack(player, npc(3029)), true, "a goblin isn't a boss");
  buyBoss(player, "Barrows", 15);
  assert.equal(attack(player, npc(1676)), true, "unlocked, the brothers can be fought");
  assert.equal(attack(player, npc(2215)), false, "the other bosses stay locked");
});

test("Nex can only be bought once every God Wars general is unlocked", () => {
  const player = settled("godwars");
  buyBoss(player, "Nex", 15);
  assert.deepEqual(emit("league:unlocks", { player }).bosses, [], "refused");
  assert.match(player.sent.messages.at(-1), /every God Wars Dungeon general/);
  assert.equal(emit("league:renown", { player }).renown, 15, "nothing spent");
  for (const general of ["General Graardor", "Commander Zilyana", "Kree'arra", "K'ril Tsutsaroth"]) buyBoss(player, general, 30);
  buyBoss(player, "Nex", 0);
  assert.equal(emit("league:unlocks", { player }).bosses.includes(11278), true, "then Nex can be bought");
});

test("a task's award pays its tier's renown, read from its points", () => {
  const player = settled("tasker");
  for (const [points, renown] of [[5, 1], [25, 2], [50, 3], [125, 4], [250, 5]]) {
    const before = emit("league:renown", { player }).renown;
    hooks["command:leaguetask"]({ player, parts: ["leaguetask", `tier-${points}`, String(points)] });
    assert.equal(emit("league:renown", { player }).renown - before, renown, `${points} points pay ${renown}`);
  }
  const before = emit("league:renown", { player }).renown;
  hooks["command:leaguetask"]({ player, parts: ["leaguetask", "odd", "7"] });
  assert.equal(emit("league:renown", { player }).renown, before, "an amount no tier pays nothing");
  assert.equal(player.sent.varps.get(RENOWN), before);
});
