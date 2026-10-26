/**
 * Power Miner (https://oldschool.runescape.wiki/w/Power_Miner_(Raging_Echoes_League)), Raging
 * Echoes' tier 1 relic: the Echo pickaxe (a crystal pickaxe with no requirement, in Mining's own
 * table), a failed swing's second 50% chance, ore straight to the bank, a rock that lasts four
 * ores, and the pickaxe's toggles: ore smelted into its bar (the first furnace recipe that takes
 * the ore, its other ingredients waived: ours) and gems cut, with the Smithing and Crafting XP
 * whatever the level.
 */
const Common = require("./Common.LeagueRelics");
const EchoTool = require("./EchoTool.LeagueRelics");

let api;
let core;
let effect;

/** Ores taken from each rock since it last depleted. */
const mined = new WeakMap();

function active(player) {
  return Common.effectActive(player, effect);
}

function secondChance(request) {
  if (!request.success && active(request.player) && Math.random() < effect.secondChance) request.success = true;
}

/** The rock stands until its fourth ore. */
function keepRock(request) {
  if (!active(request.player)) return;
  const count = (mined.get(request.object) ?? 0) + 1;
  if (count < effect.oresPerRock) {
    mined.set(request.object, count);
    request.handled = true;
  } else {
    mined.delete(request.object);
  }
}

/** What the ore becomes in the bank, with the XP it pays: a bar, a cut gem, or the ore itself. */
function processed(player, itemId) {
  const current = EchoTool.mode(player, effect);
  if (current.includes("smelt")) {
    const bar = { oreId: itemId, barId: null, xp: null };
    api.emitCustomEvent("smithing:bar-for-ore", bar);
    if (bar.barId) return { itemId: bar.barId, skill: core.Skill.SMITHING, xp: bar.xp };
  }
  if (current.includes("cut")) {
    const gem = { uncutId: itemId, cutId: null, xp: null };
    api.emitCustomEvent("crafting:cut-gem", gem);
    if (gem.cutId) return { itemId: gem.cutId, skill: core.Skill.CRAFTING, xp: gem.xp };
  }
  return { itemId, skill: null, xp: 0 };
}

/** Mined items go to the bank, smelted or cut on the way when the pickaxe says so. */
function gather(request) {
  const { player, amount } = request;
  if (request.stored >= amount || request.skill !== core.Skill.MINING || !active(player)) return;
  const result = processed(player, request.itemId);
  if (!Common.bank(player, result.itemId, amount - request.stored)) return;
  request.stored = amount;
  if (result.skill && result.xp > 0) player.getSkillManager().addExperiences(result.skill, result.xp * amount);
}

function room(request) {
  if (!request.room && active(request.player) && Common.bankHasRoom(request.player, request.itemId)) request.room = true;
}

module.exports = function attach(pluginApi) {
  api = pluginApi;
  core = api.core;
  effect = Common.data.effects.powerMiner;
  EchoTool.attach(api, effect);
  api.onCustomEvent("mining:attempt", secondChance);
  api.onCustomEvent("mining:deplete-rock", keepRock);
  api.onCustomEvent("storage:gather", gather);
  api.onCustomEvent("storage:room", room);
};
