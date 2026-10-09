// Run after `yarn build`: node --test tests/tutorial-island-items.test.cjs
// Tutorial Island hand-outs: the transcript's "gives you" messages grant their items, and an
// instructor gives back a step's tool that only their first talk hands out
// (plugins/areas/TutorialIsland.plugin.js, stepTools).
const assert = require("node:assert/strict");
const path = require("node:path");
const { after, before, test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const ROOT = path.resolve(__dirname, "..");
const NET = 303, AXE = 1351, TINDERBOX = 590, PICKAXE = 1265, AIR = 556, MIND = 558;
const SURVIVAL_EXPERT = 8503, MINING_INSTRUCTOR = 3311, MAGIC_INSTRUCTOR = 3309;
const STAGE = { SURVIVAL_TALK: 5, SURVIVAL_INV: 6, SURVIVAL_TOOLS: 9, SURVIVAL_WC: 10, MINE_ORES: 24, MAGIC_RUNES: 49 };

let PluginManager, core, Player, NPC;

before(async () => {
  await require("../dist/game/cache/CachePipeline").CachePipeline.initialize(ROOT);
  ({ PluginManager } = require("../dist/plugins/PluginManager"));
  // world.json ships the tutorial disabled; load every plugin for these tests.
  PluginManager.loadDisabledPluginNames = () => new Set();
  const quiet = [console.log, console.info, console.debug, console.warn];
  console.log = console.info = console.debug = console.warn = () => {};
  try {
    PluginManager.loadFromDirectory(path.join(ROOT, "plugins"));
    core = PluginManager.getCoreApi();
    core.RegionManager.init();
    try { PluginManager.emitServerStartup({ timestamp: Date.now() }); } catch {}
  } finally {
    [console.log, console.info, console.debug, console.warn] = quiet;
  }
  ({ Player } = require("../dist/game/entity/impl/player/Player"));
  ({ NPC } = require("../dist/game/entity/impl/npc/NPC"));
});

// Plugin startup leaves world timers running; end the process once the tests are done.
after(() => setImmediate(() => process.exit()));

function tutorialPlayer(stage, x, y) {
  const player = new Player(null);
  player.setUsername("tutorial");
  player.setLocation(new core.Location(x, y, 0));
  const messages = [];
  const sender = new Proxy({}, { get: (_, key) => (key === "sendMessage" ? (text) => (messages.push(text), sender) : () => sender) });
  player.getPacketSender = () => sender;
  player.sendMessage = (text) => messages.push(text);
  player.isRegistered = () => true;
  player.setAttribute("tutorial.island.stage", stage);
  return { player, messages };
}

/** Talk-to; `lines` dialogue boxes are clicked through (all of them by default). */
function talk(player, npcId, lines = Infinity) {
  const npc = new NPC(npcId, player.getLocation().clone());
  const event = { player, npc, npcId, npcIndex: 1, clickType: 1, location: { x: npc.getLocation().getX(), y: npc.getLocation().getY(), z: 0 }, handled: false };
  assert.ok(PluginManager.emitNpcInteraction(event), "Talk-to is handled");
  const dialogues = player.getDialogueManager();
  for (let i = 0; i < Math.min(lines, 30) && dialogues.isActive(); i++) dialogues.advance();
  if (dialogues.isActive()) dialogues.reset();
}

const amount = (player, id) => player.getInventory().getAmount(id);

test("the Survival Expert's first talk gives one fishing net", () => {
  const { player, messages } = tutorialPlayer(STAGE.SURVIVAL_TALK, 3102, 3095);
  talk(player, SURVIVAL_EXPERT);
  assert.equal(amount(player, NET), 1);
  assert.ok(messages.includes("The survival expert gives you a small fishing net."));
});

test("a first talk closed before the net is handed over: the next talk gives it", () => {
  const { player, messages } = tutorialPlayer(STAGE.SURVIVAL_TALK, 3102, 3095);
  talk(player, SURVIVAL_EXPERT, 1);
  assert.equal(amount(player, NET), 0, "closed before the hand-out line");
  assert.equal(player.getAttribute("tutorial.island.stage"), STAGE.SURVIVAL_INV, "the stage moved on anyway");
  talk(player, SURVIVAL_EXPERT);
  assert.equal(amount(player, NET), 1);
  assert.ok(messages.includes("The survival expert gives you a small fishing net."));
  talk(player, SURVIVAL_EXPERT);
  assert.equal(amount(player, NET), 1, "not given again while carried");
});

test("after fishing, the Survival Expert gives a bronze axe and a tinderbox", () => {
  const { player, messages } = tutorialPlayer(STAGE.SURVIVAL_TOOLS, 3102, 3095);
  talk(player, SURVIVAL_EXPERT);
  assert.equal(amount(player, AXE), 1);
  assert.equal(amount(player, TINDERBOX), 1);
  assert.ok(messages.includes("The survival expert gives you a bronze axe and a tinderbox."));
});

test("a dropped axe is given back while cutting the tree is the step; only what's missing", () => {
  const { player, messages } = tutorialPlayer(STAGE.SURVIVAL_WC, 3102, 3095);
  player.getInventory().adds(TINDERBOX, 1);
  talk(player, SURVIVAL_EXPERT);
  assert.equal(amount(player, AXE), 1);
  assert.equal(amount(player, TINDERBOX), 1);
  assert.ok(messages.includes("The survival expert gives you a bronze axe."));
});

test("the mining instructor gives back a missing pickaxe while mining is the step", () => {
  const { player, messages } = tutorialPlayer(STAGE.MINE_ORES, 3081, 9504);
  talk(player, MINING_INSTRUCTOR);
  assert.equal(amount(player, PICKAXE), 1);
  assert.ok(messages.includes("The mining instructor gives you a bronze pickaxe."));
});

test("Terrova tops up the runes when the player runs out", () => {
  const { player } = tutorialPlayer(STAGE.MAGIC_RUNES, 3141, 3088);
  talk(player, MAGIC_INSTRUCTOR);
  assert.ok(amount(player, AIR) >= 5 && amount(player, MIND) >= 5);
});
