"use strict";

/**
 * Keeps the world map's player marker on the player while the map is open. Opening the map sends
 * worldmap_transmitdata (1749) with the player's position (PacketSender.toggleWorldMap); after
 * that, as in an OSRS capture (docs/world-map.md), the server sends it again every 3 ticks with
 * the player's position from the start of that tick, but only when it changed since the last send.
 */

const { packWorldMapCoord } = require("../../src/main/typescript/elvarg/net/protocol/WorldMapProtocol");

const UPDATE_TICKS = 3;

/** player -> { ticks since the map opened, the player's position at the end of the last tick } */
const openMaps = new WeakMap();

function updateWorldMapPosition({ player }) {
  const packetSender = player.getPacketSender();
  if (!packetSender.isWorldMapOpen()) {
    openMaps.delete(player);
    return;
  }
  // The tick the map opened on counts as 0, so the first check is 3 ticks later.
  const state = openMaps.get(player) ?? { ticks: -1, last: null };
  openMaps.set(player, state);
  // This hook runs after the player's movement, so the tick started where the last one ended.
  const tickStart = state.last;
  state.last = player.getLocation().clone();
  if (++state.ticks % UPDATE_TICKS !== 0 || !tickStart) return;
  const packed = packWorldMapCoord(tickStart.getX(), tickStart.getY(), tickStart.getZ());
  if (packed !== packetSender.getWorldMapPosition()) packetSender.sendWorldMapPosition(tickStart);
}

module.exports = {
  name: "WorldMapPosition",
  register(api) {
    api.onPlayerProcess(updateWorldMapPosition);
  },
};

module.exports._test = { updateWorldMapPosition };
