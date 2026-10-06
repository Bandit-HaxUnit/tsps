/**
 * Obor (https://oldschool.runescape.wiki/w/Obor) and Bryophyta
 * (https://oldschool.runescape.wiki/w/Bryophyta), from data/definitions/giant-boss-lairs.json:
 * their key-locked lairs, fights and chests, and their giant bones, as captured. See
 * docs/edgeville-dungeon.md.
 */
const Lair = require("./GiantLair");
const Obor = require("./Obor");
const Bryophyta = require("./Bryophyta");
const GiantBones = require("./GiantBones");

const OBOR = Lair.DATA.lairs.obor;
const BRYOPHYTA = Lair.DATA.lairs.bryophyta;

function bind(api) {
  Lair.bind(api);
  Obor.bind(api);
  Bryophyta.bind(api);
  GiantBones.bind(api);
}

module.exports = {
  name: "GiantLairs",
  register(api) {
    bind(api);
    for (const key of [...Lair.ATTRIBUTES, GiantBones.DATA.dontAskAttribute]) api.persistAttribute(key);
    api.onPlayerLogin(Lair.restore);
    api.onObjectInteraction("Gate", { Open: Lair.gate, "Quick-exit": Lair.quickExit });
    api.onObjectInteraction("Rock Pile", { Clamber: Lair.exitLair, "Quick-exit": Lair.quickExit });
    api.onObjectInteraction("Chest", { Open: Lair.openChest });
    api.onObjectInteraction("Rocks", { Climb: Obor.climbRocks });
    api.onObjectInteraction("Logs", { "Take-axe": Bryophyta.takeAxe });
    api.registerNpcCombatMethodProvider([OBOR.boss], Obor.defineOborCombatMethod(), { singleton: false });
    api.registerNpcCombatMethodProvider([BRYOPHYTA.boss], Bryophyta.defineBryophytaCombatMethod(), { singleton: false });
    api.onNpcHitModify(Bryophyta.modifyHit);
    api.onNpcDeath(Lair.onBossDeath);
    api.onGroundItemPickup(GiantBones.take);
    api.onGroundItemClick(GiantBones.DATA.item, 3, GiantBones.bury);
    api.onCustomEvent("collection-log:category-count", Lair.collectionLogCount);
  },
};
