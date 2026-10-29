"use strict";

/**
 * Castle Wars barricades. Set up from the inventory on your own tile during a game, up to a cap
 * per team; they never fight back (combat:no-retaliate), so they never turn to their attacker.
 *
 * A tinderbox sets one alight and it burns down; a bucket of water puts it out. An explosive
 * potion blows one up outright, but not while it is burning (OSRS Wiki: Barricade).
 *
 * Lighting and blasting require explicit item use; the burning forms still offer Extinguish.
 */

// ponytail: the Wiki says burning barricades "take time to collapse" without a figure.
const BURN_TICKS = 10;
const burns = new WeakMap();

let game;
let core;
let data;
let RegionManager;
let World;

function setupBarricade({ player }) {
  const location = player.getLocation();
  const teamId = game.getTeamId(player);
  if (!game.isPlaying(player) || !game.inGameBounds(location)) {
    player.sendMessage("You can only set up barricades during a Castle Wars game.");
    return true;
  }
  if (
    RegionManager.blocked(location, player.getPrivateArea()) ||
    game.isSteppingStone(game.getLocationTile(location)) ||
    World.isNpcOccupyingTile(location, null, 1, player.getPrivateArea())
  ) {
    player.sendMessage("You can't set up a barricade here.");
    return true;
  }
  const limit = game.getBarricadeLimit?.() ?? data.MAX_BARRICADES;
  if (game.teamBarricadeCount(teamId) >= limit) {
    player.sendMessage(`Your team already has ${limit} barricades set up.`);
    return true;
  }
  const barricade = new core.NPC(data.BARRICADE_NPC[teamId], location.clone());
  barricade.setFlag("combat:no-retaliate");
  barricade.__skipDefaultRespawn = true;
  if (!World.getNpcs().add(barricade)) {
    player.sendMessage("You can't set up another barricade right now.");
    return true;
  }
  game.trackBarricade(barricade, teamId);
  player.getInventory().delete(core.ItemIdentifiers.BARRICADE, 1);
  return true;
}

function releaseDeadBarricade({ npc }) {
  if (!game.isBarricade(npc)) {
    return;
  }
  npc.__skipDefaultRespawn = true;
  game.releaseBarricade(npc);
}

function isBurning(npc) {
  return npc.getNpcTransformationId() !== -1;
}

function blowUp(player, npc, slot) {
  if (isBurning(npc)) {
    player.sendMessage("You can't blow up a burning barricade.");
    return;
  }
  player.getInventory().deleteAtSlot(slot, 1);
  const explosion = core.CacheDefinitions.getSpotanimId("regicide_barrelflight_exploding");
  player.getPacketSender().sendGlobalGraphic(new core.Graphic(explosion), npc.getLocation());
  game.removeBarricade(npc);
}

function burnDown(npc, burn) {
  if (burns.get(npc) === burn && game.isBarricade(npc) && isBurning(npc)) {
    burns.delete(npc);
    game.removeBarricade(npc);
  }
}

function burnBarricade({ player, npc }) {
  if (!game.isBarricade(npc) || isBurning(npc)) {
    return false;
  }
  if (!player.getInventory().contains(core.ItemIdentifiers.TINDERBOX)) {
    return false;
  }
  if (player.getLocation().equals(npc.getLocation())) {
    const movement = player.getMovementQueue();
    const dx = [-1, 1].find((step) => movement.canWalk(step, 0)
      && !World.isNpcOccupyingTile(player.getLocation().transform(step, 0), null, 1, player.getPrivateArea()));
    if (dx == null) {
      player.sendMessage("You need room to step beside the barricade before lighting it.");
      return true;
    }
    movement.walkStep(dx, 0);
  }
  const burn = {};
  burns.set(npc, burn);
  npc.setNpcTransformationId(npc.getId() + 1);
  game.later(BURN_TICKS, () => burnDown(npc, burn));
  return true;
}

function requireManualBurn({ player, npc }) {
  if (!game.isBarricade(npc)) {
    return false;
  }
  player.sendMessage("Use a tinderbox or explosive potion on the barricade.");
  return true;
}

function extinguishBarricade({ player, npc }) {
  if (!game.isBarricade(npc) || !isBurning(npc)) {
    return false;
  }
  const { BUCKET_OF_WATER, BUCKET } = core.ItemIdentifiers;
  if (!player.getInventory().contains(BUCKET_OF_WATER)) {
    player.sendMessage("You need a bucket of water to put out the fire.");
    return true;
  }
  player.getInventory().delete(BUCKET_OF_WATER, 1);
  player.getInventory().adds(BUCKET, 1);
  npc.setNpcTransformationId(-1);
  burns.delete(npc);
  return true;
}

function useItemOnBarricade(event) {
  const { player, target, itemId, slot } = event;
  if (!game.isBarricade(target)) {
    return;
  }
  const { TINDERBOX, EXPLOSIVE_POTION, BUCKET_OF_WATER } = core.ItemIdentifiers;
  if (itemId === EXPLOSIVE_POTION) {
    blowUp(player, target, slot);
  } else if (itemId === TINDERBOX) {
    burnBarricade({ player, npc: target });
  } else if (itemId === BUCKET_OF_WATER) {
    extinguishBarricade({ player, npc: target });
  } else {
    return;
  }
  event.handled = true;
}

module.exports = function attachCastleWarsBarricades(api, castleWars) {
  game = castleWars;
  core = api.core;
  data = castleWars.data;
  RegionManager = api.getRegionManager();
  World = api.getWorld();
  api.onItemAction("Barricade", { "Set-up": setupBarricade });
  api.onNpcDeath(releaseDeadBarricade);
  api.onNpcInteraction("Barricade", { Burn: requireManualBurn, Extinguish: extinguishBarricade });
  api.onItemOnNpc(useItemOnBarricade);
};
