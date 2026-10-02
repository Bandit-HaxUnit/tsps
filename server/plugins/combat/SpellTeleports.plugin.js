const { CacheDefinitions } = require("../../src/main/typescript/elvarg/game/cache/CacheDefinitions");
const { SpellTeleports } = require("../../src/main/typescript/elvarg/game/content/combat/magic/SpellTeleports");

function spellName(event) {
  const itemId = event.itemId ?? -1;
  const packed = Number.isInteger(event.groupId) && Number.isInteger(event.childId)
    ? (event.groupId << 16) | (event.childId & 0xffff)
    : -1;
  return CacheDefinitions.getSpellName(event.buttonId, itemId)
    ?? CacheDefinitions.getSpellName(packed, itemId)
    ?? CacheDefinitions.getSpellName(event.childId ?? -1, itemId);
}

let core;

/**
 * Teleport tablets share their spell's name ("Varrock teleport") and destination.
 * Breaking one checks the usual teleport rules (level 20 Wilderness, teleblock,
 * busy) first, so a refused tablet is never used up.
 * ponytail: "Teleport to house" is left out until there is a player-owned house.
 */
function breakTablet(event) {
  if (event.option?.toLowerCase() !== "break") return;
  const name = core.ItemDefinition.forId(event.itemId)?.getName?.()?.toLowerCase() ?? "";
  const destination = name === "teleport to house"
    ? null
    : SpellTeleports.getTeleportDestinations().find((spell) => spell.name === name)?.destination;
  if (!destination) return;
  event.handled = true;
  const { player } = event;
  if (!player.getInventory().contains(event.itemId) || !core.TeleportHandler.checkReqs(player, destination)) return;
  player.getInventory().deleteNumber(event.itemId, 1);
  core.TeleportHandler.teleport(player, destination, core.TeleportType.TELE_TAB, false);
}

module.exports = {
  name: "SpellTeleports",
  register(api) {
    core = api.core;
    api.onItemAction(breakTablet);
    api.onInterfaceActionClick((event) => {
      if (SpellTeleports.handleSelf(event.player, spellName(event))) {
        event.handled = true;
      }
    });
  },
};
