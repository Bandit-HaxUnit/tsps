// Run after `yarn build`: node --test tests/impetuous-impulses.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { PluginManager } = require("../dist/plugins/PluginManager");
const { ItemIds } = require("../dist/util/IdEnums");

const plugin = require("../plugins/minigames/ImpetuousImpulses.plugin");
const core = PluginManager.getCoreApi();
const { Skill, Location } = core;
plugin._test.init({ core });

const FIELD = new Location(2427, 4446, 0);
const WHEAT = { getLocation: () => new Location(2566, 4300, 0) };
const PORTAL_DEFINITION = { getInteractions: () => ["Exit", "Investigate", null, null, null] };

function sequence(...values) {
  let index = 0;
  return () => values[index++];
}

function player({ hunter = 17, boost = 0, strength = 1, items = {} } = {}) {
  const attributes = new Map();
  const inventory = new Map(Object.entries(items).map(([id, amount]) => [Number(id), amount]));
  const p = {
    messages: [], moved: [], xp: 0, attributes, location: new Location(2565, 4300, 0),
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getInventory: () => ({
      getAmount: (id) => inventory.get(id) ?? 0,
      contains: (id) => (inventory.get(id) ?? 0) > 0,
      getFreeSlots: () => 28 - [...inventory.values()].reduce((sum, amount) => sum + amount, 0),
      capacity: () => 28,
      adds: (id, amount) => inventory.set(id, (inventory.get(id) ?? 0) + amount),
      deleteNumber: (id, amount) => inventory.set(id, (inventory.get(id) ?? 0) - amount),
    }),
    getSkillManager: () => ({
      getMaxLevel: (skill) => (skill === Skill.HUNTER ? hunter : 99),
      getCurrentLevel: (skill) => (skill === Skill.HUNTER ? hunter + boost : skill === Skill.STRENGTH ? strength : 99),
      addExperiences: (_, amount) => { p.xp += amount; },
    }),
    sendMessage: (message) => p.messages.push(message),
    getLocation: () => p.location,
    moveTo: (destination) => { p.moved.push(destination); p.location = destination; },
    setLocation: (destination) => { p.location = destination; },
    performAnimation() {},
  };
  return p;
}

test("Hunter 17 gates the crop circle and cannot be boosted into it", () => {
  const weak = player({ hunter: 16, boost: 5 });
  assert.equal(plugin._test.enterCropCircle({ player: weak, object: { getLocation: () => FIELD } }), true);
  assert.match(weak.messages.at(-1), /Hunter level of 17/);
  assert.equal(weak.getAttribute(plugin._test.ENTRY_ATTRIBUTE), undefined);

  const strong = player();
  assert.equal(plugin._test.enterCropCircle({ player: strong, object: { getLocation: () => FIELD } }), false);
  assert.deepEqual(strong.getAttribute(plugin._test.ENTRY_ATTRIBUTE), [2427, 4446, 0]);
});

test("the exit portal returns to the remembered field; otherwise the Zanaris one", () => {
  const defaulted = player();
  plugin._test.moveToField(defaulted);
  assert.deepEqual([defaulted.moved[0].getX(), defaulted.moved[0].getY(), defaulted.moved[0].getZ()], [2427, 4446, 0]);

  const p = player();
  plugin._test.enterCropCircle({ player: p, object: { getLocation: () => FIELD } });
  p.setAttribute(plugin._test.ENTRY_ATTRIBUTE, [3000, 3200, 0]);
  assert.equal(plugin._test.portalOption({ player: p, definition: PORTAL_DEFINITION, clickType: 1 }), true);
  assert.deepEqual([p.moved[0].getX(), p.moved[0].getY(), p.moved[0].getZ()], [3000, 3200, 0]);
  assert.equal(plugin._test.portalOption({ player: p, definition: PORTAL_DEFINITION, clickType: 2 }), true);
  assert.match(p.messages.at(-1), /crop circle/);
});

test("wheat chances interpolate and fast is rolled before medium", () => {
  assert.equal(plugin._test.fastChance(1), 0);
  assert.ok(Math.abs(plugin._test.fastChance(99) - 0.39) < 1e-9);
  assert.ok(Math.abs(plugin._test.mediumChance(1) - 0.04) < 1e-9);
  assert.equal(plugin._test.mediumChance(99), 1);

  assert.equal(plugin._test.rollTier(50, sequence(0.1, 0.9)), plugin._test.TIERS[0]);
  assert.equal(plugin._test.rollTier(50, sequence(0.3, 0.3)), plugin._test.TIERS[1]);
  assert.equal(plugin._test.rollTier(50, sequence(0.9, 0.9)), plugin._test.TIERS[2]);
});

test("a push waits its tier's ticks, moves two tiles and awards no XP", () => {
  const p = player({ strength: 1 });
  assert.equal(plugin._test.pushThrough({ player: p, object: WHEAT, random: () => 0.99 }), true);
  assert.match(p.messages.at(-1), /hard work/);
  assert.equal(plugin._test.pushes.get(p).ticks, 10);

  for (let i = 0; i < 9; i++) plugin._test.process(p);
  assert.equal(p.moved.length, 0);
  plugin._test.process(p);
  assert.equal(p.moved.length, 1);
  assert.deepEqual([p.moved[0].getX(), p.moved[0].getY(), p.moved[0].getZ()], [2567, 4300, 0]);
  assert.equal(p.xp, 0);
});

test("leaving or moving cancels a pending push", () => {
  const leaving = player();
  plugin._test.pushThrough({ player: leaving, object: WHEAT, random: () => 0.99 });
  plugin._test.cancel(leaving);
  plugin._test.process(leaving);
  assert.equal(leaving.moved.length, 0);

  const walking = player();
  plugin._test.pushThrough({ player: walking, object: WHEAT, random: () => 0.99 });
  walking.location = new Location(2565, 4301, 0);
  plugin._test.process(walking);
  assert.equal(plugin._test.pushes.has(walking), false);
  assert.equal(walking.moved.length, 0);
});

test("Elnock's gift is once per account and needs room", () => {
  const p = player();
  assert.equal(plugin._test.gift(p), true);
  assert.equal(p.getInventory().getAmount(ItemIds.BUTTERFLY_NET), 1);
  assert.equal(p.getInventory().getAmount(ItemIds.IMPLING_JAR), 7);
  assert.equal(p.getInventory().getAmount(ItemIds.IMPLING_SCROLL), 1);
  assert.equal(p.getAttribute(plugin._test.GIFT_ATTRIBUTE), true);
  assert.equal(plugin._test.gift(p), false);
  assert.equal(p.getInventory().getAmount(ItemIds.IMPLING_JAR), 7);

  const full = player({ items: { [ItemIds.BABY_IMPLING_JAR]: 25 } });
  assert.equal(plugin._test.gift(full), false);
  assert.equal(full.getAttribute(plugin._test.GIFT_ATTRIBUTE), undefined);
  assert.equal(full.getInventory().getAmount(ItemIds.BUTTERFLY_NET), 0);
});

test("Elnock trades jars for jars, repellent, a magic net and a jar generator", () => {
  const jars = player({ items: { [ItemIds.BABY_IMPLING_JAR]: 1 } });
  assert.equal(plugin._test.trade(jars, "jars"), true);
  assert.equal(jars.getInventory().getAmount(ItemIds.BABY_IMPLING_JAR), 0);
  assert.equal(jars.getInventory().getAmount(ItemIds.IMPLING_JAR), 3);

  const repellent = player({ items: {
    [ItemIds.BABY_IMPLING_JAR]: 3, [ItemIds.YOUNG_IMPLING_JAR]: 2, [ItemIds.GOURMET_IMPLING_JAR]: 1,
  } });
  assert.equal(plugin._test.trade(repellent, "repellent"), true);
  assert.equal(repellent.getInventory().getAmount(ItemIds.IMP_REPELLENT), 1);
  assert.equal(repellent.getInventory().getAmount(ItemIds.BABY_IMPLING_JAR), 0);

  const net = player({ items: {
    [ItemIds.GOURMET_IMPLING_JAR]: 3, [ItemIds.EARTH_IMPLING_JAR]: 2, [ItemIds.ESSENCE_IMPLING_JAR]: 1,
  } });
  assert.equal(plugin._test.trade(net, "net"), true);
  assert.equal(net.getInventory().getAmount(ItemIds.MAGIC_BUTTERFLY_NET), 1);

  const generator = player({ items: {
    [ItemIds.ESSENCE_IMPLING_JAR]: 3, [ItemIds.ECLECTIC_IMPLING_JAR]: 2, [ItemIds.NATURE_IMPLING_JAR]: 1,
  } });
  assert.equal(plugin._test.trade(generator, "generator"), true);
  assert.equal(generator.getInventory().getAmount(ItemIds.JAR_GENERATOR), 1);
});

test("a failed trade consumes nothing", () => {
  const p = player({ items: { [ItemIds.GOURMET_IMPLING_JAR]: 3, [ItemIds.EARTH_IMPLING_JAR]: 2 } });
  assert.equal(plugin._test.trade(p, "net"), false);
  assert.equal(p.getInventory().getAmount(ItemIds.GOURMET_IMPLING_JAR), 3);
  assert.equal(p.getInventory().getAmount(ItemIds.EARTH_IMPLING_JAR), 2);
  assert.match(p.messages.at(-1), /implings/);

  const noJars = player();
  assert.equal(plugin._test.trade(noJars, "jars"), false);
  assert.match(noJars.messages.at(-1), /impling jars/);
});
