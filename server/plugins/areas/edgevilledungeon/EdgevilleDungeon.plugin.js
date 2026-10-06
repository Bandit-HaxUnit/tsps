/**
 * The Edgeville Dungeon (https://oldschool.runescape.wiki/w/Edgeville_Dungeon), from
 * data/definitions/edgeville-dungeon.json: the brass key door and the area's diary tasks, as
 * captured. Obor's and Bryophyta's lairs are plugins/bosses/giantlairs. See
 * docs/edgeville-dungeon.md.
 */
const fs = require("fs");
const path = require("path");
const { GameConstants } = require("../../../src/main/typescript/elvarg/game/GameConstants");
const BrassKeyDoor = require("./BrassKeyDoor");

const DATA = JSON.parse(
  fs.readFileSync(path.join(GameConstants.DEFINITIONS_DIRECTORY, "edgeville-dungeon.json"), "utf8"),
);
const DIARY = DATA.diary;

let api = null;

function bind(pluginApi) {
  api = pluginApi;
  BrassKeyDoor.bind(pluginApi, DATA.brassKeyDoor);
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
function npcKilled({ killer, npc }) {
  const warrior = DIARY.earthWarrior;
  if (!killer?.isPlayer?.() || npc?.getDefinition?.()?.getName?.() !== warrior.name) return;
  const at = npc.getLocation();
  const { minX, maxX, minY, maxY } = warrior.area;
  if (at.getX() >= minX && at.getX() <= maxX && at.getY() >= minY && at.getY() <= maxY) task(killer, warrior);
}

module.exports = {
  name: "EdgevilleDungeon",
  DATA,
  register(pluginApi) {
    bind(pluginApi);
    pluginApi.onObjectInteraction("Door", { Open: BrassKeyDoor.open });
    pluginApi.onNpcDeath(npcKilled);
    pluginApi.onCustomEvent("agility:obstacle", pipeSqueezed);
    pluginApi.onCustomEvent("slayer:task-assigned", taskAssigned);
  },
};
