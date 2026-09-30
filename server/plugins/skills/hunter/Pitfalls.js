"use strict";

const { H, ANIM, requireLevel, hasTool, nearby, available, distance, begin, chance, hide } = require("./Context");
const Traps = require("./Traps");
const teased = new Map();

function build({ player, object }) {
  const def = H.core.CacheDefinitions.getObject(object.getId());
  if (def.transforms?.[0] !== H.core.ObjectIdentifiers.PIT) return false;
  Traps.lay(player, "pit", object.getLocation(), object);
  return true;
}

function tease({ player, npc, npcId }) {
  const creature = H.data.creatures.find(c => c.npc === npcId && c.trap === "pit");
  if (!creature) return false;
  if (!hasTool(player, H.core.ItemIdentifiers.TEASING_STICK)) { player.sendMessage("You need a teasing stick."); return true; }
  if (!requireLevel(player, creature.level) || !nearby(player, npc) || !available(npc) || teased.has(player)) return true;
  const state = { player, npc, creature, due: H.tick + 50 };
  if (begin(player, 1, ANIM.TEASE, () => {
    if (!available(npc) || !nearby(player, npc)) return;
    H.reserved.set(npc, state); teased.set(player, state);
    player.sendMessage("The creature follows you. Lead it to your pit and jump across.");
  })) return true;
  return true;
}

function clear({ player }) {
  const state = teased.get(player);
  if (!state) return;
  teased.delete(player);
  if (H.reserved.get(state.npc) === state) H.reserved.delete(state.npc);
  state.npc.getMovementQueue().reset();
}

function jump({ player, object }) {
  const trap = Traps.owned(player, object);
  if (!trap || trap.kind !== "pit") return false;
  if (!nearby(player, object, 3) || trap.state !== "idle") return true;
  const state = teased.get(player);
  const from = player.getLocation(), center = trap.location;
  const dx = Math.abs(from.getX() - center.getX()), dy = Math.abs(from.getY() - center.getY());
  const destination = center.clone().add(dx > dy ? (from.getX() <= center.getX() ? 3 : -3) : 0,
    dx > dy ? 0 : (from.getY() <= center.getY() ? 3 : -3));
  if (H.core.RegionManager.blocked(destination, trap.area)) { player.sendMessage("You cannot land on the other side of this pit."); return true; }
  begin(player, 2, ANIM.JUMP, () => {
    if (!H.traps.has(trap) || trap.state !== "idle") return;
    player.moveTo(destination);
    if (!state || teased.get(player) !== state || distance(state.npc.getLocation(), center) > 5) return;
    clear({ player });
    const success = chance(player, state.creature);
    Traps.setState(trap, success ? "caught" : "failed", success ? state.creature : null);
    if (success) hide(state.npc);
    player.sendMessage(success ? "The creature falls into your pit!" : "The creature leaps over your trap.");
  });
  return true;
}

function process() {
  for (const [player, state] of teased) {
    if (H.tick >= state.due || !state.npc.isRegistered() || !state.npc.isVisible() || !player.isRegistered()
      || !nearby(player, state.npc, 16)) { clear({ player }); continue; }
    if (H.tick % 2 === 0) H.core.PathFinder.calculateWalkRoute(state.npc, player.getLocation().getX(), player.getLocation().getY());
  }
}

module.exports = { build, tease, jump, clear, process };
