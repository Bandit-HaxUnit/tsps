"use strict";

/**
 * Elnock Inquisitor (npc 5734) in Puro-Puro: the once-per-account equipment gift (butterfly
 * net, 7 impling jars, an impling scroll) and the four jar exchanges from Impetuous Impulses
 * (https://oldschool.runescape.wiki/w/Impetuous_Impulses#Elnock's_Exchange). The chatbox
 * menu uses the plugin API's five-option prompt: gift plus one option per trade.
 */
const GIFT_ATTRIBUTE = "impetuous-impulses:gift-claimed";

let core;
let pluginApi;
let trades;
let jarIds;

function build(coreApi) {
  const I = coreApi.ItemIdentifiers;
  jarIds = [I.BABY_IMPLING_JAR, I.YOUNG_IMPLING_JAR, I.GOURMET_IMPLING_JAR, I.EARTH_IMPLING_JAR,
    I.ESSENCE_IMPLING_JAR, I.ECLECTIC_IMPLING_JAR, I.NATURE_IMPLING_JAR, I.MAGPIE_IMPLING_JAR,
    I.NINJA_IMPLING_JAR, I.DRAGON_IMPLING_JAR, I.LUCKY_IMPLING_JAR, I.CRYSTAL_IMPLING_JAR];
  trades = {
    jars: {
      give: [I.IMPLING_JAR, 3],
      message: "Elnock takes the impling and gives you three impling jars.",
    },
    repellent: {
      remove: [[I.BABY_IMPLING_JAR, 3], [I.YOUNG_IMPLING_JAR, 2], [I.GOURMET_IMPLING_JAR, 1]],
      give: [I.IMP_REPELLENT, 1],
      message: "Elnock takes the impling jars and gives you some imp repellent.",
    },
    net: {
      remove: [[I.GOURMET_IMPLING_JAR, 3], [I.EARTH_IMPLING_JAR, 2], [I.ESSENCE_IMPLING_JAR, 1]],
      give: [I.MAGIC_BUTTERFLY_NET, 1],
      message: "Elnock takes the impling jars and gives you a magic butterfly net.",
    },
    generator: {
      remove: [[I.ESSENCE_IMPLING_JAR, 3], [I.ECLECTIC_IMPLING_JAR, 2], [I.NATURE_IMPLING_JAR, 1]],
      give: [I.JAR_GENERATOR, 1],
      message: "Elnock takes the impling jars and gives you a jar generator.",
    },
  };
}

function init(api) {
  core = api.core;
  pluginApi = api;
  build(core);
}

/** Preflight the whole exchange, then consume and give; never a partial trade. */
function trade(player, key) {
  const recipe = trades[key];
  if (!recipe) return false;
  const remove = recipe.remove ?? [[jarIds.find((id) => player.getInventory().getAmount(id) > 0) ?? 0, 1]];
  const missing = remove.find(([id, amount]) => !id || player.getInventory().getAmount(id) < amount);
  if (missing) {
    player.sendMessage(missing[0] ? "You don't have the implings for that trade." : "You don't have any impling jars to trade.");
    return false;
  }
  const freed = remove.reduce((sum, [, amount]) => sum + amount, 0);
  if (player.getInventory().getFreeSlots() + freed < recipe.give[1]) {
    player.sendMessage("You don't have enough inventory space.");
    return false;
  }
  for (const [id, amount] of remove) player.getInventory().deleteNumber(id, amount);
  player.getInventory().adds(recipe.give[0], recipe.give[1]);
  player.sendMessage(recipe.message);
  return true;
}

function gift(player) {
  const I = core.ItemIdentifiers;
  if (player.getAttribute(GIFT_ATTRIBUTE)) {
    player.sendMessage("Elnock has no more equipment to spare.");
    return false;
  }
  const items = [[I.BUTTERFLY_NET, 1], [I.IMPLING_JAR, 7], [I.IMPLING_SCROLL, 1]];
  const needed = items.reduce((sum, [, amount]) => sum + amount, 0);
  if (player.getInventory().getFreeSlots() < needed) {
    player.sendMessage("You need more free inventory space for Elnock's equipment.");
    return false;
  }
  for (const [id, amount] of items) player.getInventory().adds(id, amount);
  player.setAttribute(GIFT_ATTRIBUTE, true);
  player.sendMessage("Elnock Inquisitor gives you a butterfly net, 7 impling jars and an impling scroll.");
  return true;
}

function talk({ player }) {
  if (!gift(player)) exchange({ player });
}

function exchange({ player }) {
  pluginApi.sendMultiChatboxPrompt(player, "What would you like to ask about?",
    "Can you spare any equipment?", () => gift(player),
    "Trade an impling for three jars.", () => trade(player, "jars"),
    "Trade for some imp repellent.", () => trade(player, "repellent"),
    "Trade for a magic butterfly net.", () => trade(player, "net"),
    "Trade for a jar generator.", () => trade(player, "generator"));
}

function registerElnock(api) {
  init(api);
  api.persistAttribute(GIFT_ATTRIBUTE);
  api.onNpcInteraction("Elnock Inquisitor", { "Talk-to": talk, Exchange: exchange });
}

module.exports = registerElnock;
Object.assign(module.exports, { init, gift, trade, GIFT_ATTRIBUTE, _test: { init, gift, trade } });
