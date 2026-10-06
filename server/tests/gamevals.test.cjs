// Run after `yarn build`: node --test tests/gamevals.test.cjs
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { Gamevals, GamevalKind, decodeGamevalInterface } = require("../dist/game/cache/Gamevals");

let gamevals;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  gamevals = new Gamevals();
});

test("interface gamevals name every component, as rsprox prints them", () => {
  const chatmodal = (162 << 16) | 567;
  assert.equal(gamevals.componentName(chatmodal), "chatbox:chatmodal");
  assert.equal(gamevals.componentId("chatbox:chatmodal"), chatmodal);
  assert.equal(gamevals.componentId("chatbox:no_such_component"), null);
  assert.equal(gamevals.componentName((164 << 16) | 1), "toplevel_pre_eoc:overlay_atmosphere");
});

test("other gamevals name ids the way the Slayer Tower capture shows them", () => {
  assert.equal(gamevals.namesOf(GamevalKind.SEQ).get(828), "human_reachforladder");
  assert.equal(gamevals.namesOf(GamevalKind.LOC).get(2108), "slayertower_door");
  assert.equal(gamevals.namesOf(GamevalKind.VARBIT).get(12393), "busy");
});

test("an interface file decodes to its name and components, ending at 0xFFFF", () => {
  const bytes = Int8Array.from([...Buffer.from("demo\0"), 0, 3, ...Buffer.from("close\0"), 0xff, 0xff]);
  const { name, components } = decodeGamevalInterface(bytes);
  assert.equal(name, "demo");
  assert.deepEqual([...components], [[3, "close"]]);
});
