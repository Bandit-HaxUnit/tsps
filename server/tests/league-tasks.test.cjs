// Run after `yarn build`: node --test tests/league-tasks.test.cjs
// League tasks (docs/leagues.md, Tasks): the catalog the client is sent, the task list's captured
// flow and filters, the award triggers (kills, levels, quests), the completion bits, the command,
// and that a main character sees none of it.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { GameConstants } = require("../dist/game/GameConstants");
const { Skill } = require("../dist/game/model/Skill");
const { SkillManager } = require("../dist/game/content/skill/SkillManager");

const catalog = require("../plugins/modes/data/league-tasks.json");
const list = require("../plugins/modes/data/league-task-list.json");

const TASKS = 657;
const SIDE_PANEL = 656;
const FLOATER = (161 << 16) | 18;
const OP1 = 1 << 1;
const uid = (group, child) => (group << 16) | child;
const TRL = catalog.leagues["4"].tasks;
const indexOf = (id) => TRL.findIndex((task) => task.id === id);
const bitVarp = (index) => completionVarps()[Math.floor(index / 32)];
function completionVarps() {
  const varps = [];
  for (const [first, last] of list.completionVarps) for (let id = first; id <= last; id++) varps.push(id);
  return varps;
}

let core;
const hooks = {};
const custom = {};
const emitted = [];
const completedQuests = new Set();
let worldLeague = 4; // the world's pluginConfig league:type (Trailblazer Reloaded)

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  GameConstants.setWorldProfile("league"); // a league world
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
    persistAttribute() {},
    getSkillManager: () => SkillManager,
    getPluginConfig: (key, fallback) => (key === "league:type" ? worldLeague : fallback),
    setWorldProfile: (profile) => GameConstants.setWorldProfile(profile),
    registerCommand: (name, handler) => (hooks[`command:${name}`] = handler),
    onInterfaceActionButton: (ids, handler) => {
      for (const id of [].concat(ids)) on(`button:${id}`)(handler);
    },
    onCustomEvent: (name, handler) => (custom[name] = (custom[name] ?? []).concat(handler)),
    emitCustomEvent: (name, payload) => {
      emitted.push([name, payload]);
      for (const handler of custom[name] ?? []) handler(payload);
    },
  }, { get: (target, key) => (key in target ? target[key] : on(String(key))) });
  // Stands in for QuestRuntime's answer.
  custom["quest:is-complete"] = [(request) => { request.complete = completedQuests.has(request.name); }];
  require("../plugins/modes/LeagueMode.plugin").register(api);
  require("../plugins/modes/LeaguePoints.plugin").register(api);
  require("../plugins/modes/LeagueTasks.plugin").register(api);
});

/** A real player whose packets are recorded in order; logged in as a new character of `profile`. */
function character(name, profile = "league", { login = true } = {}) {
  const player = new Player(null);
  player.setUsername(name);
  player.setProfile(profile);
  const sent = { messages: [], varbits: new Map(), varps: new Map(), order: [], subs: [], flags: [], content: [], removals: 0, closed: [] };
  const sender = new Proxy({}, {
    get: (target, key) => {
      switch (key) {
        case "sendVarbit": return (id, value) => (sent.varbits.set(id, value), sent.order.push(["varbit", id, value]), sender);
        case "sendConfig": return (id, value) => (sent.varps.set(id, value), sent.order.push(["varp", id, value]), sender);
        case "sendSubInterface": return (...args) => (sent.subs.push(args), sender);
        case "sendInterface": return (group) => (sent.subs.push(["main", group]), sender);
        case "sendInterfaceFlagsRange": return (...args) => (sent.flags.push(args), sender);
        case "sendContentData": return (source, datasets) => (sent.content.push(datasets), sender);
        case "sendInterfaceRemoval": return () => (sent.removals++, sender);
        case "closeInterface": return (group) => (sent.closed.push(group), sender);
        default: return () => sender;
      }
    },
  });
  player.getPacketSender = () => sender;
  player.sendMessage = (text) => (sent.messages.push(text), sent.order.push(["message", text]));
  if (login) hooks.onPlayerLogin({ player, username: name, isNewAccount: true, profile });
  return Object.assign(player, { sent });
}

const dataset = (player, key) => player.sent.content.flatMap((datasets) => datasets).filter((entry) => entry.key === key).at(-1)?.rows;
const completed = (player) => Object.keys(player.getAttribute("league:tasks") ?? {});
const points = (player) => { const query = { player, points: 0, tasks: 0 }; for (const handler of custom["league:points"]) handler(query); return query.points; };
const npc = (name) => ({ getCurrentDefinition: () => ({ getName: () => name }), getMaxHitpoints: () => 10 });
const kill = (player, name) => hooks.onNpcDeath({ killer: player, npc: npc(name), npcId: 0, location: { x: 0, y: 0, z: 0 } });
function setLevel(player, skill, level) {
  const skills = player.getSkillManager();
  const previous = skills.getMaxLevel(skill);
  skills.setExperiences(skill, SkillManager.getExperienceForLevel(level), false);
  skills.setMaxLevels(skill, level, false);
  skills.setCurrentLevels(skill, level, false);
  return previous;
}
const levelUp = (player, skill, level) => hooks.onPlayerLevelUp({ player, skill, oldLevel: setLevel(player, skill, level), newLevel: level });

test("the catalog is sound: the Wiki's counts and points, unique ids, verified triggers", () => {
  const expected = { 4: { tiers: [269, 390, 385, 390, 46], medium: 40, total: 145490 }, 5: { tiers: [224, 536, 437, 345, 47], medium: 30, total: 141080 } };
  const kinds = new Set(["kill", "level", "any-level", "level-up", "total-level", "base-level", "combat-level", "quest"]);
  const npcNames = new Set();
  // The cache's own list (enum 5950's rows): a task it has by name takes its category.
  const cacheRows = new Map();
  for (const rowId of CacheDefinitions.getEnumValues(5950).values()) {
    const row = CacheDefinitions.getDbRow(rowId);
    if (row) cacheRows.set(String(row.columns.get(0)?.[0]).toLowerCase(), row);
  }
  assert.ok(cacheRows.size > 1500, "the cache's task list");
  for (const [type, league] of Object.entries(catalog.leagues)) {
    const { tasks } = league;
    assert.deepEqual([1, 2, 3, 4, 5].map((tier) => tasks.filter((task) => task.tier === tier).length), expected[type].tiers, `Wiki: ${league.name}'s tasks per tier`);
    assert.equal(tasks.reduce((sum, task) => sum + task.points, 0), expected[type].total, `Wiki: ${league.name}'s total points`);
    assert.equal(tasks.find((task) => task.tier === 2).points, expected[type].medium);
    assert.equal(new Set(tasks.map((task) => task.id)).size, tasks.length, "ids are unique");
    assert.ok(tasks.length <= 1984, "within the client's completion bits");
    for (let i = 1; i < tasks.length; i++) assert.ok(tasks[i - 1].tier <= tasks[i].tier, "sorted by tier");
    for (const task of tasks) {
      assert.ok([1, 2, 3, 4, 5, 6].includes(task.category) && Object.values(catalog.areas).includes(task.area), task.id);
      const cached = cacheRows.get(task.name.toLowerCase());
      assert.equal(task.categorySource, cached ? "cache" : "rule", task.id);
      if (cached) assert.equal(task.category, cached.columns.get(35)?.[0], `${task.id}: the cache's category`);
      if (task.trigger) {
        assert.ok(kinds.has(task.trigger.kind), `${task.id}: ${task.trigger.kind}`);
        if (task.trigger.kind === "kill") npcNames.add(task.trigger.npc);
        if (task.trigger.kind === "level") assert.ok(Skill[task.trigger.skill] instanceof Skill, task.id);
      }
    }
  }
  const cacheNames = new Set();
  for (let id = 0; cacheNames.size < 20000 && id < 20000; id++) {
    try { cacheNames.add(CacheDefinitions.getNpc(id)?.name); } catch { break; }
  }
  for (const name of npcNames) assert.ok(cacheNames.has(name), `a cache NPC is called "${name}"`);
});

test("login sends the league's catalog as enum and DB row overrides, the completion varps and the saved filters", () => {
  const league = character("catalog");
  assert.equal(league.sent.content.length, 1, "one payload from LeagueMode's single sender");
  assert.deepEqual(league.sent.content[0].map((entry) => entry.key), ["structOverrides", "enumOverrides", "dbRowOverrides"], "the whole set, every dataset");
  const enums = dataset(league, "enumOverrides");
  const rows = dataset(league, "dbRowOverrides");
  const taskEnum = enums.find((row) => row.enumId === 5950);
  assert.equal(taskEnum.entries.length, 1480, "every Trailblazer Reloaded task, in order");
  assert.deepEqual(taskEnum.entries[35], [35, 340035], "position -> its row id");
  assert.deepEqual(enums.find((row) => row.enumId === 2671).entries, [[1, 10], [2, 40], [3, 80], [4, 200], [5, 400]], "Trailblazer Reloaded's tier points over the cache's Raging Echoes ones");
  assert.equal(rows.length, 1480);
  const goblin = rows.find((row) => row.rowId === 340000 + indexOf("defeat-a-goblin"));
  assert.equal(goblin.tableId, 118);
  assert.deepEqual(goblin.columns, { 0: ["Defeat a Goblin"], 1: ["Defeat a Goblin. After all, this still isn't the Goblin League."], 32: [1], 34: [1], 35: [2], 36: [0] });
  for (const varp of completionVarps()) assert.equal(league.sent.varps.get(varp), 0, `completion varp ${varp}`);
  assert.equal(completionVarps().length, 62);
  for (const filter of Object.values(list.filters)) assert.equal(league.sent.varbits.get(filter.varbit), 0, `filter varbit ${filter.varbit}`);
  assert.deepEqual(completed(league), [], "a new character has done nothing yet, Agility 10 included (its first-level tasks exclude the starting skills)");

  worldLeague = 5;
  const echoes = character("echoes");
  worldLeague = 4;
  assert.equal(dataset(echoes, "enumOverrides").find((row) => row.enumId === 5950).entries.length, 1589);
  assert.deepEqual(dataset(echoes, "enumOverrides").find((row) => row.enumId === 2671).entries[1], [2, 30]);
  assert.equal(dataset(echoes, "dbRowOverrides")[0].rowId, 350000, "a league's rows have their own ids");
});

test("View Tasks opens the list with the captured events; the dropdowns set and keep their filter varbits", () => {
  const league = character("viewer");
  assert.equal(hooks[`button:${uid(TASKS, 37)}`]({ player: league, slot: 3 }), false, "a dropdown click before View Tasks is ignored");
  const payloads = league.sent.content.length;
  assert.equal(hooks[`button:${uid(SIDE_PANEL, 36)}`]({ player: league }), true);
  assert.equal(league.sent.content.length, payloads + 1, "the content payload again, in case the client reloaded");
  assert.equal(dataset(league, "dbRowOverrides").length, 1480);
  assert.equal(league.sent.removals, 1, "the main modal is closed first");
  assert.deepEqual(league.sent.subs.at(-1), [FLOATER, TASKS, 1], "league_tasks in the toplevel floater as an overlay");
  assert.deepEqual(league.sent.flags, [
    [uid(TASKS, 37), 1, 7, OP1], [uid(TASKS, 38), 1, 8, OP1], [uid(TASKS, 39), 1, 15, OP1], [uid(TASKS, 40), 1, 7, OP1], [uid(TASKS, 42), 1, 4, OP1],
    [uid(TASKS, 18), 0, 1480, OP1], [uid(TASKS, 6), 10, 18, OP1],
  ], "if_setevents as captured, on this cache's dropdown lists and rows (the rows up to the task count)");
  assert.equal(hooks[`button:${uid(TASKS, 37)}`]({ player: league, slot: 3 }), true);
  assert.equal(league.sent.varbits.get(10033), 2, "captured: dropdown slot 3 -> league_task_filter_tier 2");
  assert.equal(hooks[`button:${uid(TASKS, 38)}`]({ player: league, slot: 2 }), true);
  assert.equal(league.sent.varbits.get(11689), 1, "captured: slot 2 -> league_task_filter_type 1");
  assert.equal(hooks[`button:${uid(TASKS, 42)}`]({ player: league, slot: 2 }), true);
  assert.equal(league.sent.varbits.get(10034), 1, "Incomplete");
  assert.equal(hooks[`button:${uid(TASKS, 39)}`]({ player: league, slot: 14 }), true);
  assert.equal(league.sent.varbits.get(11692), 13, "Unlocked areas");
  assert.equal(hooks[`button:${uid(TASKS, 40)}`]({ player: league, slot: 9 }), false, "no such slot");
  assert.deepEqual(league.getAttribute("league:task-filters"), { tier: 2, type: 1, completed: 1, area: 13 });
  assert.equal(hooks[`button:${uid(TASKS, 18)}`]({ player: league, slot: 11 }), true, "a row click is the client's expand; nothing to send");
  assert.equal(hooks[`button:${uid(TASKS, 3)}`]({ player: league }), true);
  assert.deepEqual(league.sent.closed, [TASKS]);
  assert.equal(hooks[`button:${uid(TASKS, 37)}`]({ player: league, slot: 1 }), false, "closed again");

  league.sent.varbits.clear();
  hooks.onPlayerLogin({ player: league, username: "viewer", isNewAccount: false, profile: "league" });
  assert.equal(league.sent.varbits.get(10033), 2, "the filters come back at login, as captured");
  assert.equal(league.sent.varbits.get(11692), 13);
});

test("a kill awards its task once: the completion bit first, then the points, then the captured message", () => {
  const league = character("slayer");
  const index = indexOf("defeat-a-goblin");
  league.sent.order.length = 0;
  kill(league, "Goblin");
  assert.deepEqual(completed(league), ["defeat-a-goblin"]);
  assert.equal(points(league), 10);
  assert.equal(league.sent.varps.get(bitVarp(index)), 1 << (index % 32), "its bit in the completion varp");
  const kinds = league.sent.order.map(([kind, id]) => (kind === "varp" ? `varp ${id}` : kind));
  assert.ok(kinds.indexOf(`varp ${bitVarp(index)}`) < kinds.indexOf("varp 2614"), "the bit before the points varp that redraws the list");
  assert.equal(league.sent.messages.at(-1), "Congratulations, you've completed an easy task: <col=FF7700>Defeat a Goblin</col>.");
  kill(league, "Goblin");
  assert.deepEqual(completed(league), ["defeat-a-goblin"], "once");
  assert.equal(points(league), 10);

  // A kill-count task and its longer sibling for the same NPC (Cerberus 50 and 150 times, say).
  const fifty = TRL.find((task) => task.trigger?.kind === "kill" && task.trigger.count === 50 && TRL.some((other) => other.trigger?.kind === "kill" && other.trigger.npc === task.trigger.npc && other.trigger.count === 150));
  const hundredFifty = TRL.find((task) => task.trigger?.kind === "kill" && task.trigger.npc === fifty.trigger.npc && task.trigger.count === 150);
  for (let i = 0; i < 49; i++) kill(league, fifty.trigger.npc);
  assert.equal(league.getAttribute("league:kill-counts")[fifty.trigger.npc.toLowerCase()], 49);
  assert.ok(!completed(league).includes(fifty.id));
  kill(league, fifty.trigger.npc);
  assert.ok(completed(league).includes(fifty.id), "the 50th kill");
  assert.ok(!completed(league).includes(hundredFifty.id));
  assert.equal(league.sent.messages.at(-1), `Congratulations, you've completed a ${catalog.tiers[fifty.tier - 1].toLowerCase()} task: <col=FF7700>${fifty.name}</col>.`);
  kill(league, "Unicorn");
  assert.equal(league.getAttribute("league:kill-counts").unicorn, undefined, "only names a task needs are counted");
});

test("level triggers fire on a level-up and are caught up at login", () => {
  const league = character("leveller");
  levelUp(league, Skill.ATTACK, 5);
  assert.ok(completed(league).includes("achieve-your-first-level-up"));
  assert.ok(completed(league).includes("achieve-your-first-level-5"), "Attack 5 counts; the starting Agility 10 did not");
  assert.ok(!completed(league).includes("achieve-your-first-level-10"));
  levelUp(league, Skill.ATTACK, 99);
  assert.ok(completed(league).includes("reach-level-99-attack"));
  assert.ok(completed(league).includes("achieve-your-first-level-95"));
  assert.ok(completed(league).includes("reach-combat-level-25"), "99 Attack is combat level 35");
  assert.ok(!completed(league).includes("reach-combat-level-50"));
  assert.ok(!completed(league).includes("reach-total-level-250"));
  for (const skill of Skill.values()) if (skill !== Skill.SAILING) setLevel(league, skill, 20);
  levelUp(league, Skill.COOKING, 21);
  assert.ok(completed(league).includes("reach-base-level-20"));
  assert.ok(completed(league).includes("reach-total-level-250"), "23 skills at 20 or more");

  const veteran = character("veteran", "league", { login: false });
  setLevel(veteran, Skill.MINING, 50);
  hooks.onPlayerLogin({ player: veteran, username: "veteran", isNewAccount: true, profile: "league" });
  assert.ok(completed(veteran).includes("achieve-your-first-level-50"), "already qualified at login");
  assert.ok(!completed(veteran).includes("achieve-your-first-level-up"), "a level-up itself is only ever an event");
});

test("a quest trigger fires on quest:completed by name and is caught up at login", () => {
  const league = character("quester");
  for (const handler of custom["quest:completed"]) handler({ player: league, key: "gertrudes-cat", quest: { name: "Gertrude's Cat" } });
  assert.deepEqual(completed(league), ["complete-gertrude-s-cat"]);
  completedQuests.add("Sheep Shearer");
  const shearer = character("shearer");
  completedQuests.clear();
  assert.deepEqual(completed(shearer), ["complete-sheep-shearer"]);
});

test("league:complete-task and ::leaguetask complete a catalog task once; a main character sees nothing", () => {
  const league = character("completer");
  const complete = (id) => { const request = { player: league, id }; for (const handler of custom["league:complete-task"]) handler(request); return request; };
  assert.deepEqual([complete("reach-total-level-100").found, complete("reach-total-level-100").completed], [true, false], "found, done once, then refused");
  assert.equal(complete("no-such-task").found, false);
  assert.equal(points(league), 10);
  hooks["command:leaguetask"]({ player: league, parts: ["leaguetask", "defeat-a-guard"] });
  assert.equal(league.sent.messages.at(-1), "Completed league task defeat-a-guard for completer.");
  hooks["command:leaguetask"]({ player: league, parts: ["leaguetask", "defeat-a-guard"] });
  assert.equal(league.sent.messages.at(-1), "completer already has league task defeat-a-guard.");
  assert.equal(league.sent.varps.get(bitVarp(indexOf("defeat-a-guard"))) & (1 << (indexOf("defeat-a-guard") % 32)), 1 << (indexOf("defeat-a-guard") % 32), "a points change re-syncs the bits");
  hooks["command:leaguetask"]({ player: league, parts: ["leaguetask", "adhoc", "25"] });
  assert.equal(league.sent.messages.at(-1), "Awarded league task adhoc (25 points) to completer.", "an id outside the catalog still takes points");
  assert.equal(points(league), 45);
  hooks["command:leaguetasks"]({ player: league, parts: ["leaguetasks", "guard"] });
  assert.ok(league.sent.messages.some((text) => text.startsWith("defeat-a-guard - Defeat a Guard (Easy, 10 points, done)")));

  const main = character("mainchar", "main");
  assert.equal(main.sent.content.length, 0, "no catalog");
  assert.equal(main.sent.varps.has(2616), false, "no completion varps");
  assert.equal(hooks[`button:${uid(SIDE_PANEL, 36)}`]({ player: main }), false);
  kill(main, "Goblin");
  assert.equal(main.getAttribute("league:tasks"), undefined);
  const request = { player: main, id: "defeat-a-goblin" };
  for (const handler of custom["league:complete-task"]) handler(request);
  assert.deepEqual([request.found, request.completed], [false, false]);
});
