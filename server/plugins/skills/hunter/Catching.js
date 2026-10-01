"use strict";

const C = require("./Context");
const { H, ANIM, level, requireLevel, hasTool, nearby, available, roll, exchange, xp, begin, hide } = C;
const tables = require("./ImplingLoot.json");
const falcons = new Map();
const caught = new Map();

function gloves(player, id) {
  player.getEquipment().set(H.core.Equipment.WEAPON_SLOT, new H.core.Item(id, id > 0 ? 1 : 0));
  player.getEquipment().refreshItems();
  player.getUpdateFlag().flag(H.core.Flag.APPEARANCE);
}

function hasFalcon(player) {
  const I = H.core.ItemIdentifiers;
  return [I.FALCONERS_GLOVE, I.FALCONERS_GLOVE_2].includes(player.getEquipment().get(H.core.Equipment.WEAPON_SLOT).getId());
}

function hire({ player }) {
  const I = H.core.ItemIdentifiers, E = H.core.Equipment;
  if (hasFalcon(player)) { cleanup({ player }); player.sendMessage("You return the falcon to Matthias."); return true; }
  if (!requireLevel(player, 43)) return true;
  if ([E.WEAPON_SLOT, E.SHIELD_SLOT, E.HANDS_SLOT].some(slot => player.getEquipment().get(slot).getId() > 0)) {
    player.sendMessage("Remove your weapon, shield and gloves before borrowing a falcon."); return true;
  }
  if (!exchange(player, [[I.COINS, 500]], [])) { player.sendMessage("It costs 500 coins to borrow a falcon."); return true; }
  gloves(player, I.FALCONERS_GLOVE_2);
  H.players.add(player);
  player.sendMessage("Matthias lends you a falcon. Catch a kebbit, then retrieve the falcon and its prey.");
  return true;
}

function catchFalcon(player, npc, def) {
  const I = H.core.ItemIdentifiers;
  if (!hasFalcon(player)) { player.sendMessage("Borrow a falcon from Matthias first."); return; }
  if (falcons.has(player) || player.getEquipment().get(H.core.Equipment.WEAPON_SLOT).getId() !== I.FALCONERS_GLOVE_2) {
    player.sendMessage("Retrieve your falcon before sending it out again."); return;
  }
  if (!requireLevel(player, def.level) || !nearby(player, npc, 8) || !available(npc)) return;
  const reservation = { player };
  H.reserved.set(npc, reservation);
  const cancel = () => { if (H.reserved.get(npc) === reservation) H.reserved.delete(npc); if (hasFalcon(player)) gloves(player, I.FALCONERS_GLOVE_2); };
  if (!begin(player, 2, 1560, () => {
    H.reserved.delete(npc);
    if (!hasFalcon(player) || !available(npc) || !nearby(player, npc, 8)) { cancel(); return; }
    if (Math.random() > Math.min(0.95, 0.6 + (level(player) - def.level) * 0.006)) {
      cancel(); player.sendMessage("The kebbit evades your falcon."); return;
    }
    const falcon = H.api.spawnNpc({ id: def.falcon, x: npc.getLocation().getX(), y: npc.getLocation().getY(),
      z: npc.getLocation().getZ(), wanderRadius: 0, owner: player, ownerOnly: true });
    if (!falcon) { cancel(); return; }
    if (player.getPrivateArea()) falcon.setArea(player.getPrivateArea());
    falcon.getMovementQueue().setBlockMovement(true);
    falcon.untargetable = true;
    const state = { falcon, player, def, due: H.tick + 100 };
    falcons.set(player, state); caught.set(falcon, state);
    hide(npc);
    player.sendMessage("Your falcon catches the kebbit. Retrieve it to collect the catch.");
  }, cancel)) cancel();
  else gloves(player, I.FALCONERS_GLOVE);
}

function retrieve({ player, npc }) {
  const state = caught.get(npc);
  if (!state) return false;
  if (state.player !== player) { player.sendMessage("This isn't your falcon."); return true; }
  if (!nearby(player, npc)) return true;
  const loot = [[H.core.ItemIdentifiers.BONES, 1], [state.def.fur, 1]];
  if (!exchange(player, [], loot, false)) { player.getInventory().full(); return true; }
  begin(player, 1, ANIM.NET, () => {
    if (caught.get(npc) !== state || !exchange(player, [], loot)) return;
    xp(player, state.def.xp, "falconry", state.def.npc);
    removeFalcon(state);
  });
  return true;
}

function removeFalcon(state) {
  caught.delete(state.falcon); falcons.delete(state.player);
  H.api.removeNpc(state.falcon);
  state.falcon.getPrivateArea()?.detach(state.falcon);
  if (hasFalcon(state.player)) gloves(state.player, H.core.ItemIdentifiers.FALCONERS_GLOVE_2);
}

function catchNpc({ player, npc, npcId }) {
  const butterfly = H.data.butterflies.find(c => c.npc === npcId);
  const impling = H.data.implings.find(c => c.npcs.includes(npcId));
  const falcon = H.data.falconry.find(c => c.npc === npcId);
  if (falcon) { catchFalcon(player, npc, falcon); return true; }
  if (!butterfly && !impling) return false;
  if (!available(npc) || !nearby(player, npc)) return true;
  const I = H.core.ItemIdentifiers;
  const net = hasTool(player, I.BUTTERFLY_NET) || hasTool(player, I.MAGIC_BUTTERFLY_NET);
  const def = butterfly ?? impling;
  const jar = butterfly ? I.BUTTERFLY_JAR : I.IMPLING_JAR;
  const jarred = player.getInventory().contains(jar);
  if (net && !jarred) { player.sendMessage("You need an empty jar to use your net."); return true; }
  if (!requireLevel(player, net ? def.level : def.hands)) return true;
  const inputs = jarred ? [[jar, 1]] : [], outputs = jarred ? [[def.jar, 1]] : [];
  if (!exchange(player, inputs, outputs, false)) { player.getInventory().full(); return true; }
  const token = { player };
  H.reserved.set(npc, token);
  const cancel = () => { if (H.reserved.get(npc) === token) H.reserved.delete(npc); };
  if (!begin(player, 2, jarred ? ANIM.NET : ANIM.SMALL, () => {
    cancel();
    if (!available(npc) || !nearby(player, npc) || (net && !hasTool(player, I.BUTTERFLY_NET) && !hasTool(player, I.MAGIC_BUTTERFLY_NET))) return;
    // ponytail: bounded level-based net success; replace with species curves when measured.
    if (Math.random() >= Math.min(0.95, 0.55 + (level(player) - (net ? def.level : def.hands)) * 0.01)) {
      player.sendMessage("The creature slips away."); return;
    }
    if (!exchange(player, inputs, outputs)) return;
    const puro = player.getLocation().getX() >= 2560 && player.getLocation().getX() <= 2623
      && player.getLocation().getY() >= 4288 && player.getLocation().getY() <= 4351;
    xp(player, butterfly ? (net ? def.xp : def.handsXp) : (puro ? def.puroXp : def.xp), butterfly ? "butterfly" : "impling", npcId);
    if (butterfly && !jarred) bonus(player, def);
    hide(npc, impling ? 100 : 10);
    player.sendMessage(jarred ? "You catch the creature in a jar." : "You catch the creature barehanded and release it.");
  }, cancel)) cancel();
  return true;
}

function release({ player, itemId }) {
  const def = H.data.butterflies.find(c => c.jar === itemId);
  if (!def) return false;
  if (exchange(player, [[itemId, 1]], [[H.core.ItemIdentifiers.BUTTERFLY_JAR, 1]])) {
    bonus(player, def); player.sendMessage("You release the butterfly.");
  }
  return true;
}

function bonus(player, def) {
  const skills = player.getSkillManager(), max = skills.getMaxLevel(def.boost), current = skills.getCurrentLevel(def.boost);
  if (def.boost === H.core.Skill.HITPOINTS) skills.setCurrentLevels(def.boost, Math.min(max, current + 15));
  else skills.setCurrentLevels(def.boost, Math.max(current, max + Math.floor(max * 0.15) + 4));
}

function boost(event) {
  const def = H.data.butterflies.find(c => c.jar === event.itemId);
  if (!def) return;
  event.handled = true;
  const { player, target } = event;
  if (!nearby(player, target) || target.getAttribute("acceptAid") === false || target.getHitpoints() <= 0
    || !exchange(player, [[def.jar, 1]], [[H.core.ItemIdentifiers.BUTTERFLY_JAR, 1]])) return;
  bonus(target, def);
  target.sendMessage("A butterfly restores your vigour.");
}

function loot(event) {
  const def = H.data.implings.find(c => c.jar === event.itemId);
  if (!def) return false;
  const { player, itemId } = event, I = H.core.ItemIdentifiers;
  if (player.getInventory().getFreeSlots() < 2) { player.getInventory().full(); return true; }
  let rewards;
  if (def.key === "LUCKY") {
    const request = { player, rewards: null };
    H.api.emitCustomEvent("hunter:lucky-loot", request);
    if (!Array.isArray(request.rewards) || !request.rewards.length) {
      player.sendMessage("Lucky impling rewards require the treasure-trail reward system. Keep this jar for now."); return true;
    }
    rewards = request.rewards;
  } else {
    const rows = tables[def.key];
    let draw = roll(1, rows.reduce((sum, r) => sum + r[1], 0)), row;
    for (const candidate of rows) { draw -= candidate[1]; if (draw <= 0) { row = candidate; break; } }
    const base = I[row[0]], id = row[4] ? H.core.ItemDefinition.forId(base).getNoteId() : base;
    rewards = [[id, roll(row[2], row[3])]];
    if (def.key === "CRYSTAL" && roll(1, 100) === 1) rewards.push([I.ELVEN_SIGNET, 1]);
  }
  const clues = { BABY: [I.CLUE_SCROLL_EASY_, 50], YOUNG: [I.CLUE_SCROLL_EASY_, 20], GOURMET: [I.CLUE_SCROLL_EASY_, 10],
    EARTH: [I.CLUE_SCROLL_MEDIUM_, 50], ESSENCE: [I.CLUE_SCROLL_MEDIUM_, 20], ECLECTIC: [I.CLUE_SCROLL_MEDIUM_, 10],
    NATURE: [I.CLUE_SCROLL_HARD_, 50], MAGPIE: [I.CLUE_SCROLL_HARD_, 20], NINJA: [I.CLUE_SCROLL_HARD_, 10],
    DRAGON: [I.CLUE_SCROLL_ELITE_, 20], CRYSTAL: [I.CLUE_SCROLL_ELITE_, 20] };
  const clue = clues[def.key];
  if (clue && roll(1, clue[1]) === 1 && !player.getInventory().contains(clue[0])
    && !Array.from({ length: H.core.Bank.TOTAL_BANK_TABS }, (_, tab) => player.getBank(tab)).some(bank => bank?.contains(clue[0]))) rewards.push([clue[0], 1]);
  if (roll(1, 10) !== 1) rewards.push([I.IMPLING_JAR, 1]);
  if (!exchange(player, [[itemId, 1]], rewards)) player.getInventory().full();
  return true;
}

function equipment(event) {
  if (hasFalcon(event.player) && [H.core.Equipment.WEAPON_SLOT, H.core.Equipment.SHIELD_SLOT, H.core.Equipment.HANDS_SLOT].includes(event.slot)) {
    event.allow = false; event.player.sendMessage("Return your falcon to Matthias first.");
  }
}

function processPlayer({ player }) {
  const p = player.getLocation();
  if (hasFalcon(player) && (p.getZ() !== 0 || p.getX() < 2360 || p.getX() > 2399 || p.getY() < 3570 || p.getY() > 3620)) cleanup({ player });
}

function process() {
  for (const state of caught.values()) if (H.tick >= state.due || !state.falcon.isRegistered()) removeFalcon(state);
}

function cleanup({ player }) {
  const state = falcons.get(player);
  if (state) removeFalcon(state);
  if (hasFalcon(player)) gloves(player, -1);
}

module.exports = { catchNpc, hire, retrieve, release, boost, loot, equipment, process, processPlayer, cleanup };
