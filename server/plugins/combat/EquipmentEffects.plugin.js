const registerDharoksArmourEffects = require("./effects/DharoksArmour");
const registerObsidianEffects = require("./effects/ObsidianArmour");
const registerInquisitorsArmourEffects = require("./effects/InquisitorsArmour");
const registerChaosGauntletsEffects = require("./effects/ChaosGauntlets");

module.exports = {
  name: "EquipmentEffects",
  register(api) {
    registerDharoksArmourEffects(api);
    registerObsidianEffects(api);
    registerInquisitorsArmourEffects(api);
    registerChaosGauntletsEffects(api);
  },
};
