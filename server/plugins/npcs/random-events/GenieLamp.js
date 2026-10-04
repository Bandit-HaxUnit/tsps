"use strict";

// Skill-level reward/slot consumption adapted from Void RandomEventGift.kt (BSD-3).
const pending = new WeakMap();

function rub(api, { player, item, itemId, slot }) {
  if (itemId !== api.core.ItemIdentifiers.LAMP) return false;
  if (!player.isRegistered() || player.getInventory().get(slot) !== item) return true;
  const request = { item, slot };
  pending.set(player, request);
  chooseSkill(api, player, request, 0);
  return true;
}

function chooseSkill(api, player, request, page) {
  if (pending.get(player) !== request || !player.isRegistered()) return;
  const skills = api.core.Skill.values();
  const pairs = skills.slice(page * 4, page * 4 + 4).flatMap((skill) => [
    skill.getName(), () => confirm(api, player, request, skill),
  ]);
  if ((page + 1) * 4 < skills.length) pairs.push("More skills", () => chooseSkill(api, player, request, page + 1));
  else pairs.push("Back to first skills", () => chooseSkill(api, player, request, 0));
  api.sendMultiChatboxPrompt(player, "Which skill would you like experience in?", ...pairs);
}

function confirm(api, player, request, skill) {
  if (pending.get(player) !== request) return;
  api.sendMultiChatboxPrompt(player, `Use the lamp for ${skill.getName()} experience?`,
    "Yes", () => grant(api, player, request, skill),
    "Choose another skill", () => chooseSkill(api, player, request, 0));
}

function grant(api, player, request, skill) {
  if (pending.get(player) !== request) return;
  pending.delete(player);
  if (!player.isRegistered()) return;
  const inventory = player.getInventory();
  if (inventory.get(request.slot) !== request.item || request.item.getId() !== api.core.ItemIdentifiers.LAMP) return;
  const manager = player.getSkillManager();
  const before = manager.getExperience(skill);
  const xp = manager.getMaxLevel(skill) * 10;
  // Keep the lamp when a world/account rule blocks XP (F2P member skill, XP lock).
  manager.addExperience(skill, xp, false);
  if (manager.getExperience(skill) === before) {
    player.sendMessage("You cannot gain experience in that skill right now.");
    return;
  }
  inventory.deleteAtSlot(request.slot, 1);
  player.sendMessage(`Your wish has been granted! You gain ${xp} ${skill.getName()} experience.`);
}

function cleanup({ player }) { pending.delete(player); }

module.exports = { rub, cleanup };
