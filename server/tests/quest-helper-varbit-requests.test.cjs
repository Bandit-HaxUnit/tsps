// The headless path must answer the bridge's state requests, or the first step that reads a puzzle
// varbit comes back as `activeStep: null` and looks like a quest defect. This drives the real
// producer (Ernest the Chicken's lever handler), the real cache bit layout, and the real request
// loop, and asserts on the exact payload the bridge receives.
//
// Run after `yarn build`: node --test tests/quest-helper-varbit-requests.test.cjs
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { PluginManager } = require("../dist/plugins/PluginManager");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { QuestHelperRuntime } = require("../plugins/quests/questhelper/Runtime.QuestHelper");
const { collectQuestHelperSnapshot } = require("../plugins/quests/questhelper/Snapshot.QuestHelper");
const { fillRequested } = require("../plugins/quests/questhelper/Requests.QuestHelper");

// varp "ernestlever": levers A-F are bits 1-6, so lever A is varbit 1788 at bit 1.
const VARP_LEVERS = 33;
const VARBIT_LEVER_A = 1788;
const LEVER_A_OBJECT = 146;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
});

/** Runs the real Ernest lever handler and returns the varps it published. */
function pullLeverA() {
  const configs = [];
  const attributes = new Map();
  const player = {
    getAttribute: (key) => attributes.get(key) ?? 0,
    setAttribute: (key, value) => attributes.set(key, value),
    getPacketSender: () => ({ sendConfig: (varp, value) => configs.push({ varp, value }) }),
    // Inside the basement's bounds, so the lever/door visuals are published too.
    getLocation: () => ({ getX: () => 3115, getY: () => 9755, getZ: () => 0 }),
    performAnimation: () => {},
    sendMessage: () => {},
  };
  const noop = () => {};
  const registered = [];
  // The real plugin, registered through the real core with every hook a no-op.
  const api = new Proxy({
    core: PluginManager.getCoreApi(),
    onObjectInteraction: (fn) => registered.push(fn),
  }, { get: (target, key) => target[key] ?? noop });
  require("../plugins/quests/quests/ErnestTheChicken.Quest.js")(api);
  const handler = registered.at(-1);
  assert.equal(typeof handler, "function", "the quest registers an object interaction handler");
  const event = {
    player, objectId: LEVER_A_OBJECT, clickType: 1, location: player.getLocation(),
    definition: { getInteractions: () => ["Pull"] },
  };
  handler(event);
  assert.equal(event.handled, true, "the lever click is claimed by the quest");
  return configs;
}

/** The server's own reader: PacketSender.getVarbit over the published varps. */
function readerFor(configs) {
  const varps = new Map(configs.map((config) => [config.varp, config.value]));
  return {
    varbit: (id) => {
      const definition = CacheDefinitions.getVarbit(id);
      if (!definition) return Number.NaN;
      const value = varps.get(definition.baseVar) ?? 0;
      const width = definition.endBit - definition.startBit;
      return (value >>> definition.startBit) & (-1 >>> (31 - width));
    },
    definition: (id) => CacheDefinitions.getVarbit(id),
  };
}

const bridgeReply = (request) => ({
  protocol: 1, session: request.session, sequence: request.sequence, questKey: request.questKey,
  sourceCommit: "pinned", status: "active", activeStep: { id: "getCan", text: ["Pull the levers"] },
  panels: [], diagnostics: [], requests: [],
});

function playerFixture(configs) {
  return {
    getIndex: () => 7,
    getUsername: () => "Fixture",
    getAttribute: () => 0,
    getLocation: () => ({ getX: () => 3115, getY: () => 9755, getZ: () => 0 }),
    getInventory: () => ({ getItems: () => [] }),
    getEquipment: () => ({ getItems: () => [] }),
    getPacketSender: () => readerFor(configs),
    getSkillManager: () => ({ getMaxLevel: () => 1, getCurrentLevel: () => 1, getExperience: () => 0 }),
    getFrameUpdater: () => ({ interfaceTextMap: new Map() }),
  };
}

const sceneDeps = {
  nearby: () => ({ npcs: [], objects: [], groundItems: [] }),
  items: () => [],
  skills: () => ({ HITPOINTS: { real: 10, boosted: 10, xp: 1154 } }),
  tick: () => 1,
};
const quest = {
  key: "ernest_the_chicken", name: "Ernest the Chicken", varpId: 32, getStage: () => 1,
  isStarted: () => true, isComplete: () => false, varpValue: () => 1,
};

test("a lever varbit the helper asks for is recovered from the real producer", async () => {
  const configs = pullLeverA();
  const varpLevers = configs.find((config) => config.varp === VARP_LEVERS);
  assert.equal(varpLevers.value, 2, "lever A publishes varp 33 bit 1");

  const read = readerFor(configs);
  const cacheDefinition = CacheDefinitions.getVarbit(VARBIT_LEVER_A);
  assert.deepEqual(
    { baseVar: cacheDefinition.baseVar, startBit: cacheDefinition.startBit, endBit: cacheDefinition.endBit },
    { baseVar: VARP_LEVERS, startBit: 1, endBit: 1 },
    "the cache puts ERNESTLEVER_A at varp 33 bit 1",
  );
  assert.equal(read.varbit(VARBIT_LEVER_A), 1, "the server's reader sees the lever as pulled");

  const player = playerFixture(configs);
  const snapshot = collectQuestHelperSnapshot(sceneDeps, player, { radius: 8 });
  assert.equal(snapshot.varbits[VARBIT_LEVER_A], undefined, "the plain snapshot omits it");

  const calls = [];
  let round = 0;
  const bridge = {
    catalog: async () => ({ quests: [{ questKey: quest.key, supported: true }] }),
    close: async () => {},
    evaluate: async (request) => {
      calls.push(request);
      round += 1;
      // Exactly what the pinned helper does: read the lever varbit, and ask for it if absent.
      if (round === 1) return {
        protocol: 1, status: "unavailable", activeStep: null,
        diagnostics: [{ code: "MISSING_STATE", method: "varbit", message: "Snapshot requires varbit 1788" }],
        requests: [{ kind: "varbit", id: VARBIT_LEVER_A }, { kind: "varbitDefinition", id: VARBIT_LEVER_A }],
      };
      return bridgeReply(request);
    },
  };
  const runtime = new QuestHelperRuntime({
    getQuests: () => [quest], bridge, send: () => {},
    varbitDefinition: (id) => CacheDefinitions.getVarbit(id),
    contract: () => null,
    fillRequests: (p, requests, state) => fillRequested(state, requests, readerFor(configs)),
  });
  const result = await runtime.evaluateHeadless(player, { questKey: quest.key, snapshot });

  assert.equal(calls.length, 2, "the bridge is asked again after its request is answered");
  const retry = calls[1].snapshot;
  assert.equal(retry.varbits[VARBIT_LEVER_A], 1, "the retry carries the lever value");
  assert.deepEqual(retry.varbitDefinitions[VARBIT_LEVER_A], { varp: VARP_LEVERS, lsb: 1, msb: 1 });
  // The bridge reads a varbit as (varp >>> lsb) & mask, so the packed varp must agree.
  const packed = (retry.varps[VARP_LEVERS] >>> retry.varbitDefinitions[VARBIT_LEVER_A].lsb)
    & (-1 >>> (31 - (retry.varbitDefinitions[VARBIT_LEVER_A].msb - retry.varbitDefinitions[VARBIT_LEVER_A].lsb)));
  assert.equal(packed, 1, "the packed varp reads back as lever A pulled");
  assert.equal(result.activeStep.id, "getCan", "the step survives instead of coming back unavailable");
  assert.equal(result.requestsFilled, 1);
});
