// Run after `yarn build`: node --test tests/fishing.test.cjs
const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

test("fishing spots, catch chances and the catch cascade follow OSRS", async () => {
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  const { PluginManager } = require("../dist/plugins/PluginManager");
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  const { NpcDefinition, NpcIdentifiers: N, ItemIdentifiers: I, Skill } = PluginManager.getCoreApi();
  const Fishing = require("../plugins/skills/Fishing.plugin");
  const { TOOLS, FISH, catchChance, catchLevel, rollCatch, findTool, getSpotTool, hasToolRequirements } = Fishing;

  // Click slot of an option, as the client sends it (second options sit in slot 3).
  function tool(npcId, option) {
    const definition = NpcDefinition.forId(npcId);
    const slot = definition.getActions().indexOf(option);
    return slot < 0 ? undefined : getSpotTool(npcId, definition, slot + 1);
  }
  assert.equal(tool(N.FISHING_SPOT_21, "Small Net"), TOOLS.NET);
  assert.equal(tool(N.FISHING_SPOT_21, "Bait"), TOOLS.FISHING_ROD);
  assert.equal(tool(N.FISHING_SPOT_43, "Net"), TOOLS.NET, "Tutorial Island pond");
  assert.equal(tool(N.FISHING_SPOT_30, "Net"), TOOLS.NET, "Lumbridge Swamp");
  assert.equal(tool(N.FISHING_SPOT_30, "Bait"), TOOLS.FISHING_ROD, "Lumbridge Swamp");
  assert.equal(tool(N.ROD_FISHING_SPOT_10, "Lure"), TOOLS.FLY_FISHING_ROD);
  assert.equal(tool(N.ROD_FISHING_SPOT_10, "Bait"), TOOLS.PIKE_ROD);
  assert.equal(tool(N.FISHING_SPOT_10, "Cage"), TOOLS.LOBSTER_POT);
  assert.equal(tool(N.FISHING_SPOT_10, "Harpoon"), TOOLS.HARPOON);
  assert.equal(tool(N.FISHING_SPOT_20, "Harpoon"), TOOLS.SHARK_HARPOON, "Catherby sharks");
  assert.equal(tool(N.FISHING_SPOT_20, "Big Net"), TOOLS.BIG_NET, "Catherby big net");
  assert.equal(tool(N.FISHING_SPOT_11, "Harpoon"), TOOLS.SHARK_HARPOON, "Fishing Guild sharks");
  assert.equal(tool(N.FISHING_SPOT_11, "Net"), TOOLS.BIG_NET, "Fishing Guild big net");
  assert.equal(tool(N.FISHING_SPOT_55, "Harpoon"), TOOLS.HARPOON, "Piscatoris tuna/swordfish");
  assert.equal(tool(N.FISHING_SPOT_55, "Net"), TOOLS.MONKFISH_NET, "Piscatoris monkfish");
  assert.equal(tool(N.FISHING_SPOT_2, "Small Net"), TOOLS.FROG_SPAWN_NET, "1497 is a cave spot, not shrimp");
  assert.equal(tool(N.FISHING_SPOT_2, "Bait"), TOOLS.CAVE_EEL_ROD);
  assert.equal(tool(N.FISHING_SPOT_4, "Net"), TOOLS.FROG_SPAWN_NET);
  assert.equal(tool(N.FISHING_SPOT_40, "Bait"), TOOLS.SWAMP_EEL_ROD, "Mort Myre");
  assert.equal(tool(N.FISHING_SPOT_63, "Bait"), TOOLS.LAVA_EEL_ROD, "Taverley lava eels");
  assert.equal(tool(N.FISHING_SPOT_68, "Bait"), TOOLS.SACRED_EEL_ROD);
  assert.equal(tool(N.ROD_FISHING_SPOT_16, "Bait"), TOOLS.ANGLERFISH_ROD);
  assert.equal(tool(N.ROD_FISHING_SPOT_20, "Bait"), TOOLS.INFERNAL_EEL_ROD);
  assert.equal(tool(N.FISHING_SPOT_35, "Cage"), TOOLS.DARK_CRAB_POT);
  assert.equal(tool(N.FISHING_SPOT_37, "Use-rod"), TOOLS.BARBARIAN_ROD);
  assert.equal(tool(N.FISHING_SPOT_58, "Net"), undefined, "karambwanji belongs to Tai Bwo Wannai Trio");
  assert.equal(tool(N.FISHING_SPOT_12, "Catch"), undefined, "aerial fishing is Hunter's");

  // Wiki skilling success chart: shark 12.5% at 76 and 41/256 at 99, shrimp certain at 99.
  assert.equal(catchChance(76, FISH.SHARK), 32 / 256);
  assert.equal(catchChance(99, FISH.SHARK), 41 / 256);
  assert.equal(catchChance(99, FISH.SHRIMP), 1);
  assert.equal(catchChance(1, FISH.SHRIMP), 49 / 256);
  // Mackerel's second big net roll is a flat 10/256.
  assert.equal(catchChance(16, FISH.MACKEREL, 100, 1), 11 / 256);
  assert.equal(catchChance(99, FISH.MACKEREL, 100, 1), 11 / 256);

  // Harpoon bonuses reproduce the Wiki's dragon (x1.2) and crystal (x1.35) chart values.
  const chartValue = (fish, bonus, level) => catchChance(level, fish, bonus) * 256 - 1;
  assert.equal(chartValue(FISH.TUNA, 120, 1), 9);
  assert.equal(chartValue(FISH.TUNA, 120, 99), 76);
  assert.equal(chartValue(FISH.SWORDFISH, 120, 99), 57);
  assert.equal(chartValue(FISH.SHARK, 120, 99), 48);
  assert.equal(chartValue(FISH.TUNA, 135, 99), 86);
  assert.equal(chartValue(FISH.SWORDFISH, 135, 1), 5);
  assert.equal(chartValue(FISH.SHARK, 135, 1), 4);
  assert.equal(chartValue(FISH.SHARK, 135, 99), 54);

  const location = (x, y, z = 0) => ({ getX: () => x, getY: () => y, getZ: () => z });
  function player({ fishing = 99, levels = {}, inventory = [], equipment = [], at = location(3200, 3200) } = {}) {
    const messages = [];
    return {
      messages,
      getSkillManager: () => ({
        getCurrentLevel: (skill) => (skill === Skill.FISHING ? fishing : levels[skill.getName()] ?? 99),
      }),
      getInventory: () => ({ contains: (id) => inventory.includes(id) }),
      getEquipment: () => ({ contains: (id) => equipment.includes(id) }),
      getLocation: () => at,
      sendMessage: (message) => messages.push(message),
    };
  }

  assert.equal(findTool(player({ inventory: [I.HARPOON] }), TOOLS.HARPOON).bonus, 100);
  assert.equal(findTool(player({ equipment: [I.BARB_TAIL_HARPOON] }), TOOLS.HARPOON).bonus, 100, "wielded barb-tail");
  assert.equal(findTool(player({ inventory: [I.HARPOON], equipment: [I.DRAGON_HARPOON] }), TOOLS.HARPOON).bonus, 120);
  assert.equal(findTool(player({ inventory: [I.CRYSTAL_HARPOON] }), TOOLS.HARPOON).bonus, 135);
  assert.equal(findTool(player({ inventory: [I.CRYSTAL_HARPOON_INACTIVE_] }), TOOLS.HARPOON).bonus, 120);
  assert.equal(findTool(player({ fishing: 60, inventory: [I.HARPOON], equipment: [I.DRAGON_HARPOON] }), TOOLS.HARPOON).bonus, 100);
  assert.equal(findTool(player({ fishing: 60, equipment: [I.DRAGON_HARPOON] }), TOOLS.HARPOON), null);
  assert.equal(findTool(player({ inventory: [I.PEARL_FISHING_ROD] }), TOOLS.FISHING_ROD).bonus, 100, "pearl rod");
  assert.equal(FISH.SHRIMP.caught, "some raw shrimps");

  // Fishing Guild: +7 on top of a visible level capped at 99; the boost never unlocks fish.
  assert.equal(catchLevel(player({ fishing: 80, at: location(2605, 3420) })), 87);
  assert.equal(catchLevel(player({ fishing: 102, at: location(2605, 3420) })), 106);
  assert.equal(catchLevel(player({ fishing: 102 })), 99);
  assert.deepEqual(rollCatch(player({ fishing: 70, at: location(2605, 3420) }), TOOLS.SHARK_HARPOON, () => 0), []);

  // Cascade: highest fish first, one per cast; an attempt can miss.
  assert.deepEqual(rollCatch(player(), TOOLS.NET, () => 0), [FISH.ANCHOVY]);
  assert.deepEqual(rollCatch(player({ fishing: 14 }), TOOLS.NET, () => 0), [FISH.SHRIMP], "anchovies need 15");
  assert.deepEqual(rollCatch(player({ fishing: 50 }), TOOLS.HARPOON, () => 0.99), []);
  const rolls = [0.99, 0];
  assert.deepEqual(rollCatch(player({ fishing: 50 }), TOOLS.HARPOON, () => rolls.shift()), [FISH.TUNA]);

  // Big net: every roll stands alone, so one cast can land bass, cod and two mackerel.
  assert.deepEqual(rollCatch(player(), TOOLS.BIG_NET, () => 0), [FISH.BASS, FISH.COD, FISH.MACKEREL, FISH.MACKEREL]);
  assert.deepEqual(rollCatch(player({ fishing: 20 }), TOOLS.BIG_NET, () => 0), [FISH.MACKEREL, FISH.MACKEREL]);

  // Barbarian fishing: Strength and Agility gate each leaping fish.
  const weak = player({ fishing: 99, levels: { Strength: 30, Agility: 30 } });
  assert.deepEqual(rollCatch(weak, TOOLS.BARBARIAN_ROD, () => 0), [FISH.LEAPING_SALMON]);
  const tooWeak = player({ fishing: 99, levels: { Strength: 14 }, inventory: [I.BARBARIAN_ROD, I.FEATHER] });
  assert.equal(hasToolRequirements(tooWeak, TOOLS.BARBARIAN_ROD), null);
  assert.match(tooWeak.messages[0], /Strength level of at least 15/);
  assert.ok(hasToolRequirements(player({ inventory: [I.BARBARIAN_ROD, I.FISH_OFFCUTS] }), TOOLS.BARBARIAN_ROD));
  assert.deepEqual(FISH.LEAPING_STURGEON.extraXp, [[Skill.STRENGTH, 7], [Skill.AGILITY, 7]]);

  // Infernal eels need ice gloves worn; dark crabs need dark fishing bait.
  const eeler = { inventory: [I.OILY_FISHING_ROD, I.FISHING_BAIT] };
  assert.equal(hasToolRequirements(player(eeler), TOOLS.INFERNAL_EEL_ROD), null);
  assert.ok(hasToolRequirements(player({ ...eeler, equipment: [I.ICE_GLOVES] }), TOOLS.INFERNAL_EEL_ROD));
  assert.equal(hasToolRequirements(player({ inventory: [I.LOBSTER_POT, I.FISHING_BAIT] }), TOOLS.DARK_CRAB_POT), null);
  assert.ok(hasToolRequirements(player({ inventory: [I.LOBSTER_POT, I.DARK_FISHING_BAIT] }), TOOLS.DARK_CRAB_POT));
});

test("the infernal harpoon cooks a third of its catch, runs on 5,000 charges and is made and recharged", async () => {
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  const { PluginManager } = require("../dist/plugins/PluginManager");
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  const core = PluginManager.getCoreApi();
  const { ItemIdentifiers: I, Skill, Item, Equipment } = core;

  // Register Fishing and Cooking against a stub api that wires custom events between them.
  const events = new Map();
  const itemActions = new Map();
  const itemOnItem = [];
  const api = new Proxy({
    core,
    getTaskManager: () => ({ submit() {} }),
    getWorld: () => ({}),
    onCustomEvent: (name, handler) => events.set(name, handler),
    emitCustomEvent: (name, payload) => events.get(name)?.(payload),
    onItemAction: (name, actions) => itemActions.set(name, actions),
    onItemOnItem: (a, b, handler) => itemOnItem.push([a, b, handler]),
  }, { get: (target, name) => target[name] ?? (() => {}) });
  const Fishing = require("../plugins/skills/Fishing.plugin");
  require("../plugins/skills/Cooking.plugin").register(api);
  Fishing.register(api);
  const InfernalHarpoon = require("../plugins/skills/fishing/InfernalHarpoon.Fishing");
  const { FISH, TOOLS, findTool, landCatch } = Fishing;

  function player({ inventory = [], weapon = null, fishing = 99, cooking = 99 } = {}) {
    const items = inventory.map((id) => new Item(id, 1));
    const equipment = new Array(14).fill(null);
    equipment[Equipment.WEAPON_SLOT] = weapon && new Item(weapon, 1);
    const xp = new Map();
    const messages = [];
    const container = (list) => ({
      getItems: () => list,
      contains: (id) => list.some((item) => item?.getId() === id),
      refreshItems() {},
    });
    return {
      items, equipment, xp, messages,
      getInventory: () => ({
        ...container(items),
        getFreeSlots: () => 28 - items.length,
        addItem: (item) => items.push(item),
        deleteNumber: (id) => items.splice(items.findIndex((item) => item.getId() === id), 1),
      }),
      getEquipment: () => container(equipment),
      getSkillManager: () => ({
        getCurrentLevel: (skill) => (skill === Skill.FISHING ? fishing : skill === Skill.COOKING ? cooking : 99),
        getMaxLevel: (skill) => (skill === Skill.FISHING ? fishing : skill === Skill.COOKING ? cooking : 99),
        addExperiences: (skill, amount) => xp.set(skill.getName(), (xp.get(skill.getName()) ?? 0) + amount),
      }),
      getLocation: () => null,
      sendMessage: (message) => messages.push(message),
    };
  }

  // A 1/3 roll cooks the shark for half its 210 Cooking XP and uses a charge.
  const fisher = player({ weapon: I.INFERNAL_HARPOON });
  assert.equal(InfernalHarpoon.tryCookFish(fisher, I.RAW_SHARK, () => 0.5), false, "2/3 of fish survive");
  assert.equal(InfernalHarpoon.tryCookFish(fisher, I.RAW_SHARK, () => 0.2), true);
  assert.equal(fisher.xp.get("Cooking"), 105);
  assert.equal(InfernalHarpoon.charges(fisher.equipment[Equipment.WEAPON_SLOT]), 4999);
  assert.equal(InfernalHarpoon.tryCookFish(player({ inventory: [I.DRAGON_HARPOON] }), I.RAW_SHARK, () => 0), false);

  // The last charge turns it into the uncharged harpoon, which fishes like a dragon harpoon.
  const lastCharge = player({ inventory: [I.INFERNAL_HARPOON_OR_] });
  lastCharge.items[0].setMetaValue("infernal-harpoon", { charges: 1 });
  assert.equal(InfernalHarpoon.tryCookFish(lastCharge, I.RAW_TUNA, () => 0), true);
  assert.equal(lastCharge.xp.get("Cooking"), 50);
  assert.equal(lastCharge.items[0].getId(), I.INFERNAL_HARPOON_UNCHARGED__2);
  assert.match(lastCharge.messages[0], /run out of charges/);
  assert.equal(findTool(lastCharge, TOOLS.HARPOON).infernal, undefined);
  assert.equal(findTool(lastCharge, TOOLS.HARPOON).bonus, 120);

  // A cooked catch still gives Fishing XP and the pet roll, but no fish.
  const random = Math.random;
  try {
    Math.random = () => 0;
    const landing = player({ weapon: I.INFERNAL_HARPOON });
    landCatch(landing, TOOLS.SHARK_HARPOON, findTool(landing, TOOLS.SHARK_HARPOON), [FISH.SHARK]);
    assert.equal(landing.items.length, 0);
    assert.equal(landing.xp.get("Fishing"), 110);
    assert.equal(landing.xp.get("Cooking"), 105);
    Math.random = () => 0.9;
    landCatch(landing, TOOLS.SHARK_HARPOON, findTool(landing, TOOLS.SHARK_HARPOON), [FISH.SHARK]);
    assert.equal(landing.items[0].getId(), I.RAW_SHARK);
  } finally {
    Math.random = random;
  }

  const check = player({ inventory: [I.INFERNAL_HARPOON] });
  itemActions.get("Infernal harpoon").Check({ player: check, item: check.items[0] });
  assert.equal(check.messages[0], "Your infernal harpoon has 5,000 charges left.");

  // Smouldering stone on a dragon harpoon: 75 Fishing and 85 Cooking.
  const make = itemOnItem.find(([a, b]) => a === "Smouldering stone" && b === "Dragon harpoon")[2];
  const crafter = (levels) => player({ inventory: [I.SMOULDERING_STONE, I.DRAGON_HARPOON], ...levels });
  const use = (p) => ({ player: p, usedItemId: p.items[0].getId(), usedItemSlot: 0, usedWithItemId: p.items[1].getId(), usedWithItemSlot: 1 });
  const novice = crafter({ cooking: 84 });
  make(use(novice));
  assert.deepEqual(novice.items.map((item) => item.getId()), [I.SMOULDERING_STONE, I.DRAGON_HARPOON]);
  const smith = crafter({});
  make(use(smith));
  assert.deepEqual(smith.items.map((item) => item.getId()), [I.INFERNAL_HARPOON]);
  assert.equal(smith.xp.get("Fishing"), 200);
  assert.equal(smith.xp.get("Cooking"), 350);

  // Angler's outfit: +2.5% Fishing XP for the full set, spirit pieces included.
  const { anglerXpMultiplier } = Fishing;
  const dressed = player();
  dressed.equipment[Equipment.HEAD_SLOT] = new Item(I.ANGLER_HAT, 1);
  assert.equal(anglerXpMultiplier(dressed), 1.004);
  dressed.equipment[Equipment.BODY_SLOT] = new Item(I.SPIRIT_ANGLER_TOP, 1);
  dressed.equipment[Equipment.LEG_SLOT] = new Item(I.ANGLER_WADERS, 1);
  dressed.equipment[Equipment.FEET_SLOT] = new Item(I.ANGLER_BOOTS, 1);
  assert.ok(Math.abs(anglerXpMultiplier(dressed) - 1.025) < 1e-12);
  assert.equal(anglerXpMultiplier(player()), 1);
  try {
    Math.random = () => 0.9;
    landCatch(dressed, TOOLS.HARPOON, findTool(player({ inventory: [I.HARPOON] }), TOOLS.HARPOON), [FISH.SWORDFISH]);
    assert.ok(Math.abs(dressed.xp.get("Fishing") - 102.5) < 1e-9);
  } finally {
    Math.random = random;
  }

  // A dragon harpoon recharges an uncharged one.
  const recharge = itemOnItem.find(([a, b]) => a === "Dragon harpoon" && b === "Infernal harpoon (uncharged)")[2];
  const owner = player({ inventory: [I.DRAGON_HARPOON, I.INFERNAL_HARPOON_UNCHARGED_] });
  recharge(use(owner));
  assert.deepEqual(owner.items.map((item) => item.getId()), [I.INFERNAL_HARPOON]);
  assert.equal(InfernalHarpoon.charges(owner.items[0]), 5000);
});
