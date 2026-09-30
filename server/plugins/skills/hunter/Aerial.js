"use strict";

const { H, level, requireLevel, hasTool, nearby, exchange, xp, begin, roll } = require("./Context");
const borrowed = new Set();

function glove(player, id) {
  player.getEquipment().set(H.core.Equipment.WEAPON_SLOT, new H.core.Item(id, id > 0 ? 1 : 0));
  player.getEquipment().refreshItems();
  player.getUpdateFlag().flag(H.core.Flag.APPEARANCE);
}

function borrow({ player }) {
  if (borrowed.has(player)) { cleanup({ player }); player.sendMessage("You return the cormorant to Alry."); return true; }
  if (!requireLevel(player, 35) || !requireLevel(player, 43, H.core.Skill.FISHING)) return true;
  const E = H.core.Equipment;
  if ([E.WEAPON_SLOT, E.SHIELD_SLOT, E.HANDS_SLOT].some(slot => player.getEquipment().get(slot).getId() > 0)) {
    player.sendMessage("Remove your weapon, shield and gloves before taking a cormorant."); return true;
  }
  borrowed.add(player);
  H.players.add(player);
  glove(player, H.core.ItemIdentifiers.CORMORANTS_GLOVE_2);
  player.sendMessage("Alry lends you a cormorant. Bring king worms to feed it.");
  return true;
}

function fish({ player, npc, npcId }) {
  if (npcId !== H.core.NpcIdentifiers.FISHING_SPOT_12) return false;
  if (!borrowed.has(player)) { player.sendMessage("Ask Alry for a cormorant first."); return true; }
  if (!nearby(player, npc, 9) || !requireLevel(player, 35) || !requireLevel(player, 43, H.core.Skill.FISHING)) return true;
  const I = H.core.ItemIdentifiers;
  const bait = I.KING_WORM;
  if (!player.getInventory().contains(bait)) { player.sendMessage("Your cormorant needs king worms."); return true; }
  const defs = H.data.aerialFish.filter(f => level(player) >= f.hunter && level(player, H.core.Skill.FISHING) >= f.fishing);
  const combined = (level(player, H.core.Skill.FISHING) * 2 + level(player)) / 3;
  const sample = Math.random() * combined;
  const index = sample >= 82 ? 3 : sample >= 67 ? 2 : sample >= 52 ? 1 : 0;
  const def = defs[Math.min(index, defs.length - 1)];
  const rewards = [[roll(1, 2000) === 1 ? I.GOLDEN_TENCH : def.item, 1]];
  const denominator = 100 - 25 * Math.max(0, Math.min(1, (combined - 40) / 59));
  if (Math.random() < 1 / denominator) rewards.push([I.MOLCH_PEARL, 1]);
  const consumed = roll(1, 4) === 1 ? [[bait, 1]] : [];
  if (!exchange(player, consumed, rewards, false)) { player.getInventory().full(); return true; }
  begin(player, 3, 8193, () => {
    if (!borrowed.has(player) || !nearby(player, npc, 9) || !player.getInventory().contains(bait) || !exchange(player, consumed, rewards)) return;
    xp(player, def.hunterXp, "aerial-fishing", npcId);
    player.getSkillManager().addExperiences(H.core.Skill.FISHING, def.fishingXp);
  });
  return true;
}


function tench(event) {
  if (event.itemId !== H.core.ItemIdentifiers.GOLDEN_TENCH || event.target.getId() !== H.core.NpcIdentifiers.ALRY_THE_ANGLER) return;
  event.handled = true;
  if (nearby(event.player, event.target) && exchange(event.player, [[event.itemId, 1]], [[H.core.ItemIdentifiers.MOLCH_PEARL, 100]]))
    event.player.sendMessage("Alry exchanges your golden tench for 100 Molch pearls.");
}

function equipment(event) {
  if (borrowed.has(event.player) && [H.core.Equipment.WEAPON_SLOT, H.core.Equipment.SHIELD_SLOT, H.core.Equipment.HANDS_SLOT].includes(event.slot)) {
    event.allow = false; event.player.sendMessage("Return your cormorant to Alry first.");
  }
}

function processPlayer({ player }) {
  const p = player.getLocation();
  if (borrowed.has(player) && (p.getZ() !== 0 || p.getX() < 1350 || p.getX() > 1400 || p.getY() < 3600 || p.getY() > 3650)) cleanup({ player });
}

function cleanup({ player }) {
  if (!borrowed.delete(player)) return;
  const I = H.core.ItemIdentifiers;
  if ([I.CORMORANTS_GLOVE, I.CORMORANTS_GLOVE_2].includes(player.getEquipment().get(H.core.Equipment.WEAPON_SLOT).getId())) glove(player, -1);
}

module.exports = { borrow, fish, tench, equipment, processPlayer, cleanup };
