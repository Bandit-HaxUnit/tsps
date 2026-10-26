// Run after `yarn build`: node --test tests/league-shattered-quests.test.cjs
// Shattered Relics' quest packs (docs/leagues.md "Shattered Relics") against every quest plugin:
// which of the Wiki's names this server registers, and what completing every pack hands out.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");

let core;
let Unlocks;
let QuestRuntime;
const prompts = [];
const tasks = [];
const data = require("../plugins/modes/data/league-shattered.json").unlocks.quests;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  // Deferred rewards (a prompt a tick on) are run by hand.
  core.TaskManager.submit = (task) => tasks.push(task);
  const api = new Proxy({
    core,
    persistAttribute() {},
    getPluginConfig: (key, fallback) => fallback,
    sendMultiChatboxPrompt: (player, title) => prompts.push(title),
  }, { get: (target, key) => (key in target ? target[key] : () => {}) });
  require("../plugins/modes/league/Common.LeagueMode").init(api);
  require("../plugins/quests/Quests.plugin").register(api);
  Unlocks = require("../plugins/modes/league/Unlocks.LeagueMode");
  QuestRuntime = require("../plugins/quests/QuestRuntime");
});

test("every pack's quests are registered quests, but Recipe for Disaster's subquests and four miniquests", () => {
  const names = [...new Set(Object.values(data.packs).flatMap((pack) => pack.quests))];
  assert.deepEqual(names.filter((name) => !QuestRuntime.questNamed(name)).sort(), [
    "Alfred Grimhand's Barcrawl", "Architectural Alliance", "Enter the Abyss",
    "Freeing Awowogei", "Freeing Pirate Pete", "Freeing Sir Amik Varze", "Freeing Skrach Uglogwee",
    "Freeing the Goblin generals", "Freeing the Mountain Dwarf", "The Frozen Door",
  ], "the names docs/leagues.md and the data say are skipped");
  assert.equal(QuestRuntime.questNamed("Song of the Elves")?.name, "Song of the Elves", "Elf III's main quest");
  assert.equal(QuestRuntime.questNamed("Dragon Slayer II")?.name, "Dragon Slayer II", "Myths' main quest");
});

test("completing every pack hands out the final rewards but no experience item, prompt or scroll", () => {
  const player = new Player(null);
  player.setUsername("every-pack");
  const opened = [];
  const sender = new Proxy({}, {
    get: (target, key) => key === "sendInterface" ? (group) => (opened.push(group), sender)
      : key === "sendJingle" ? (...args) => (opened.push(["jingle", ...args]), sender) : () => sender,
  });
  player.getPacketSender = () => sender;
  player.sendMessage = () => {};
  const banked = (id) => player.getBanks().reduce((sum, bank) => sum + (bank?.getAmount(id) ?? 0), 0);
  const held = (id) => player.getInventory().getAmount(id) + banked(id);
  for (const name of Object.keys(data.packs)) Unlocks._test.completeQuests(player, name);
  for (let round = 0; round < 3 && tasks.length; round++) {
    for (const task of tasks.splice(0)) (task.execute ?? task.run).call(task);
  }
  const registered = [...new Set(Object.values(data.packs).flatMap((pack) => pack.quests))]
    .map((name) => QuestRuntime.questNamed(name)).filter(Boolean);
  assert.deepEqual(registered.filter((quest) => !quest.isComplete(player)).map((quest) => quest.name), [], "all complete");
  assert.deepEqual(data.experienceItems.filter((id) => held(id) > 0), [], "no lamp or tome is left");
  assert.deepEqual(prompts, [], "The Fremennik Isles offers no combat XP");
  assert.deepEqual(opened, [], "no completion scroll (153) or jingle");
  for (const [id, label] of [[19564, "Monkey Madness II's royal seed pod"], [22400, "A Taste of Hope's Drakan's medallion"], [4212, "Roving Elves' crystal bow"]]) {
    assert.equal(held(id) > 0, true, `${label}: rewards past a full inventory go to the bank`);
  }
  assert.equal(player.getInventory().getFreeSlots(), 0, "the inventory filled up on the way");
});

test("a character's own inventory is kept through a pack's completion", () => {
  const player = new Player(null);
  player.setUsername("own-items");
  const sender = new Proxy({}, { get: () => () => sender });
  player.getPacketSender = () => sender;
  player.sendMessage = () => {};
  player.getInventory().adds(1351, 1);
  player.getInventory().adds(995, 1000);
  Unlocks._test.completeQuests(player, "Troll I");
  assert.equal(player.getInventory().getAmount(1351), 1, "the axe it carried");
  assert.equal(player.getInventory().getAmount(995), 1000, "its coins (Troll I's quests pay none)");
  assert.equal(player.getInventory().getAmount(1458), 1, "Troll Stronghold's law talisman joins them");
  assert.equal(QuestRuntime.questNamed("Death Plateau").isComplete(player), true);
});
