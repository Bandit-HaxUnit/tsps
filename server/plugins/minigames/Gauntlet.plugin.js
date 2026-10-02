"use strict";

/**
 * The Gauntlet and the Corrupted Gauntlet: the lobby under Prifddinas, the maze built for each
 * run, and the Crystalline Hunllef. Each unit lives in ./gauntlet/; add one line per unit.
 */
module.exports = {
  name: "Gauntlet",
  register(api) {
    require("./gauntlet/Commands.Gauntlet")(api);
  },
};
