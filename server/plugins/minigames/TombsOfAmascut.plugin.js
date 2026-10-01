"use strict";

/**
 * Tombs of Amascut: the Jaltevas pyramid lobby and party board, the raid itself (Nexus, the
 * four paths with their puzzles and bosses, the Wardens) and its rewards. Each unit lives in
 * ./toa/; add one line per unit.
 */
module.exports = {
  name: "TombsOfAmascut",
  register(api) {
    require("./toa/Lobby.TombsOfAmascut")(api);
    require("./toa/Raid.TombsOfAmascut")(api);
    require("./toa/Nexus.TombsOfAmascut")(api);
    require("./toa/Supplies.TombsOfAmascut")(api);
  },
};
