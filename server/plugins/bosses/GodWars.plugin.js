"use strict";

/**
 * God Wars Dungeon generals. Each general lives in ./godwars/ and registers its
 * own combat method; add one line per general.
 */
module.exports = {
  name: "GodWars",
  register(api) {
    require("./godwars/GeneralGraardor.GodWars")(api);
    require("./godwars/KreeArra.GodWars")(api);
    require("./godwars/CommanderZilyana.GodWars")(api);
    require("./godwars/KrilTsutsaroth.GodWars")(api);
  },
};
