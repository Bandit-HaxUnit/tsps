/**
 * Tai Bwo Wannai Cleanup (https://oldschool.runescape.wiki/w/Tai_Bwo_Wannai_Cleanup), from
 * plugins/minigames/data/tai-bwo-wannai-cleanup.json and the rsprox recordings 227/01858,
 * 237/01102 and 231/03030: hacking the jungle around the village, repairing its fence, the favour
 * that earns and the trading sticks the villagers give for it, and what the jungle hides: its
 * monsters, Broodoo victims, gout tubers and gem rocks. Each part lives in
 * ./taibwowannaicleanup/.
 */
const Common = require("./taibwowannaicleanup/Common.TaiBwoWannaiCleanup");

module.exports = {
  name: "TaiBwoWannaiCleanup",
  members: true,
  register(api) {
    Common.init(api);
    require("./taibwowannaicleanup/Locs.TaiBwoWannaiCleanup").attachLocs(api);
    require("./taibwowannaicleanup/Favour.TaiBwoWannaiCleanup").attachFavour(api);
    require("./taibwowannaicleanup/Jungle.TaiBwoWannaiCleanup").attachJungle(api);
    require("./taibwowannaicleanup/Fence.TaiBwoWannaiCleanup").attachFence(api);
    require("./taibwowannaicleanup/Villagers.TaiBwoWannaiCleanup").attachVillagers(api);
    require("./taibwowannaicleanup/Skewers.TaiBwoWannaiCleanup").attachSkewers(api);
    require("./taibwowannaicleanup/Events.TaiBwoWannaiCleanup").attachEvents(api);
    require("./taibwowannaicleanup/GemRock.TaiBwoWannaiCleanup").attachGemRock(api);
    require("./taibwowannaicleanup/Broodoo.TaiBwoWannaiCleanup").attachBroodoo(api);
  },
};
