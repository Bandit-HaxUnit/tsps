// Run after `yarn build`: node --test tests/league-records.test.cjs
// The main game's league records (docs/leagues.md "Records"): a main character's points come from
// its league character's save, the Leagues Tutor's trophies open and hand out as captured, and the
// accomplishment scroll's statistics, rankings and firsts open with the captured packets.
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

const TROPHIES = 447;
const STATISTICS = 449;
const RANKINGS = 445;
const FIRSTS = 676;
const MODAL_SIZE = 2524;
const RAGING_ECHOES_POINTS = 4556;
const uid = (group, child) => (group << 16) | child;
const OP1 = 1 << 1;
const OP10 = 1 << 10;

let core;
const hooks = {};
const npcOptions = {};
const objectOptions = {};
const custom = {};
let worldLeague = 0; // the world's pluginConfig league:type; 0 is the main game
const tasks = [];
/** The persistence the records read: saves by "name/profile". */
const saves = new Map();
/** When set, the persistence stand-in's load throws this. */
let loadError = null;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  GameConstants.setPlayerPersistence({
    load: (name, profile = "main") => {
      if (loadError) throw loadError;
      return saves.get(`${name}/${profile}`) ?? null;
    },
    exists: (name, profile = "main") => saves.has(`${name}/${profile}`),
    save() {},
  });
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
    setWorldProfile() {},
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
    onNpcInteraction: (name, actions) => Object.assign((npcOptions[name] ??= {}), actions),
    onObjectInteraction: (name, actions) => Object.assign((objectOptions[name] ??= {}), actions),
    onCustomEvent: (name, handler) => (custom[name] = (custom[name] ?? []).concat(handler)),
    emitCustomEvent: (name, payload) => {
      for (const handler of custom[name] ?? []) handler(payload);
    },
  }, { get: (target, key) => (key in target ? target[key] : on(String(key))) });
  require("../plugins/modes/LeagueMode.plugin").register(api);
  require("../plugins/modes/LeaguePoints.plugin").register(api);
});

/** A real player whose packets are recorded, logged in as `profile` on a world running `league` (0: the main game). */
function character(name, { profile = "main", league = 0 } = {}) {
  const player = new Player(null);
  player.setUsername(name);
  player.setProfile(profile);
  const sent = { messages: [], varbits: new Map(), varps: new Map(), scripts: [], subs: [], flags: [] };
  const sender = new Proxy({}, {
    get: (target, key) => {
      switch (key) {
        case "sendVarbit": return (id, value) => (sent.varbits.set(id, value), sender);
        case "sendConfig": return (id, value) => (sent.varps.set(id, value), sender);
        case "sendInterfaceScript": return (id, args) => {
          for (const arg of args) assert.ok(["number", "string", "bigint"].includes(typeof arg), `script ${id} argument ${arg} is not one the encoder takes`);
          sent.scripts.push([id, args]);
          return sender;
        };
        case "sendInterface": return (group) => (player.setInterfaceId(group), sent.subs.push(["main", group]), sender);
        case "sendInterfaceRemoval": return () => (player.setInterfaceId(-1), sender);
        case "sendInterfaceFlagsRange": return (...args) => (sent.flags.push(args), sender);
        default: return () => sender;
      }
    },
  });
  player.getPacketSender = () => sender;
  player.sendMessage = (text) => sent.messages.push(text);
  const previous = worldLeague;
  worldLeague = league;
  hooks.onPlayerLogin({ player, username: name, isNewAccount: true, profile });
  worldLeague = previous;
  return Object.assign(player, { sent });
}

/** An account whose league character (Raging Echoes) has `points`, saved; its main character logs in on the main game. */
function veteran(name, points) {
  const league = character(name, { profile: "league", league: 5 });
  if (points > 0) hooks["command:leaguetask"]({ player: league, parts: ["leaguetask", `task-${name}`, String(points)] });
  saves.set(`${name}/league`, PlayerSave.fromPlayer(league));
  return character(name);
}

/** enum 2778's trophies, read from the cache here as the client does. */
function cacheTrophies() {
  return [...CacheDefinitions.getEnumValues(2778).entries()].sort(([a], [b]) => a - b).map(([, item]) => {
    const params = CacheDefinitions.getItem(Number(item)).params;
    return { item: Number(item), league: Number(params.get(916)), points: Number(params.get(917)) };
  });
}

function slotOf(predicate) {
  const slot = cacheTrophies().findIndex(predicate);
  assert.ok(slot >= 0, "the cache has the trophy");
  return slot;
}

function claim(player) {
  return npcOptions["Leagues Tutor"]["Claim-trophies"]({ player });
}

function click(player, slot, opId = 1) {
  return hooks[`button:${uid(TROPHIES, 3)}`]({ player, slot, opId, action: opId });
}

function runTasks() {
  for (const task of tasks.splice(0)) task.execute();
}

test("a main character's points are its league character's, sent as that league's main-game varp", () => {
  const main = veteran("veteran", 2500);
  assert.equal(main.sent.varps.get(RAGING_ECHOES_POINTS), 2500, "script 9462 reads varp 4556 for Leagues V");
  for (const varp of [2771, 2772, 3275, 4032, 5507]) assert.equal(main.sent.varps.has(varp), false, `no points for another league (varp ${varp})`);
  const fresh = character("fresh");
  assert.equal(fresh.sent.varps.has(RAGING_ECHOES_POINTS), false, "an account without a league save has no league points");
});

test("Claim-trophies opens the trophies as captured (229/00701)", () => {
  const main = veteran("claimer", 100);
  assert.equal(claim(main), true);
  assert.deepEqual(main.sent.scripts.at(-2), [MODAL_SIZE, [-1, -1]]);
  assert.deepEqual(main.sent.subs.at(-1), ["main", TROPHIES]);
  const count = cacheTrophies().length;
  assert.equal(count, 42, "enum 2778 lists 42 trophies in this cache (rev 229's 35 and Demonic Pacts' 7)");
  assert.deepEqual(main.sent.flags.at(-1), [uid(TROPHIES, 3), 0, count, OP1 | OP10], "captured 0-35 with 35 trophies");
  assert.deepEqual(main.sent.scripts.at(-1), [1128, ["League Trophies", -1, 1023, 0, 0, 0]], "every trophy is the Tutor's to hand out: captured [-1, 7] over 35 trophies");
});

test("Take hands out an earned trophy; Store takes it back; an unearned one stays", () => {
  const trophies = cacheTrophies();
  const bronze = slotOf((trophy) => trophy.league === 5 && trophy.points > 0 && trophy.points <= 2500);
  const unearned = slotOf((trophy) => trophy.league === 5 && trophy.points > 2500);
  const otherLeague = slotOf((trophy) => trophy.league === 4);
  const main = veteran("taker", 2500);
  claim(main);
  click(main, unearned);
  click(main, otherLeague);
  assert.equal(main.getInventory().contains(trophies[unearned].item), false, "a trophy above the points isn't handed out");
  assert.equal(main.getInventory().contains(trophies[otherLeague].item), false, "another league's trophy isn't handed out");
  click(main, bronze);
  assert.equal(main.getInventory().contains(trophies[bronze].item), true, "Take hands it out");
  const [script, masks] = main.sent.scripts.at(-1);
  assert.equal(script, 1130, "the masks are resent through league_trophies_update");
  assert.equal((masks[bronze >> 5] >>> (bronze & 31)) & 1, 0, "its bit clears: the client shows Store");
  click(main, bronze);
  assert.equal(main.getInventory().contains(trophies[bronze].item), false, "Store takes it back");
  assert.deepEqual(main.sent.scripts.at(-1), [1130, [-1, 1023, 0, 0, 0]]);
});

test("a trophy in the bank shows Store, and a full inventory is refused", () => {
  const trophies = cacheTrophies();
  const bronze = slotOf((trophy) => trophy.league === 5 && trophy.points > 0 && trophy.points <= 2500);
  const main = veteran("banker", 2500);
  main.getBank(0).add(new core.Item(trophies[bronze].item, 1), false);
  claim(main);
  const masks = main.sent.scripts.at(-1)[1].slice(1);
  assert.equal((masks[bronze >> 5] >>> (bronze & 31)) & 1, 0, "a banked trophy is held");
  click(main, bronze);
  assert.equal(main.getInventory().contains(trophies[bronze].item), false, "Store doesn't reach into the bank");

  const placeholder = veteran("placeholder", 2500);
  const bank = placeholder.getBank(0);
  bank.add(new core.Item(trophies[bronze].item, 1), false);
  bank.getItems().find((entry) => entry?.getId() === trophies[bronze].item).setAmount(0);
  claim(placeholder);
  click(placeholder, bronze);
  assert.equal(placeholder.getInventory().contains(trophies[bronze].item), true, "a bank placeholder isn't the trophy: a lost one can be taken again");

  const full = veteran("full", 2500);
  for (let slot = 0; slot < 28; slot++) full.getInventory().adds(1511, 1); // logs, one per slot
  assert.equal(full.getInventory().getFreeSlots(), 0);
  claim(full);
  click(full, bronze);
  assert.equal(full.getInventory().contains(trophies[bronze].item), false);
  assert.equal(full.sent.messages.at(-1), "You don't have enough inventory space.");
});

test("a click without the trophy screen open does nothing", () => {
  const trophies = cacheTrophies();
  const bronze = slotOf((trophy) => trophy.league === 5 && trophy.points > 0 && trophy.points <= 2500);
  const main = veteran("crafty", 2500);
  assert.equal(click(main, bronze), true, "the click is still taken");
  assert.equal(main.getInventory().contains(trophies[bronze].item), false, "no trophy without the Tutor's screen");
  claim(main);
  main.getPacketSender().sendInterfaceRemoval();
  click(main, bronze);
  assert.equal(main.getInventory().contains(trophies[bronze].item), false, "nor after it closed");
});

test("a league save that can't be read, and a bot, leave the points at 0", () => {
  const league = character("unreadable", { profile: "league", league: 5 });
  hooks["command:leaguetask"]({ player: league, parts: ["leaguetask", "task-unreadable", "2500"] });
  saves.set("unreadable/league", PlayerSave.fromPlayer(league));
  loadError = new Error("backend down");
  const warn = console.warn;
  console.warn = () => {};
  try {
    const main = character("unreadable");
    assert.equal(main.sent.varps.has(RAGING_ECHOES_POINTS), false);
  } finally {
    loadError = null;
    console.warn = warn;
  }
  const bot = new Player(null);
  bot.setUsername("unreadable");
  bot.setAttribute("bot-skip-persistence", true);
  assert.deepEqual(require("../plugins/modes/league/Records.LeagueMode")._test.readSavedPoints(bot), {}, "bots never read a save");
});

test("Examine on a trophy sends its examine text", () => {
  const trophies = cacheTrophies();
  const main = veteran("examiner", 0);
  claim(main);
  click(main, 0, 10);
  const expected = core.ItemDefinition.forId(trophies[0].item).getExamine();
  assert.ok(expected, "the trophy has an examine text");
  assert.equal(main.sent.messages.at(-1), expected);
  assert.equal(main.getInventory().contains(trophies[0].item), false);
});

test("the Tutor's conversation opens the trophies a tick after it ends", () => {
  const main = veteran("talker", 0);
  tasks.length = 0; // the login's own repeating tasks
  const action = { player: main, action: "open_interface", target: "League trophies" };
  for (const handler of custom["npc-dialogue:action"]) handler(action);
  assert.equal(action.handled, true);
  assert.equal(action.end, true);
  assert.notEqual(main.sent.subs.at(-1)?.[1], TROPHIES, "not while the conversation is still closing");
  assert.equal(tasks.length, 1, "one delayed open waits for the next tick");
  runTasks();
  assert.deepEqual(main.sent.subs.at(-1), ["main", TROPHIES]);
  const taken = { player: main, action: "open_interface", target: "League trophies", handled: true };
  for (const handler of custom["npc-dialogue:action"]) handler(taken);
  assert.equal(tasks.length, 0, "an action another plugin handled is left alone");
  const other = { player: main, action: "open_interface", target: "Bank" };
  for (const handler of custom["npc-dialogue:action"]) handler(other);
  assert.equal(other.handled, undefined, "another target is left to its own plugin");
});

test("a league character can't claim trophies on a league world", () => {
  const league = character("leaguer", { profile: "league", league: 5 });
  worldLeague = 5;
  try {
    assert.equal(claim(league), false, "the option falls through");
    const action = { player: league, action: "open_interface", target: "League trophies" };
    for (const handler of custom["npc-dialogue:action"]) handler(action);
    assert.equal(action.handled, undefined);
    assert.equal(click(league, 0), false);
  } finally {
    worldLeague = 0;
  }
});

test("on a league world the scroll's options fall through", () => {
  const league = character("scroll-leaguer", { profile: "league", league: 5 });
  const scroll = objectOptions["League Accomplishment Scroll"];
  worldLeague = 5;
  try {
    for (const option of ["League-statistics", "League-rankings", "League-firsts"]) {
      assert.equal(scroll[option]({ player: league }), false, option);
    }
    assert.equal(league.sent.subs.length, 0, "nothing opens");
  } finally {
    worldLeague = 0;
  }
});

test("the accomplishment scroll's three options open as captured (229/00693, 00700)", () => {
  const main = veteran("scholar", 2500);
  const scroll = objectOptions["League Accomplishment Scroll"];

  scroll["League-statistics"]({ player: main });
  assert.deepEqual(main.sent.scripts.at(-2), [MODAL_SIZE, [-1, -1]]);
  assert.deepEqual(main.sent.subs.at(-1), ["main", STATISTICS]);
  assert.deepEqual(main.sent.scripts.at(-1), [1110, [uid(449, 5), uid(449, 7), uid(449, 8), uid(449, 3), "scholar", 0, 0, 0, 0, 2500, 0]],
    "the owner's name, then each league's points in league order");

  scroll["League-rankings"]({ player: main });
  assert.deepEqual(main.sent.scripts.at(-1), [MODAL_SIZE, [-1, -1]], "rankings send nothing else");
  assert.deepEqual(main.sent.subs.at(-1), ["main", RANKINGS]);

  scroll["League-firsts"]({ player: main });
  const components = [1, 9, 10, 11, 16, 17, 18, 12, 7].map((child) => uid(FIRSTS, child));
  assert.deepEqual(main.sent.subs.at(-1), ["main", FIRSTS]);
  assert.deepEqual(main.sent.scripts.at(-1), [3698, [...components, 6]], "the latest league first");
  assert.deepEqual(main.sent.flags.at(-1), [uid(FIRSTS, 22), 1, 6, OP1], "one dropdown slot per league");

  hooks[`button:${uid(FIRSTS, 22)}`]({ player: main, slot: 2 });
  assert.deepEqual(main.sent.scripts.at(-1), [3698, [...components, 2]], "a pick redraws that league's firsts");
  assert.deepEqual(main.sent.flags.at(-1), [uid(FIRSTS, 22), 1, 6, OP1]);
  const before = main.sent.scripts.length;
  hooks[`button:${uid(FIRSTS, 22)}`]({ player: main, slot: 9 });
  assert.equal(main.sent.scripts.length, before, "a slot past the leagues is ignored");
});

test("::leaguerecords opens each screen", () => {
  const main = veteran("developer", 0);
  for (const [screen, group] of [["trophies", TROPHIES], ["statistics", STATISTICS], ["rankings", RANKINGS], ["firsts", FIRSTS]]) {
    hooks["command:leaguerecords"]({ player: main, parts: ["leaguerecords", screen] });
    assert.deepEqual(main.sent.subs.at(-1), ["main", group], screen);
  }
  hooks["command:leaguerecords"]({ player: main, parts: ["leaguerecords"] });
  assert.match(main.sent.messages.at(-1), /::leaguerecords <trophies\|statistics\|rankings\|firsts>/);
});
