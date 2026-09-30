// Shipwrights recover a sunk boat to their port for a fee by boat type (OSRS Wiki, Shipwright:
// raft 250, skiff 4,125, sloop 50,000; more for damage and built facilities, which boats don't
// have yet).
const { Sailing } = require("../../../src/main/typescript/elvarg/game/content/sailing/Sailing");
const { content, boatType } = require("./sailingContent");
const { dropLostOnRecovery } = require("./cargo");

/** The boat Sailing.recover would recover: the active boat first, as it checks. */
function sunkBoat(player) {
  return [Sailing.activeBoat(player), ...player.getSailing().boats].find((boat) => boat?.location.kind === "sunk");
}

function recoverBoat({ player, npc }) {
  const name = npc.getDefinition?.()?.getName?.() ?? "";
  const dock = content().docks.find((candidate) => candidate.shipwright === name);
  if (!dock) return false;
  const sunk = sunkBoat(player);
  player.sendMessage(Sailing.recover(player, dock.id, (boat) => boatType(boat.type)?.recoveryFee ?? 0));
  // A recovery loses salvage, courier crates and fish from the hold (OSRS Wiki, Cargo hold).
  if (sunk && sunk.location.kind === "docked") dropLostOnRecovery(sunk);
}

module.exports = {
  name: "SailingShipwright",
  register(api) {
    const { docks } = content();
    for (const shipwright of new Set(docks.map((dock) => dock.shipwright).filter(Boolean))) {
      api.onNpcInteraction(shipwright, { "Recover-boat": recoverBoat });
    }
  },
};
