const registerCrystalArmourEffects = require("./effects/CrystalArmour");
const registerDharoksArmourEffects = require("./effects/DharoksArmour");
const registerObsidianEffects = require("./effects/ObsidianArmour");
const registerInquisitorsArmourEffects = require("./effects/InquisitorsArmour");
const registerChaosGauntletsEffects = require("./effects/ChaosGauntlets");

module.exports = {
  name: "EquipmentEffects",
  register(api) {
    // Crystal armour first: the Wiki applies it to the bow's base roll and max hit.
    registerCrystalArmourEffects(api);
    registerDharoksArmourEffects(api);
    registerObsidianEffects(api);
    registerInquisitorsArmourEffects(api);
    registerChaosGauntletsEffects(api);
  },
};
