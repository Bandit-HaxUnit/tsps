/**
 * The Edgeville Dungeon (https://oldschool.runescape.wiki/w/Edgeville_Dungeon), from
 * data/definitions/giant-boss-lairs.json: the brass key door, Obor's and Bryophyta's lairs with
 * their bosses and chests, giant bones, and the area's diary tasks, as captured. See
 * docs/edgeville-dungeon.md.
 */
const Lair = require("./GiantLair");
const Obor = require("./Obor");
const Bryophyta = require("./Bryophyta");
const GiantBones = require("./GiantBones");
const BrassKeyDoor = require("./BrassKeyDoor");

const DIARY = Lair.DATA.diary;
const OBOR = Lair.DATA.lairs.obor;
const BRYOPHYTA = Lair.DATA.lairs.bryophyta;

let api = null;

function bind(pluginApi) {
  api = pluginApi;
  Lair.bind(pluginApi);
  Obor.bind(pluginApi);
  Bryophyta.bind(pluginApi);
  GiantBones.bind(pluginApi);
  BrassKeyDoor.bind(pluginApi);
}

const task = (player, { diary, task: key }) => api.emitCustomEvent("diary:task", { player, diary, task: key });

/** Varrock hard: the obstacle pipe between the dungeon and the Varrock Sewers. */
function pipeSqueezed({ player, objectId, location }) {
  const pipe = DIARY.pipe;
  if (objectId === pipe.object && location?.y === pipe.y && location.x >= pipe.minX && location.x <= pipe.maxX) task(player, pipe);
}

/** Varrock medium: a Slayer task from Vannaka. */
function taskAssigned({ player, master }) {
  if (master === DIARY.vannaka.master) task(player, DIARY.vannaka);
}

/** Wilderness easy: an Earth warrior in the dungeon's Wilderness part. */
function npcKilled(event) {
  Lair.onBossDeath(event);
  const { killer, npc } = event;
  const warrior = DIARY.earthWarrior;
  if (!killer?.isPlayer?.() || npc?.getDefinition?.()?.getName?.() !== warrior.name) return;
  const at = npc.getLocation();
  const { minX, maxX, minY, maxY } = warrior.area;
  if (at.getX() >= minX && at.getX() <= maxX && at.getY() >= minY && at.getY() <= maxY) task(killer, warrior);
}

module.exports = {
  name: "EdgevilleDungeon",
  register(pluginApi) {
    bind(pluginApi);
    for (const key of [...Lair.ATTRIBUTES, GiantBones.DATA.dontAskAttribute]) pluginApi.persistAttribute(key);
    pluginApi.onPlayerLogin(Lair.restore);
    pluginApi.onObjectInteraction("Door", { Open: BrassKeyDoor.open });
    pluginApi.onObjectInteraction("Gate", { Open: Lair.gate, "Quick-exit": Lair.quickExit });
    pluginApi.onObjectInteraction("Rock Pile", { Clamber: Lair.exitLair, "Quick-exit": Lair.quickExit });
    pluginApi.onObjectInteraction("Chest", { Open: Lair.openChest });
    pluginApi.onObjectInteraction("Rocks", { Climb: Obor.climbRocks });
    pluginApi.onObjectInteraction("Logs", { "Take-axe": Bryophyta.takeAxe });
    pluginApi.registerNpcCombatMethodProvider([OBOR.boss], Obor.defineOborCombatMethod(), { singleton: false });
    pluginApi.registerNpcCombatMethodProvider([BRYOPHYTA.boss], Bryophyta.defineBryophytaCombatMethod(), { singleton: false });
    pluginApi.onNpcHitModify(Bryophyta.modifyHit);
    pluginApi.onNpcDeath(npcKilled);
    pluginApi.onGroundItemPickup(GiantBones.take);
    pluginApi.onGroundItemClick(GiantBones.DATA.item, 3, GiantBones.bury);
    pluginApi.onCustomEvent("collection-log:category-count", Lair.collectionLogCount);
    pluginApi.onCustomEvent("agility:obstacle", pipeSqueezed);
    pluginApi.onCustomEvent("slayer:task-assigned", taskAssigned);
  },
};
