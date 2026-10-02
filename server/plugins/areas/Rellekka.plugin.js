/**
 * Rellekka area interactions.
 *
 * Tunnel at 2731,3712 > Enter: into Keldagrim's entrance cave at 2773,10162, and the cave's
 * Tunnel at 2771,10161 back out to 2730,3713. Tiles are Offline_Scape's (RSPS); the locs are the
 * cache's (5008/5014).
 */
const { Location } = require("../../src/main/typescript/elvarg/game/model/Location");

const TUNNELS = new Map([
  ["2731,3712", new Location(2773, 10162, 0)],
  ["2771,10161", new Location(2730, 3713, 0)],
]);

function enterTunnel(event) {
  const { player, location } = event;
  const destination = (location.z ?? 0) === 0 && TUNNELS.get(`${location.x},${location.y}`);
  if (!destination) return false;
  player.moveTo(destination.clone());
  event.handled = true;
}

module.exports = {
  name: "Rellekka",
  register(api) {
    api.onObjectInteraction("Tunnel", { Enter: enterTunnel });
  },
};
