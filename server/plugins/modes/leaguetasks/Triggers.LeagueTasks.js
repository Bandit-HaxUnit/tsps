/**
 * Awarding tasks from the game, driven by each task's `trigger` (the generator's, or the overlay's;
 * docs/leagues.md lists the kinds): kills by NPC name on `onNpcDeath` with counts kept per name,
 * level kinds on `onPlayerLevelUp`, quests on `quest:completed` by name. Level and quest kinds are
 * also checked at login, so a character who already qualifies is not kept waiting for the next
 * event; kills are not (nothing was counted before). No task is named here: a new mapping is data.
 */
const Common = require("./Common.LeagueTasks");
const Complete = require("./Complete.LeagueTasks");

const LEVEL_KINDS = new Set(["level", "any-level", "total-level", "base-level", "combat-level"]);
/** League type -> { kills: Map(lower-cased npc name -> tasks), levels: tasks, quests: Map(plain quest name -> tasks) }. */
const index = new Map();
let skillsByName = null;

const plainName = (name) => String(name ?? "").toLowerCase().replace(/^the /, "").replace(/[^a-z0-9]+/g, " ").trim();

function indexOf(type) {
  if (index.has(type)) return index.get(type);
  const entry = { kills: new Map(), levels: [], levelUps: [], quests: new Map() };
  for (const task of Common.catalog(type).tasks) {
    const trigger = task.trigger;
    if (!trigger) continue;
    if (trigger.kind === "kill") {
      const key = String(trigger.npc).toLowerCase();
      entry.kills.set(key, (entry.kills.get(key) ?? []).concat(task));
    } else if (LEVEL_KINDS.has(trigger.kind)) {
      entry.levels.push(task);
    } else if (trigger.kind === "level-up") {
      entry.levelUps.push(task);
    } else if (trigger.kind === "quest") {
      const key = plainName(trigger.name);
      entry.quests.set(key, (entry.quests.get(key) ?? []).concat(task));
    }
  }
  index.set(type, entry);
  return entry;
}

/** The server's Skill constants by name (ATTACK, RUNECRAFTING...). */
function skills() {
  if (skillsByName) return skillsByName;
  const { Skill } = Common.core;
  skillsByName = new Map(Object.entries(Skill).filter(([, value]) => value instanceof Skill));
  return skillsByName;
}

function levelReached(player, trigger) {
  const manager = player.getSkillManager();
  const { Skill } = Common.core;
  switch (trigger.kind) {
    case "level": {
      const skill = skills().get(trigger.skill);
      return skill ? manager.getMaxLevel(skill) >= trigger.level : false;
    }
    case "any-level":
      return [...skills()].some(([name, skill]) => !(trigger.excluding ?? []).includes(name) && manager.getMaxLevel(skill) >= trigger.level);
    case "total-level":
      return manager.getTotalLevel() >= trigger.level;
    case "base-level":
      // Every skill of the leagues' day: Sailing came after both.
      return [...skills()].every(([name, skill]) => name === "SAILING" || manager.getMaxLevel(skill) >= trigger.level);
    case "combat-level":
      return manager.getCombatLevel() >= trigger.level;
    default:
      return false;
  }
}

function checkLevels(player) {
  const type = Common.leagueOf(player);
  if (type === null) return;
  for (const task of indexOf(type).levels) {
    if (levelReached(player, task.trigger)) Complete.complete(player, task.id);
  }
}

function levelUp({ player, oldLevel, newLevel }) {
  const type = Common.leagueOf(player);
  if (type === null) return;
  if (newLevel > oldLevel) for (const task of indexOf(type).levelUps) Complete.complete(player, task.id);
  checkLevels(player);
}

function killsOf(player) {
  const value = player.getAttribute(Common.KILLS_ATTRIBUTE);
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function npcName(npc) {
  return npc?.getCurrentDefinition?.()?.getName?.() ?? npc?.getDefinition?.()?.getName?.() ?? null;
}

function npcDeath(event) {
  const player = event?.killer;
  if (!player?.isPlayer?.() && !player?.getPacketSender) return;
  const type = Common.leagueOf(player);
  if (type === null) return;
  const name = String(npcName(event.npc) ?? "").toLowerCase();
  const tasks = indexOf(type).kills.get(name);
  if (!tasks) return;
  const kills = killsOf(player);
  const count = (Number(kills[name]) || 0) + 1;
  player.setAttribute(Common.KILLS_ATTRIBUTE, { ...kills, [name]: count });
  for (const task of tasks) {
    if (count >= (Number(task.trigger.count) || 1)) Complete.complete(player, task.id);
  }
}

function questCompleted({ player, quest }) {
  const type = Common.leagueOf(player);
  if (type === null) return;
  for (const task of indexOf(type).quests.get(plainName(quest?.name)) ?? []) Complete.complete(player, task.id);
}

function checkQuests(player, type) {
  for (const [, tasks] of indexOf(type).quests) {
    for (const task of tasks) {
      const query = { player, name: task.trigger.name, complete: false };
      Common.api.emitCustomEvent("quest:is-complete", query);
      if (query.complete === true) Complete.complete(player, task.id);
    }
  }
}

function login({ player, league }) {
  if (!Common.catalog(league)) return;
  checkLevels(player);
  checkQuests(player, league);
}

module.exports = function attach(api) {
  api.persistAttribute(Common.KILLS_ATTRIBUTE, {});
  api.onNpcDeath(npcDeath);
  api.onPlayerLevelUp(levelUp);
  api.onCustomEvent("quest:completed", questCompleted);
  api.onCustomEvent("league:login", login);
};
