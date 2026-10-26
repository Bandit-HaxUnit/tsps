// Run after `yarn build`: node --test tests/league-fragments-sage.test.cjs
// Shattered Relics' three sets that give an item (docs/leagues.md "Shattered Relics"): Endless
// Knowledge, Last Recall and Trailblazer, with real players equipping real fragments through the
// fragments screen. The teleports are the core's TeleportHandler, its run stood in for (it needs
// the world's task loop) so the test sees where it would go.
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

const uid = (group, child) => (group << 16) | child;
const CLASS = 737;
const FRAGMENTS = 735;
const GRIMOIRE = 26551;
const CRYSTAL = 25104;
const WAYSTONE = 26549;
/** Three Endless Knowledge pieces, four Last Recall pieces, three Trailblazer pieces (enum 4136's sets). */
const ENDLESS_KNOWLEDGE = [28, 35, 36];
const LAST_RECALL = [35, 47, 48, 49];
const TRAILBLAZER = [21, 23, 45];

let core;
const hooks = {};
const custom = {};
const itemActions = {};
let worldLeague = 3;
let prompt = null;
const completedQuests = new Set();

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
    getTaskManager: () => ({ submit() {} }),
    registerCommand: (name, handler) => (hooks[`command:${name}`] = handler),
    sendMultiChatboxPrompt: (player, title, ...pairs) => (prompt = { player, title, pairs }),
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
    onItemAction: (name, actions) => (itemActions[name] = { ...(itemActions[name] ?? {}), ...actions }),
    onCustomEvent: (name, handler) => (custom[name] = (custom[name] ?? []).concat(handler)),
    emitCustomEvent: (name, payload) => emit(name, payload),
  }, { get: (target, key) => (key in target ? target[key] : on(String(key))) });
  require("../plugins/modes/LeagueMode.plugin").register(api);
  require("../plugins/modes/LeaguePoints.plugin").register(api);
  custom["quest:is-complete"] = [(request) => { request.complete = completedQuests.has(request.key); }];
});

afterEach(() => {
  prompt = null;
  completedQuests.clear();
});

function emit(name, payload) {
  for (const handler of custom[name] ?? []) handler(payload);
  return payload;
}

function character(name, { profile = "league" } = {}) {
  const player = new Player(null);
  player.setUsername(name);
  player.setProfile(profile);
  player.setLocation(new core.Location(3222, 3218, 0));
  const messages = [];
  const sender = new Proxy({}, { get: () => () => sender });
  player.getPacketSender = () => sender;
  player.sendMessage = (text) => messages.push(text);
  hooks.onPlayerLogin({ player, username: name, isNewAccount: true, profile });
  return Object.assign(player, { messages });
}

function shattered(name) {
  const player = character(name);
  player.setInterfaceId(CLASS);
  hooks[`button:${uid(CLASS, 6)}`]({ player, buttonId: uid(CLASS, 6) });
  hooks[`button:${uid(CLASS, 26)}`]({ player, buttonId: uid(CLASS, 26) });
  hooks["command:leaguetask"]({ player, parts: ["leaguetask", `points-${name}`, "15000"] });
  return player;
}

function equip(player, ...ids) {
  for (const id of ids) emit("league:grant-fragment", { player, id });
  player.setInterfaceId(FRAGMENTS);
  for (const id of ids) hooks[`button:${uid(FRAGMENTS, 18)}`]({ player, buttonId: uid(FRAGMENTS, 18), slot: 9 * (id - 1), opId: 2 });
  player.setInterfaceId(-1);
}

function unequipAll(player) {
  player.setInterfaceId(FRAGMENTS);
  hooks[`button:${uid(FRAGMENTS, 16)}`]({ player, buttonId: uid(FRAGMENTS, 16) });
  player.setInterfaceId(-1);
}

/** Clicks an item option through the item-action handlers the units registered (by cache name). */
function click(player, itemId, option) {
  const name = core.CacheDefinitions.getItem(itemId).name;
  return itemActions[name]?.[option]?.({ player, itemId });
}

/** Stands in for TeleportHandler's run (the world's task loop): where it would go, and its requirement check. */
function teleports(t) {
  const went = [];
  went.allowed = () => true;
  t.mock.method(core.TeleportHandler, "checkReqs", (player, location, wildernessLevel) => went.allowed(location, wildernessLevel));
  t.mock.method(core.TeleportHandler, "teleport", (player, location) => went.push([location.getX(), location.getY(), location.getZ()]));
  return went;
}

test("each set's item from the cache: the grimoire, the crystal and the waystone, once, when the set comes on", () => {
  const player = shattered("sageitems");
  equip(player, ...ENDLESS_KNOWLEDGE.slice(0, 2));
  assert.equal(player.getInventory().getAmount(GRIMOIRE), 0, "two pieces are no set");
  equip(player, ENDLESS_KNOWLEDGE[2]);
  assert.equal(player.getInventory().getAmount(GRIMOIRE), 1);
  assert.match(player.messages.at(-1), /receive Arcane grimoire/);
  unequipAll(player);
  assert.equal(player.getInventory().getAmount(GRIMOIRE), 1, "the item stays when the set comes off");
  equip(player, ...ENDLESS_KNOWLEDGE);
  assert.equal(player.getInventory().getAmount(GRIMOIRE), 1, "never a second while one is held");

  const banker = shattered("sagebank");
  banker.getBank(core.Bank.getTabForItem(banker, CRYSTAL)).add(new core.Item(CRYSTAL, 1), false);
  equip(banker, ...LAST_RECALL);
  assert.equal(banker.getInventory().getAmount(CRYSTAL), 0, "a banked crystal counts");

  const trail = shattered("sagetrail");
  equip(trail, ...TRAILBLAZER);
  assert.equal(trail.getInventory().getAmount(WAYSTONE), 1);
  const recall = shattered("sagerecall");
  equip(recall, ...LAST_RECALL);
  assert.equal(recall.getInventory().getAmount(CRYSTAL), 1);
});

test("Last Recall's crystal: back to where the last teleport began, not from an instance or the no-recall places", (t) => {
  const went = teleports(t);
  const player = shattered("recaller");
  assert.equal(click(player, CRYSTAL, "Teleport-back"), true);
  assert.match(player.messages.at(-1), /no memory/);
  emit("teleport:landed", { player, from: new core.Location(3165, 3485, 0), fromInstance: false, to: new core.Location(3222, 3218, 0) });
  emit("teleport:landed", { player, from: new core.Location(2400, 4400, 0), fromInstance: true, to: new core.Location(3222, 3218, 0) });
  emit("teleport:landed", { player, from: new core.Location(2900, 4830, 0), fromInstance: false, to: new core.Location(3253, 3401, 0) });
  click(player, CRYSTAL, "Check-memories");
  assert.match(player.messages.at(-1), /remembers/);
  click(player, CRYSTAL, "Teleport-back");
  assert.deepEqual([...went], [[3165, 3485, 0]], "the Grand Exchange, not the instance nor the essence mine");

  const main = character("recallmain", { profile: "main" });
  emit("teleport:landed", { player: main, from: new core.Location(3165, 3485, 0), fromInstance: false });
  assert.equal(main.getAttribute("league:last-recall") ?? null, null, "a main character keeps no memory");
  assert.equal(click(main, CRYSTAL, "Teleport-back"), false, "and its click goes on to the other leagues' crystal");
});

test("Trailblazer's waystone: the league's twelve waystones in pages, a quest's place only with the quest", (t) => {
  const went = teleports(t);
  const player = shattered("waystoner");
  click(player, WAYSTONE, "Teleport");
  const names = [];
  for (let page = 0; page < 3; page++) {
    const labels = prompt.pairs.filter((entry) => typeof entry === "string");
    names.push(...labels.slice(0, -1));
    if (page < 2) prompt.pairs[prompt.pairs.length - 1](player);
  }
  assert.deepEqual(names, ["Al Kharid", "Ardougne", "Brimhaven", "Canifis", "Catherby", "Falador", "Ferox Enclave", "Rellekka",
    "Kourend", "Lumbridge", "Prifddinas", "Varrock"]);
  prompt.pairs[prompt.pairs.length - 1](player);
  assert.equal(prompt.pairs[0], "Al Kharid", "the last page's More... leads back to the first");

  const choose = (name) => {
    click(player, WAYSTONE, "Teleport");
    for (;;) {
      const index = prompt.pairs.indexOf(name);
      if (index >= 0) return prompt.pairs[index + 1](player);
      prompt.pairs[prompt.pairs.length - 1](player);
    }
  };
  choose("Varrock");
  assert.deepEqual(went.at(-1), [3213, 3424, 0]);
  choose("Prifddinas");
  assert.equal(went.length, 1, "no Song of the Elves, no Prifddinas");
  assert.match(player.messages.at(-1), /Song of the Elves/);
  completedQuests.add("song_of_the_elves");
  choose("Prifddinas");
  assert.deepEqual(went.at(-1), [3239, 6076, 0]);

  went.allowed = (location, level) => level === 20;
  choose("Ferox Enclave");
  assert.deepEqual(went.at(-1), [3151, 3636, 0], "asked with Wilderness level 20 as its limit");
});

test("the core's own teleport tells content where it began as it lands (teleport:landed)", (t) => {
  const tasks = [];
  t.mock.method(core.TaskManager, "submit", (task) => tasks.push(task));
  t.mock.method(PluginManager, "emitCustomEvent", (name, payload) => emit(name, payload));
  const player = shattered("teleporter");
  player.setLocation(new core.Location(3165, 3485, 0));
  core.TeleportHandler.teleport(player, new core.Location(3222, 3218, 0), core.TeleportType.NORMAL, false);
  const task = tasks.find((entry) => entry.constructor.name === "TeleportTask");
  for (let tick = 0; tick < 10 && player.getLocation().getX() !== 3222; tick++) task.execute();
  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY()], [3222, 3218], "landed");
  assert.deepEqual(player.getAttribute("league:last-recall"), { x: 3165, y: 3485, z: 0 }, "the crystal remembers the start");
});
