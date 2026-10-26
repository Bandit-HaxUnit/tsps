/**
 * Endless Harvest (https://oldschool.runescape.wiki/w/Endless_Harvest_(Trailblazer_Reloaded_League)),
 * Trailblazer Reloaded's tier 1 relic: what Mining, Woodcutting and Fishing gather is doubled, with
 * the experience of the second resource, and goes straight to the bank (the inventory when the
 * bank is full). It hears the skills' `storage:gather` (with the skill and the resource's XP) and
 * `storage:room`, so a full inventory does not stop the gathering.
 */
const Common = require("./Common.LeagueRelics");

let core;
let effect;
let skills;

function active(player) {
  return Common.effectActive(player, effect);
}

function harvested(skill) {
  if (!skills) skills = new Set(effect.skills.map((name) => core.Skill[name]).filter(Boolean));
  return skills.has(skill);
}

/** Twice the resource: to the bank when it has room, else the inventory takes what fits; the extra pays its XP. */
function gather(request) {
  const { player, itemId, amount, skill, xp } = request;
  if (request.stored >= amount || !harvested(skill) || !active(player)) return;
  const doubled = amount * effect.multiplier;
  if (Common.bank(player, itemId, doubled)) {
    request.stored = amount;
  } else {
    const extra = Math.min(doubled - amount, player.getInventory().getAddableAmount(new core.Item(itemId, doubled)) - (amount - request.stored));
    if (extra > 0) player.getInventory().adds(itemId, extra);
  }
  if (xp > 0) player.getSkillManager().addExperiences(skill, xp);
}

/** `storage:room`: the bank's room counts, so a full inventory keeps gathering. */
function room(request) {
  if (!request.room && active(request.player) && Common.bankHasRoom(request.player, request.itemId)) request.room = true;
}

module.exports = function attach(api) {
  core = api.core;
  effect = Common.data.effects.endlessHarvest;
  api.onCustomEvent("storage:gather", gather);
  api.onCustomEvent("storage:room", room);
};
