const { Skill } = require("../../src/main/typescript/elvarg/game/model/Skill");
const { Equipment } = require("../../src/main/typescript/elvarg/game/model/container/impl/Equipment");
const { Animation } = require("../../src/main/typescript/elvarg/game/model/Animation");
const { Task } = require("../../src/main/typescript/elvarg/game/task/Task");
const { MapObjects } = require("../../src/main/typescript/elvarg/game/entity/impl/object/MapObjects");
const { GameObject } = require("../../src/main/typescript/elvarg/game/entity/impl/object/GameObject");
const { Item } = require("../../src/main/typescript/elvarg/game/model/Item");
const { Sound } = require("../../src/main/typescript/elvarg/game/Sound");
const { Sounds } = require("../../src/main/typescript/elvarg/game/Sounds");
const { ItemIds, ObjectIds } = require("../../src/main/typescript/elvarg/util/IdEnums");

const DEFAULT_TREE_STUMP_ID = ObjectIds.TREE_STUMP_2;
// Classic normal-tree variants share models but not stumps; key their stump by the tree's model.
const NORMAL_TREE_STUMP_BY_MODEL = new Map([
  [1570, ObjectIds.TREE_STUMP_2],
  [1637, ObjectIds.TREE_STUMP_2],
  [1667, ObjectIds.TREE_STUMP_2],
  [1715, ObjectIds.TREE_STUMP_7],
  [1716, ObjectIds.TREE_STUMP_11],
  [1718, ObjectIds.TREE_STUMP_14],
  [1719, ObjectIds.TREE_STUMP_18],
  [1700, ObjectIds.TREE_STUMP_19],
  [23908, ObjectIds.TREE_STUMP_50],
  [1611, ObjectIds.TREE_STUMP_15],
  [1614, ObjectIds.TREE_STUMP_15],
  [1688, ObjectIds.TREE_STUMP_15],
  [1681, ObjectIds.TREE_STUMP_17],
  [1682, ObjectIds.TREE_STUMP_17],
  [1683, ObjectIds.TREE_STUMP_17],
  [14747, ObjectIds.DYING_TREE_STUMP],
  [3944, ObjectIds.TREE_STUMP_22],
]);
const stumpIdByTreeId = new Map();
const WOODCUTTING_ACTION_INTERVAL_TICKS = 4;
const CHOP_ANIMATION_INTERVAL_TICKS = 4;
// Fallback for multi-log trees without a known Forestry despawn timer: 1/8 per log.
const MULTI_TREE_DEPLETION_ROLL_MAX = 15;
const MULTI_TREE_DEPLETION_THRESHOLD = 2;
// OSRS Forestry: a tree's despawn timer counts down one per tick while anyone is chopping it
// and regenerates one per tick while nobody is; it falls on the first log after reaching 0.
const treeDespawnTimers = new Map();
const BIRD_NEST_DROP_CHANCE = 256;
let woodcuttingTick = 0;
let activeSessionsRef = null;
let pluginApi;

const BIRD_NESTS = Object.freeze({
  RED_EGG_NEST: ItemIds.BIRD_NEST,
  GREEN_EGG_NEST: ItemIds.BIRD_NEST_2,
  BLUE_EGG_NEST: ItemIds.BIRD_NEST_3,
  SEED_NEST: ItemIds.BIRD_NEST_4,
  RING_NEST: ItemIds.BIRD_NEST_5,
  EMPTY_NEST: ItemIds.BIRD_NEST_6,
});

const SEARCHABLE_NEST_IDS = new Set([
  BIRD_NESTS.RED_EGG_NEST,
  BIRD_NESTS.GREEN_EGG_NEST,
  BIRD_NESTS.BLUE_EGG_NEST,
  BIRD_NESTS.SEED_NEST,
  BIRD_NESTS.RING_NEST,
]);

const WOODCUTTING_CAPE_IDS = [ItemIds.WOODCUTTING_CAPE, ItemIds.WOODCUT_CAPE_T_];
const WOODCUTTING_CAPE_NEST_MULTIPLIER = 1.1;

// OSRS Wiki seed nest table (1,011 slots).
const NEST_SEEDS = [
  { id: ItemIds.ACORN, name: "acorn", weight: 214 },
  { id: ItemIds.APPLE_TREE_SEED, name: "apple", weight: 170 },
  { id: ItemIds.WILLOW_SEED, name: "willow", weight: 135 },
  { id: ItemIds.BANANA_TREE_SEED, name: "banana", weight: 108 },
  { id: ItemIds.ORANGE_TREE_SEED, name: "orange", weight: 85 },
  { id: ItemIds.CURRY_TREE_SEED, name: "curry", weight: 68 },
  { id: ItemIds.MAPLE_SEED, name: "maple", weight: 54 },
  { id: ItemIds.PINEAPPLE_SEED, name: "pineapple", weight: 42 },
  { id: ItemIds.PAPAYA_TREE_SEED, name: "papaya", weight: 34 },
  { id: ItemIds.YEW_SEED, name: "yew", weight: 27 },
  { id: ItemIds.PALM_TREE_SEED, name: "palm", weight: 22 },
  { id: ItemIds.CALQUAT_TREE_SEED, name: "calquat", weight: 17 },
  { id: ItemIds.SPIRIT_SEED, name: "spirit", weight: 11 },
  { id: ItemIds.DRAGONFRUIT_TREE_SEED, name: "dragonfruit", weight: 6 },
  { id: ItemIds.MAGIC_SEED, name: "magic", weight: 5 },
  { id: ItemIds.TEAK_SEED, name: "teak", weight: 4 },
  { id: ItemIds.MAHOGANY_SEED, name: "mahogany", weight: 4 },
  { id: ItemIds.CELASTRUS_SEED, name: "celastrus", weight: 3 },
  { id: ItemIds.REDWOOD_TREE_SEED, name: "redwood", weight: 2 },
];

// OSRS Wiki ring nest table.
const NEST_RINGS = [
  { id: ItemIds.GOLD_RING, name: "gold", weight: 35 },
  { id: ItemIds.SAPPHIRE_RING, name: "sapphire", weight: 40 },
  { id: ItemIds.EMERALD_RING, name: "emerald", weight: 15 },
  { id: ItemIds.RUBY_RING, name: "ruby", weight: 9 },
  { id: ItemIds.DIAMOND_RING, name: "diamond", weight: 1 },
];

const AXES = [
  { id: ItemIds.BRONZE_AXE, requiredLevel: 1, speed: 0.03, animationId: 879 },
  { id: ItemIds.IRON_AXE, requiredLevel: 1, speed: 0.05, animationId: 877 },
  { id: ItemIds.STEEL_AXE, requiredLevel: 6, speed: 0.09, animationId: 875 },
  { id: ItemIds.BLACK_AXE, requiredLevel: 6, speed: 0.11, animationId: 873 },
  { id: ItemIds.MITHRIL_AXE, requiredLevel: 21, speed: 0.13, animationId: 871 },
  { id: ItemIds.ADAMANT_AXE, requiredLevel: 31, speed: 0.16, animationId: 869 },
  { id: ItemIds.RUNE_AXE, requiredLevel: 41, speed: 0.19, animationId: 867 },
  { id: ItemIds.DRAGON_AXE, requiredLevel: 61, speed: 0.25, animationId: 2846 },
  { id: ItemIds.INFERNAL_AXE, requiredLevel: 61, speed: 0.3, animationId: 2117 },
];

const AXES_BY_REQUIREMENT_DESC = [...AXES].sort(
  (a, b) => b.requiredLevel - a.requiredLevel
);

const TREES = [
  {
    name: "normal tree",
    objectNames: ["Tree", "Dead tree", "Evergreen tree", "Dying tree"],
    action: "Chop down",
    requiredLevel: 1,
    xpReward: 25,
    logId: ItemIds.LOGS, petBase: 317647,
    objectIds: [
      ObjectIds.EVERGREEN_TREE,
      ObjectIds.EVERGREEN_TREE_2,
      ObjectIds.EVERGREEN_TREE_3,
      ObjectIds.EVERGREEN_TREE_4,
      ObjectIds.EVERGREEN_TREE_5,
      ObjectIds.EVERGREEN_TREE_6,
      ObjectIds.EVERGREEN_TREE_7,
      ObjectIds.EVERGREEN_TREE_8,
      ObjectIds.EVERGREEN_TREE_9,
      ObjectIds.JUNGLE_TREE_3,
      ObjectIds.TREE,
      ObjectIds.TREE_2,
      ObjectIds.TREE_3,
      ObjectIds.TREE_4,
      ObjectIds.TREE_5,
      ObjectIds.DEAD_TREE,
      ObjectIds.DEAD_TREE_2,
      ObjectIds.DEAD_TREE_3,
      ObjectIds.DEAD_TREE_4,
      ObjectIds.DEAD_TREE_5,
      ObjectIds.DEAD_TREE_8,
      ObjectIds.DEAD_TREE_9,
      ObjectIds.DEAD_TREE_10,
      ObjectIds.TREE_9,
      ObjectIds.TREE_10,
      ObjectIds.TREE_11,
      ObjectIds.DEAD_TREE_12,
      ObjectIds.DEAD_TREE_13,
      ObjectIds.DEAD_TREE_14,
      ObjectIds.TREE_16,
      ObjectIds.TREE_17,
      ObjectIds.TREE_18,
      ObjectIds.DEAD_TREE_18,
      ObjectIds.DEAD_TREE_19,
      ObjectIds.DEAD_TREE_20,
    ],
    cycles: 10,
    respawnTicks: 8,
    stumpId: ObjectIds.TREE_STUMP_2,
    multi: false,
  },
  {
    name: "achey tree",
    objectNames: ["Achey Tree"],
    action: "Chop",
    requiredLevel: 1,
    xpReward: 25,
    logId: ItemIds.ACHEY_TREE_LOGS, petBase: 317647,
    objectIds: [ObjectIds.ACHEY_TREE],
    cycles: 13,
    respawnTicks: 9,
    stumpId: ObjectIds.ACHEY_TREE_STUMP,
    multi: false,
  },
  {
    name: "oak",
    objectNames: ["Oak tree"],
    action: "Chop down",
    requiredLevel: 15,
    xpReward: 38,
    logId: ItemIds.OAK_LOGS, petBase: 361146,
    objectIds: [
      ObjectIds.ARCTIC_PINE_TREE,
      ObjectIds.OAK_TREE, ObjectIds.OAK_TREE_2, ObjectIds.OAK_TREE_3, ObjectIds.OAK_TREE_4,
      ObjectIds.OAK_TREE_5, ObjectIds.OAK_TREE_6, ObjectIds.OAK_TREE_7, ObjectIds.OAK_TREE_8,
      ObjectIds.OAK_TREE_9, ObjectIds.OAK_TREE_10, ObjectIds.OAK_TREE_11, ObjectIds.OAK_TREE_12,
      ObjectIds.OAK_TREE_13, ObjectIds.OAK_TREE_14, ObjectIds.OAK_TREE_15, ObjectIds.OAK_TREE_16,
      ObjectIds.OAK_TREE_17, ObjectIds.OAK_TREE_18,
    ],
    cycles: 14,
    respawnTicks: 11,
    stumpId: ObjectIds.TREE_STUMP_16,
    multi: true,
    despawnTicks: 45,
  },
  {
    name: "willow",
    objectNames: ["Willow tree"],
    action: "Chop down",
    requiredLevel: 30,
    xpReward: 68,
    logId: ItemIds.WILLOW_LOGS, petBase: 289286,
    objectIds: [
      ObjectIds.WILLOW_TREE, ObjectIds.WILLOW_TREE_2, ObjectIds.WILLOW_TREE_3, ObjectIds.WILLOW_TREE_4,
      ObjectIds.WILLOW_TREE_5, ObjectIds.WILLOW_TREE_6, ObjectIds.WILLOW_TREE_7, ObjectIds.WILLOW_TREE_8,
      ObjectIds.WILLOW_TREE_9, ObjectIds.WILLOW_TREE_10, ObjectIds.WILLOW_TREE_11, ObjectIds.WILLOW_TREE_12,
      ObjectIds.WILLOW_TREE_13, ObjectIds.WILLOW_TREE_14,
    ],
    cycles: 15,
    respawnTicks: 14,
    stumpId: ObjectIds.TREE_STUMP_35,
    multi: true,
    despawnTicks: 50,
  },
  {
    name: "teak",
    objectNames: ["Teak tree"],
    action: "Chop down",
    requiredLevel: 35,
    xpReward: 85,
    logId: ItemIds.TEAK_LOGS, petBase: 264336,
    objectIds: [
      ObjectIds.TEAK_TREE, ObjectIds.TEAK_TREE_2, ObjectIds.TEAK_TREE_3, ObjectIds.TEAK_TREE_4,
      ObjectIds.TEAK_TREE_5, ObjectIds.TEAK_TREE_6, ObjectIds.TEAK_TREE_7, ObjectIds.TEAK_TREE_8,
      ObjectIds.TEAK_TREE_9, ObjectIds.TEAK_TREE_10, ObjectIds.TEAK_TREE_11, ObjectIds.TEAK_TREE_12,
      ObjectIds.TEAK_TREE_13,
    ],
    cycles: 16,
    respawnTicks: 16,
    stumpId: ObjectIds.TREE_STUMP_32,
    multi: true,
    despawnTicks: 50,
  },
  {
    name: "dramen",
    objectNames: ["Dramen tree"],
    action: "Chop down",
    requiredLevel: 36,
    xpReward: 88,
    logId: ItemIds.DRAMEN_BRANCH,
    objectIds: [ObjectIds.DRAMEN_TREE],
    cycles: 16,
    respawnTicks: 17,
    multi: true,
  },
  {
    name: "maple",
    objectNames: ["Maple tree"],
    action: "Chop down",
    requiredLevel: 45,
    xpReward: 100,
    logId: ItemIds.MAPLE_LOGS, petBase: 221918,
    objectIds: [
      ObjectIds.MAPLE_TREE, ObjectIds.MAPLE_TREE_2, ObjectIds.MAPLE_TREE_3, ObjectIds.MAPLE_TREE_4,
      ObjectIds.MAPLE_TREE_5, ObjectIds.MAPLE_TREE_6, ObjectIds.MAPLE_TREE_7, ObjectIds.MAPLE_TREE_8,
      ObjectIds.MAPLE_TREE_9, ObjectIds.MAPLE_TREE_10, ObjectIds.MAPLE_TREE_11, ObjectIds.MAPLE_TREE_12,
      ObjectIds.MAPLE_TREE_13, ObjectIds.MAPLE_TREE_14, ObjectIds.MAPLE_TREE_15, ObjectIds.MAPLE_TREE_16,
      ObjectIds.MAPLE_TREE_17, ObjectIds.MAPLE_TREE_18,
    ],
    cycles: 17,
    respawnTicks: 18,
    stumpId: ObjectIds.TREE_STUMP_36,
    multi: true,
    despawnTicks: 100,
  },
  {
    name: "mahogany",
    objectNames: ["Mahogany tree"],
    action: "Chop down",
    requiredLevel: 50,
    xpReward: 125,
    logId: ItemIds.MAHOGANY_LOGS, petBase: 220623,
    objectIds: [
      ObjectIds.MAHOGANY_TREE, ObjectIds.MAHOGANY_TREE_2, ObjectIds.MAHOGANY_TREE_3, ObjectIds.MAHOGANY_TREE_4,
      ObjectIds.MAHOGANY_TREE_5, ObjectIds.MAHOGANY_TREE_6, ObjectIds.MAHOGANY_TREE_7, ObjectIds.MAHOGANY_TREE_8,
      ObjectIds.MAHOGANY_TREE_9, ObjectIds.MAHOGANY_TREE_10, ObjectIds.MAHOGANY_TREE_11, ObjectIds.MAHOGANY_TREE_12,
      ObjectIds.MAHOGANY_TREE_13, ObjectIds.MAHOGANY_TREE_14,
    ],
    cycles: 17,
    respawnTicks: 20,
    stumpId: ObjectIds.TREE_STUMP_31,
    multi: true,
    despawnTicks: 100,
  },
  {
    name: "yew",
    objectNames: ["Yew tree"],
    action: "Chop down",
    requiredLevel: 60,
    xpReward: 175,
    logId: ItemIds.YEW_LOGS, petBase: 145013,
    objectIds: [
      ObjectIds.YEW_TREE, ObjectIds.YEW_TREE_2, ObjectIds.YEW_TREE_3, ObjectIds.YEW_TREE_4,
      ObjectIds.YEW_TREE_5, ObjectIds.YEW_TREE_6, ObjectIds.YEW_TREE_7, ObjectIds.YEW_TREE_8,
      ObjectIds.YEW_TREE_9, ObjectIds.YEW_TREE_10, ObjectIds.YEW_TREE_11, ObjectIds.YEW_TREE_12,
      ObjectIds.YEW_TREE_13, ObjectIds.YEW_TREE_14, ObjectIds.YEW_TREE_15, ObjectIds.YEW_TREE_16,
      ObjectIds.YEW_TREE_17, ObjectIds.YEW_TREE_18, ObjectIds.YEW_TREE_19,
    ],
    cycles: 18,
    respawnTicks: 28,
    stumpId: ObjectIds.TREE_STUMP_38,
    multi: true,
    despawnTicks: 190,
  },
  {
    name: "magic",
    objectNames: ["Magic tree"],
    action: "Chop down",
    requiredLevel: 75,
    xpReward: 250,
    logId: ItemIds.MAGIC_LOGS, petBase: 72321,
    objectIds: [
      ObjectIds.MAGIC_TREE, ObjectIds.MAGIC_TREE_2, ObjectIds.MAGIC_TREE_3, ObjectIds.MAGIC_TREE_4,
      ObjectIds.MAGIC_TREE_5, ObjectIds.MAGIC_TREE_6, ObjectIds.MAGIC_TREE_7, ObjectIds.MAGIC_TREE_8,
      ObjectIds.MAGIC_TREE_9, ObjectIds.MAGIC_TREE_10, ObjectIds.MAGIC_TREE_11, ObjectIds.MAGIC_TREE_12,
      ObjectIds.MAGIC_TREE_13, ObjectIds.MAGIC_TREE_14, ObjectIds.MAGIC_TREE_15, ObjectIds.MAGIC_TREE_16,
      ObjectIds.MAGIC_TREE_17, ObjectIds.MAGIC_TREE_18,
    ],
    cycles: 20,
    respawnTicks: 40,
    stumpId: ObjectIds.TREE_STUMP_37,
    multi: true,
    despawnTicks: 390,
  },
  {
    name: "redwood",
    objectNames: ["Redwood tree"],
    action: "Cut",
    requiredLevel: 90,
    xpReward: 380,
    logId: ItemIds.REDWOOD_LOGS, petBase: 72321,
    objectIds: [
      ObjectIds.REDWOOD_TREE, ObjectIds.REDWOOD_TREE_2, ObjectIds.REDWOOD_TREE_3, ObjectIds.REDWOOD_TREE_4,
      ObjectIds.REDWOOD_TREE_5, ObjectIds.REDWOOD_TREE_6, ObjectIds.REDWOOD_TREE_7, ObjectIds.REDWOOD_TREE_8,
      ObjectIds.REDWOOD_TREE_9, ObjectIds.REDWOOD_TREE_10, ObjectIds.REDWOOD_TREE_11, ObjectIds.REDWOOD_TREE_12,
      ObjectIds.REDWOOD_TREE_13, ObjectIds.REDWOOD_TREE_14, ObjectIds.REDWOOD_TREE_15, ObjectIds.REDWOOD_TREE_16,
      ObjectIds.REDWOOD_TREE_17, ObjectIds.REDWOOD_TREE_18, ObjectIds.REDWOOD_TREE_19, ObjectIds.REDWOOD_TREE_20,
      ObjectIds.REDWOOD_TREE_21, ObjectIds.REDWOOD_TREE_22, ObjectIds.REDWOOD_TREE_23, ObjectIds.REDWOOD_TREE_24,
      ObjectIds.REDWOOD_TREE_25, ObjectIds.REDWOOD_TREE_26, ObjectIds.REDWOOD_TREE_27, ObjectIds.REDWOOD_TREE_28,
      ObjectIds.REDWOOD_TREE_29, ObjectIds.REDWOOD_TREE_30, ObjectIds.REDWOOD_TREE_31, ObjectIds.REDWOOD_TREE_32,
      ObjectIds.REDWOOD_TREE_33, ObjectIds.REDWOOD_TREE_34, ObjectIds.REDWOOD_TREE_35, ObjectIds.REDWOOD_TREE_36,
      ObjectIds.REDWOOD_TREE_37, ObjectIds.REDWOOD_TREE_38, ObjectIds.REDWOOD_TREE_39, ObjectIds.REDWOOD_TREE_40,
      ObjectIds.REDWOOD_TREE_41, ObjectIds.REDWOOD_TREE_42, ObjectIds.REDWOOD_TREE_43, ObjectIds.REDWOOD_TREE_44,
      ObjectIds.REDWOOD_TREE_45, ObjectIds.REDWOOD_TREE_46, ObjectIds.REDWOOD_TREE_47, ObjectIds.REDWOOD_TREE_48,
      ObjectIds.REDWOOD_TREE_49, ObjectIds.REDWOOD_TREE_50, ObjectIds.REDWOOD_TREE_51, ObjectIds.REDWOOD_TREE_52,
      ObjectIds.REDWOOD_TREE_53, ObjectIds.REDWOOD_TREE_54, ObjectIds.REDWOOD_TREE_55, ObjectIds.REDWOOD_TREE_56,
      ObjectIds.REDWOOD_TREE_57, ObjectIds.REDWOOD_TREE_58, ObjectIds.REDWOOD_TREE_59, ObjectIds.REDWOOD_TREE_60,
      ObjectIds.REDWOOD_TREE_61, ObjectIds.REDWOOD_TREE_62, ObjectIds.REDWOOD_TREE_63, ObjectIds.REDWOOD_TREE_64,
      ObjectIds.REDWOOD_TREE_65, ObjectIds.REDWOOD_TREE_66, ObjectIds.REDWOOD_TREE_67, ObjectIds.REDWOOD_TREE_68,
      ObjectIds.REDWOOD_TREE_69, ObjectIds.REDWOOD_TREE_70, ObjectIds.REDWOOD_TREE_71, ObjectIds.REDWOOD_TREE_72,
      ObjectIds.REDWOOD_TREE_73, ObjectIds.REDWOOD_TREE_74, ObjectIds.REDWOOD_TREE_75, ObjectIds.REDWOOD_TREE_76,
      ObjectIds.REDWOOD_TREE_77, ObjectIds.REDWOOD_TREE_78, ObjectIds.REDWOOD_TREE_79, ObjectIds.REDWOOD_TREE_80,
      ObjectIds.REDWOOD_TREE_81, ObjectIds.REDWOOD_TREE_82, ObjectIds.REDWOOD_TREE_83, ObjectIds.REDWOOD_TREE_84,
      ObjectIds.REDWOOD_TREE_85, ObjectIds.REDWOOD_TREE_86, ObjectIds.REDWOOD_TREE_87, ObjectIds.REDWOOD_TREE_88,
      ObjectIds.REDWOOD_TREE_89, ObjectIds.REDWOOD_TREE_90, ObjectIds.REDWOOD_TREE_91, ObjectIds.REDWOOD_TREE_92,
      ObjectIds.REDWOOD_TREE_93, ObjectIds.REDWOOD_TREE_94, ObjectIds.REDWOOD_TREE_95, ObjectIds.REDWOOD_TREE_96,
      ObjectIds.REDWOOD_TREE_97, ObjectIds.REDWOOD_TREE_98, ObjectIds.REDWOOD_TREE_99, ObjectIds.REDWOOD_TREE_100,
      ObjectIds.REDWOOD_TREE_101, ObjectIds.REDWOOD_TREE_102, ObjectIds.REDWOOD_TREE_103, ObjectIds.REDWOOD_TREE_104,
      ObjectIds.REDWOOD_TREE_105, ObjectIds.REDWOOD_TREE_106, ObjectIds.REDWOOD_TREE_107, ObjectIds.REDWOOD_TREE_108,
      ObjectIds.REDWOOD_TREE_109, ObjectIds.REDWOOD_TREE_110, ObjectIds.REDWOOD_TREE_111, ObjectIds.REDWOOD_TREE_112,
      ObjectIds.REDWOOD_TREE_113, ObjectIds.REDWOOD_TREE_114, ObjectIds.REDWOOD_TREE_115, ObjectIds.REDWOOD_TREE_116,
      ObjectIds.REDWOOD_TREE_117, ObjectIds.REDWOOD_TREE_118, ObjectIds.REDWOOD_TREE_119, ObjectIds.REDWOOD_TREE_120,
      ObjectIds.REDWOOD_TREE_121,
    ],
    cycles: 22,
    respawnTicks: 43,
    multi: true,
    despawnTicks: 440,
  },
];

const TREES_BY_NAME = new Map(TREES.flatMap((tree) => tree.objectNames.map((name) => [name, tree])));
// Farmed sailing hardwoods use the same axe/action machinery as existing trees.
// ponytail: these use this plugin's existing approximate axe/cycle model; exact forestry timers need a separate woodcutting update.
const FARMED_HARDWOODS = [
  { name: "camphor", requiredLevel: 66, xpReward: 143.5, logId: ItemIds.CAMPHOR_LOGS, petBase: 145013, cycles: 19, respawnTicks: 150, multi: true },
  { name: "ironwood", requiredLevel: 80, xpReward: 175, logId: ItemIds.IRONWOOD_LOGS, petBase: 72321, cycles: 21, respawnTicks: 150, multi: true },
  { name: "rosewood", requiredLevel: 92, xpReward: 212.5, logId: ItemIds.ROSEWOOD_LOGS, petBase: 72321, cycles: 23, respawnTicks: 150, multi: true },
];



const TREE_LOG_IDS = Object.freeze(
  Array.from(new Set(TREES.map((tree) => tree.logId)))
);

function randomIntInclusive(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getWoodcuttingLevel(player) {
  return player.getSkillManager().getCurrentLevel(Skill.WOODCUTTING);
}

function getEquippedWeaponId(player) {
  const equippedWeapon =
    player.getEquipment().getItems()[Equipment.WEAPON_SLOT];
  return equippedWeapon ? equippedWeapon.getId() : -1;
}

function findBestUsableAxe(player) {
  const woodcuttingLevel = getWoodcuttingLevel(player);
  const equippedWeaponId = getEquippedWeaponId(player);
  const inventory = player.getInventory();

  for (const axe of AXES_BY_REQUIREMENT_DESC) {
    if (woodcuttingLevel < axe.requiredLevel) {
      continue;
    }
    if (equippedWeaponId === axe.id || inventory.contains(axe.id)) {
      return axe;
    }
  }

  return null;
}

function findBestUsableAxeByLevel(level) {
  for (const axe of AXES_BY_REQUIREMENT_DESC) {
    if (level >= axe.requiredLevel) {
      return axe;
    }
  }
  return null;
}

function isWoodcuttingActive(player) {
  return !!(activeSessionsRef && player && activeSessionsRef.has(player));
}

function calculateCyclesRequired(player, tree, axe) {
  let cycles = tree.cycles + randomIntInclusive(0, 4);
  cycles -= getWoodcuttingLevel(player) * 0.1;
  cycles -= cycles * axe.speed;
  const tickBudget = Math.max(3, Math.floor(cycles));
  return Math.max(1, Math.ceil(tickBudget / WOODCUTTING_ACTION_INTERVAL_TICKS));
}

function treeTimerKey(objectId, location) {
  return `${objectId}:${location.getX()},${location.getY()},${location.getZ()}`;
}

function tickTreeDespawnTimer(state, currentTick) {
  if (!state.tree.despawnTicks) {
    return;
  }
  const key = treeTimerKey(state.objectId, state.location);
  let timer = treeDespawnTimers.get(key);
  if (!timer) {
    timer = { remaining: state.tree.despawnTicks, max: state.tree.despawnTicks, lastChopTick: -1 };
    treeDespawnTimers.set(key, timer);
  }
  // Several players on one tree still only drain it once per tick.
  if (timer.lastChopTick !== currentTick) {
    timer.lastChopTick = currentTick;
    timer.remaining = Math.max(0, timer.remaining - 1);
  }
}

function regenerateTreeDespawnTimers(currentTick) {
  for (const [key, timer] of treeDespawnTimers) {
    if (timer.lastChopTick === currentTick) {
      continue;
    }
    timer.remaining++;
    if (timer.remaining >= timer.max) {
      treeDespawnTimers.delete(key);
    }
  }
}

function shouldDepleteTree(state) {
  const tree = state.tree;
  if (!tree.multi) {
    return true;
  }
  if (tree.despawnTicks) {
    const timer = treeDespawnTimers.get(treeTimerKey(state.objectId, state.location));
    return !!timer && timer.remaining <= 0;
  }
  const roll = randomIntInclusive(0, MULTI_TREE_DEPLETION_ROLL_MAX);
  return roll < MULTI_TREE_DEPLETION_THRESHOLD;
}

function rollWeighted(table) {
  const total = table.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = randomIntInclusive(1, total);
  for (const entry of table) {
    roll -= entry.weight;
    if (roll <= 0) {
      return entry;
    }
  }
  return table[table.length - 1];
}

function isWearing(player, slot, itemIds) {
  const item = player.getEquipment().getItems()[slot];
  return !!item && itemIds.includes(item.getId());
}

// OSRS: 100 slots (seed 65, ring 32, one per egg colour); a strung rabbit foot drops 5 seed slots.
function rollBirdNestId(player) {
  const seedWeight = isWearing(player, Equipment.AMULET_SLOT, [ItemIds.STRUNG_RABBIT_FOOT]) ? 60 : 65;
  return rollWeighted([
    { id: BIRD_NESTS.SEED_NEST, weight: seedWeight },
    { id: BIRD_NESTS.RING_NEST, weight: 32 },
    { id: BIRD_NESTS.RED_EGG_NEST, weight: 1 },
    { id: BIRD_NESTS.GREEN_EGG_NEST, weight: 1 },
    { id: BIRD_NESTS.BLUE_EGG_NEST, weight: 1 },
  ]).id;
}

function maybeDropBirdNest(player) {
  if (!player) {
    return;
  }
  const chance = isWearing(player, Equipment.CAPE_SLOT, WOODCUTTING_CAPE_IDS)
    ? WOODCUTTING_CAPE_NEST_MULTIPLIER / BIRD_NEST_DROP_CHANCE
    : 1 / BIRD_NEST_DROP_CHANCE;
  if (Math.random() >= chance) {
    return;
  }

  const nestId = rollBirdNestId(player);
  ItemOnGroundManager.registers(player, new Item(nestId, 1));
  player.sendMessage("<col=ff0000>A bird's nest falls out of the tree.");
}

function rollNestSeed() {
  return rollWeighted(NEST_SEEDS);
}

function rollNestRing() {
  return rollWeighted(NEST_RINGS);
}

function searchBirdNest(player, nestId) {
  if (!SEARCHABLE_NEST_IDS.has(nestId)) {
    return false;
  }

  if (player.getInventory().getFreeSlots() <= 0) {
    player.sendMessage("Your inventory is too full to search the bird's nest.");
    return true;
  }

  player.getInventory().deleteNumber(nestId, 1);
  player.getInventory().adds(BIRD_NESTS.EMPTY_NEST, 1);

  if (nestId === BIRD_NESTS.SEED_NEST) {
    const seed = rollNestSeed();
    player.getInventory().adds(seed.id, 1);
    player.sendMessage(`You take a ${seed.name} seed out of the bird's nest.`);
    return true;
  }

  if (nestId === BIRD_NESTS.RING_NEST) {
    const ring = rollNestRing();
    player.getInventory().adds(ring.id, 1);
    player.sendMessage(`You take a ${ring.name} ring out of the bird's nest.`);
    return true;
  }

  const eggId =
    nestId === BIRD_NESTS.RED_EGG_NEST
      ? ItemIds.BIRDS_EGG
      : nestId === BIRD_NESTS.GREEN_EGG_NEST
        ? ItemIds.BIRDS_EGG_3
        : ItemIds.BIRDS_EGG_2;
  player.getInventory().adds(eggId, 1);
  player.sendMessage("You take the bird's egg out of the bird's nest.");
  return true;
}

function stopWoodcutting(activeSessions, player, resetAnimation = true) {
  if (!activeSessions.has(player)) {
    return;
  }
  activeSessions.delete(player);
  if (resetAnimation) {
    player.performAnimation(Animation.DEFAULT_RESET_ANIMATION);
  }
}

class TreeRespawnTask extends Task {
  constructor(delayTicks, originalTreeObject, stumpObject) {
    super(Math.max(1, delayTicks));
    this.originalTreeObject = originalTreeObject;
    this.stumpObject = stumpObject;
  }

  execute() {
    const existingStump = MapObjects.get(
      this.stumpObject.getId(),
      this.stumpObject.getLocation(),
      this.stumpObject.getPrivateArea()
    );
    if (existingStump) {
      ObjectManager.deregister(existingStump, true);
    }

    // Always re-register the original tree so clients receive an explicit spawn
    // update, even if cache-backed map objects can still resolve this id/location.
    ObjectManager.register(this.originalTreeObject, true);

    this.stop();
  }
}

function firstModelId(def) {
  return def?.models?.[0]?.[0];
}

// Newer trees keep their depleted state at the next loc id: an option-less "...stump", or (redwood,
// some Forestry-era maples) an option-less loc with the tree's own name and a different model.
function nextIdStump(treeId, treeDef, allowSameName) {
  const next = pluginApi.core.CacheDefinitions.getObject(treeId + 1);
  if (!next || (next.actions || []).some(Boolean)) {
    return null;
  }
  const isStump = /stump/i.test(next.name || "");
  const isDepletedVariant =
    allowSameName && next.name === treeDef.name && firstModelId(next) !== firstModelId(treeDef);
  return isStump || isDepletedVariant ? treeId + 1 : null;
}

function resolveStumpId(treeId, tree) {
  if (stumpIdByTreeId.has(treeId)) {
    return stumpIdByTreeId.get(treeId);
  }
  const treeDef = pluginApi.core.CacheDefinitions.getObject(treeId);
  const stumpId =
    (treeDef && nextIdStump(treeId, treeDef, false)) ??
    NORMAL_TREE_STUMP_BY_MODEL.get(firstModelId(treeDef)) ??
    (treeDef && nextIdStump(treeId, treeDef, true)) ??
    tree.stumpId ??
    DEFAULT_TREE_STUMP_ID;
  stumpIdByTreeId.set(treeId, stumpId);
  return stumpId;
}

function depleteTree(player, treeObject, tree) {
  const event = { player, object: treeObject, respawnTicks: tree.respawnTicks, handled: false };
  pluginApi.emitCustomEvent("woodcutting:deplete-tree", event);
  if (event.handled) return;
  const stump = new GameObject(
    resolveStumpId(treeObject.getId(), tree),
    treeObject.getLocation().clone(),
    treeObject.getType(),
    treeObject.getFace(),
    treeObject.getPrivateArea()
  );
  ObjectManager.deregister(treeObject, true);
  ObjectManager.register(stump, true);
  TaskManager.submit(new TreeRespawnTask(tree.respawnTicks, treeObject, stump));
}

function startWoodcutting(player, treeObject, tree, activeSessions) {
  const request = { player, object: treeObject, allow: true };
  pluginApi.emitCustomEvent("woodcutting:validate-tree", request);
  if (!request.allow) return false;
  const axe = findBestUsableAxe(player);
  if (!axe) {
    player.sendMessage("You don't have an axe which you can use.");
    return false;
  }

  const woodcuttingLevel = getWoodcuttingLevel(player);
  if (woodcuttingLevel < tree.requiredLevel) {
    player.sendMessage(
      `You need a Woodcutting level of at least ${tree.requiredLevel} to cut this tree.`
    );
    return false;
  }

  if (tree.logId >= 0 && player.getInventory().isFull()) {
    player.getInventory().full();
    return false;
  }

  const location = treeObject.getLocation().clone();
  const existingTree = MapObjects.get(
    treeObject.getId(),
    location,
    treeObject.getPrivateArea()
  );
  if (!existingTree) {
    player.sendMessage("You can't reach that tree right now.");
    return false;
  }

  player.getSkillManager()?.stopSkillable?.();
  stopWoodcutting(activeSessions, player, false);
  player.getCombat()?.reset?.();

  activeSessions.set(player, {
    tree,
    axe,
    objectId: treeObject.getId(),
    location,
    privateArea: treeObject.getPrivateArea(),
    cyclesUntilReward: calculateCyclesRequired(player, tree, axe),
    nextActionTick: woodcuttingTick + WOODCUTTING_ACTION_INTERVAL_TICKS,
    nextAnimationTick: woodcuttingTick + CHOP_ANIMATION_INTERVAL_TICKS,
  });

  player.sendMessage("You swing your axe at the tree..");
  player.performAnimation(new Animation(axe.animationId));
  return true;
}

function processWoodcuttingTick(activeSessions, currentTick) {
  for (const [player, state] of activeSessions) {
    if (!player || !player.isRegistered() || player.getHitpoints() <= 0) {
      activeSessions.delete(player);
      continue;
    }

    if (player.getForceMovement() != null) {
      continue;
    }

    if (player.getMovementQueue()?.size?.() > 0) {
      stopWoodcutting(activeSessions, player);
      continue;
    }

    const activeTree = MapObjects.get(
      state.objectId,
      state.location,
      state.privateArea
    );
    if (!activeTree) {
      stopWoodcutting(activeSessions, player);
      continue;
    }
    const request = { player, object: activeTree, allow: true };
    pluginApi.emitCustomEvent("woodcutting:validate-tree", request);
    if (!request.allow) {
      stopWoodcutting(activeSessions, player);
      continue;
    }

    if (
      !player.getLocation().isWithinInteractionDistance(activeTree.getLocation())
    ) {
      stopWoodcutting(activeSessions, player);
      continue;
    }

    const axe = findBestUsableAxe(player);
    if (!axe) {
      player.sendMessage("You don't have an axe which you can use.");
      stopWoodcutting(activeSessions, player);
      continue;
    }

    const woodcuttingLevel = getWoodcuttingLevel(player);
    if (woodcuttingLevel < axe.requiredLevel) {
      player.sendMessage(
        "You don't have an axe which you have the required Woodcutting level to use."
      );
      stopWoodcutting(activeSessions, player);
      continue;
    }

    if (woodcuttingLevel < state.tree.requiredLevel) {
      player.sendMessage(
        `You need a Woodcutting level of at least ${state.tree.requiredLevel} to cut this tree.`
      );
      stopWoodcutting(activeSessions, player);
      continue;
    }

    state.axe = axe;

    if (state.tree.logId >= 0 && player.getInventory().isFull()) {
      player.getInventory().full();
      stopWoodcutting(activeSessions, player);
      continue;
    }

    tickTreeDespawnTimer(state, currentTick);

    if (currentTick >= state.nextAnimationTick) {
      player.performAnimation(new Animation(state.axe.animationId));
      state.nextAnimationTick = currentTick + CHOP_ANIMATION_INTERVAL_TICKS;
    }

    if (currentTick < state.nextActionTick) {
      continue;
    }
    state.nextActionTick = currentTick + WOODCUTTING_ACTION_INTERVAL_TICKS;
    state.cyclesUntilReward--;
    if (state.cyclesUntilReward > 0) {
      continue;
    }

    if (state.tree.logId >= 0) {
      player.getInventory().adds(state.tree.logId, 1);
      player.sendMessage("You get some logs.");
      player.getSkillManager().addExperiences(Skill.WOODCUTTING, state.tree.xpReward);
      pluginApi.emitCustomEvent("woodcutting:success", {
        player,
        skill: Skill.WOODCUTTING,
        petBase: state.tree.petBase,
      });
      maybeDropBirdNest(player);
    }

    if (shouldDepleteTree(state)) {
      treeDespawnTimers.delete(treeTimerKey(state.objectId, state.location));
      Sounds.sendSound(player, Sound.WOODCUTTING_TREE_DOWN);
      depleteTree(player, activeTree, state.tree);
      stopWoodcutting(activeSessions, player);
      continue;
    }

    state.cyclesUntilReward = calculateCyclesRequired(
      player,
      state.tree,
      state.axe
    );
  }
}

class WoodcuttingTask extends Task {
  constructor(activeSessions) {
    super(1);
    this.activeSessions = activeSessions;
    this.currentTick = 0;
  }

  execute() {
    this.currentTick++;
    woodcuttingTick = this.currentTick;
    processWoodcuttingTick(this.activeSessions, this.currentTick);
    regenerateTreeDespawnTimers(this.currentTick);
  }
}

let TaskManager;
let ObjectManager;
let ItemOnGroundManager;

function handleChop(event) {
  const tree = TREES_BY_NAME.get(event.definition.getName());
  if (!tree) {
    return;
  }

  startWoodcutting(event.player, event.object, tree, activeSessionsRef);

  // Tree clicks are fully handled by this plugin (including fail messages).
  event.handled = true;
}

function requestedChop(event) {
  let tree = [...TREES, ...FARMED_HARDWOODS].find(tree => tree.logId === event.logId);
  if (tree && event.removeOnly) tree = { ...tree, logId: -1, xpReward: 0, multi: false };
  if (tree) event.handled = startWoodcutting(event.player, event.object, tree, activeSessionsRef);
}

module.exports = {
  name: "Woodcutting",
  register(api) {
    pluginApi = api;
    api.onCustomEvent("woodcutting:chop", requestedChop);
    TaskManager = api.getTaskManager();
    ObjectManager = api.getObjectManager();
    ItemOnGroundManager = api.getItemOnGroundManager();
    const activeSessions = new Map();
    activeSessionsRef = activeSessions;

    TaskManager.submit(new WoodcuttingTask(activeSessions));

    api.onPlayerDisconnect(({ player }) => {
      stopWoodcutting(activeSessions, player, false);
    });
    api.onPlayerLevelUp(({ player }) => {
      stopWoodcutting(activeSessions, player, false);
    });

    api.onItemFirstAction((event) => {
      if (searchBirdNest(event.player, event.itemId)) {
        event.handled = true;
        return true;
      }
      return false;
    });

    for (const tree of TREES) {
      for (const name of tree.objectNames) {
        api.onObjectInteraction(name, { [tree.action]: handleChop });
      }
    }

    api.log("registered", {
      treeNames: TREES_BY_NAME.size,
      supportedTrees: TREES.length,
      axes: AXES.length,
    });
  },
  AXES,
  AXES_BY_REQUIREMENT_DESC,
  TREES,
  TREE_LOG_IDS,
  findBestUsableAxe,
  findBestUsableAxeByLevel,
  isWoodcuttingActive,
};
