"use strict";

module.exports = {
  name: "Scurrius",
  register(api) {
    require("./scurrius/ScurriusBoss")(api);
  },
};
