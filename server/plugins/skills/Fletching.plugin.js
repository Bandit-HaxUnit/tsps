/**
 * Fletching (docs/fletching.md): every recipe on the Wiki's Fletching page, from
 * data/fletching.json, with menus, messages and animations from rsprox captures.
 */

/** "fletching:shafts": the arrow shafts request.logId fletches into, how many and the XP, for content that fletches as it chops (a league relic). */
function answerShafts(request) {
  const recipe = Shared.getRecipes().find((candidate) => candidate.group === "logs"
    && candidate.materials.some((material) => material.ids.includes(request.logId)));
  if (!recipe) return;
  request.itemId = recipe.outputId;
  request.amount = recipe.amount;
  request.xp = recipe.xp;
}
const Shared = require("./fletching/Shared.Fletching");

const UNITS = [
  Shared,
  require("./fletching/Recipes.Fletching"),
  require("./fletching/Spool.Fletching"),
  require("./fletching/Diaries.Fletching"),
];

module.exports = {
  name: "Fletching",
  members: true,
  register(api) {
    for (const unit of UNITS) unit.init?.(api);
    for (const unit of UNITS) unit.attach?.(api);
    api.onCustomEvent("fletching:shafts", answerShafts);
  },
};
