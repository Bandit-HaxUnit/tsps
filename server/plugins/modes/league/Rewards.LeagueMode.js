/**
 * The Leagues Reward Shop (league_rewards 658, data.rewards). The stock is the cache's own: each
 * league struct lists its reward structs (name, item, cost), and the client draws them all, rows
 * running across the leagues in order. The server opens the screen as captured, sets the selected
 * row's varbit on a row click, and sells the selected reward on Confirm.
 *
 * Points: the Wiki pools every league's points and sells every league's rewards in the main game.
 * A main character's points are its league character's (Records' `league:account-points`), less
 * what it has spent here (`league:reward-points-spent`); what is left goes out as varp 2613. On a
 * league world the shop opens to browse: live sends no points there, and the client hides Confirm
 * where the league struct says so. The Bank PIN guards the shop.
 *
 * Opened by the Leagues Tutor's Trade (main game) and Rewards (league world) options, the
 * conversations' open_shop "Leagues Reward Shop", and `::leagueshop`.
 */
const Common = require("./Common.LeagueMode");
const { FLAG_OP1 } = require("../../interface/widgetGroup");

/** Points this main character has spent in the shop. */
const SPENT_ATTRIBUTE = "league:reward-points-spent";
const TUTOR = "Leagues Tutor";

/** Per player: the row selected (the server's copy of varbit 10110). */
const selection = new WeakMap();
/** The cache's rewards, one per row: { league, struct, name, item, cost }; read once. */
let stockList = null;

function uid(group, child) {
  return (group << 16) | child;
}

function rewards() {
  return Common.data.rewards;
}

function stock() {
  if (stockList) return stockList;
  const { CacheDefinitions } = Common.core;
  const { params } = rewards();
  const entries = (id) => [...CacheDefinitions.getEnumValues(id).entries()].sort(([a], [b]) => a - b);
  stockList = [];
  // The client walks enum 2670's leagues in order; data.leagues holds the same structs by type.
  const leagues = Object.entries(Common.data.leagues).map(([type, row]) => [Number(type), row.struct]).sort(([a], [b]) => a - b);
  for (const [league, leagueStruct] of leagues) {
    const list = CacheDefinitions.getStructParams(Number(leagueStruct))?.get(params.rewards);
    if (list === undefined || list === -1) continue;
    for (const [, struct] of entries(Number(list))) {
      const row = CacheDefinitions.getStructParams(Number(struct));
      stockList.push({
        league: Number(league),
        struct: Number(struct),
        name: String(row?.get(params.name) ?? ""),
        item: Number(row?.get(params.item) ?? -1),
        cost: Number(row?.get(params.cost)) || 0,
      });
    }
  }
  return stockList;
}

/** A main character on a plain world: the only place rewards are bought. */
function isMainGame(player) {
  return !Common.isLeagueProfile(player) && Common.worldLeague() === null;
}

function earned(player) {
  const query = { player, leagues: {}, total: 0 };
  Common.api.emitCustomEvent("league:account-points", query);
  return Number(query.total) || 0;
}

function spent(player) {
  return Number(player.getAttribute(SPENT_ATTRIBUTE)) || 0;
}

/** The points left to spend. */
function available(player) {
  return Math.max(0, earned(player) - spent(player));
}

function sendPoints(player) {
  if (isMainGame(player)) player.getPacketSender().sendConfig(rewards().pointsVarp, available(player));
}

function open(player) {
  const { group, rows, modalSize, pinFeature } = rewards();
  const guard = { player, feature: pinFeature, resume: () => open(player) };
  Common.api.emitCustomEvent("bank-pin:guard", guard);
  if (guard.locked) return true;
  selection.delete(player);
  sendPoints(player);
  const sender = player.getPacketSender();
  sender.sendInterfaceScript(Common.data.panels.modalSizeScript, modalSize);
  sender.sendInterface(group);
  sender.sendInterfaceFlagsRange(uid(group, rows), 0, stock().length - 1, FLAG_OP1);
  return true;
}

function isOpen(player) {
  return player.getInterfaceId() === rewards().group;
}

/** A row click: the client shows that reward and its Confirm. */
function select({ player, slot }) {
  if (!isOpen(player)) return true;
  const row = Number(slot);
  if (!Number.isInteger(row) || !stock()[row]) return true;
  selection.set(player, row);
  player.getPacketSender().sendVarbit(rewards().selectionVarbit, row);
  return true;
}

function hasRoom(player, item) {
  const inventory = player.getInventory();
  if (inventory.getFreeSlots() > 0) return true;
  return Common.core.ItemDefinition.forId(item)?.isStackable?.() === true && inventory.contains(item);
}

/** Confirm: the selected reward, paid for with the points left. */
function confirm({ player }) {
  if (!isOpen(player)) return true;
  const reward = stock()[selection.get(player)];
  if (!reward || reward.item < 0 || !isMainGame(player)) return true;
  if (available(player) < reward.cost) return true;
  if (!hasRoom(player, reward.item)) {
    player.sendMessage("You don't have enough inventory space.");
    return true;
  }
  player.setAttribute(SPENT_ATTRIBUTE, spent(player) + reward.cost);
  player.getInventory().adds(reward.item, 1);
  selection.delete(player);
  // The client redraws the list (and clears its selection) when the points change.
  sendPoints(player);
  return true;
}

function trade({ player }) {
  return open(player);
}

/** The Leagues Tutor's conversations end in open_shop "Leagues Reward Shop". */
function dialogueAction(event) {
  if (event.handled || event.action !== "open_shop" || event.target !== rewards().shopTarget) return;
  event.handled = true;
  event.end = true;
  // The conversation closes its window as it ends; the shop opens on the next tick.
  Common.later(event.player, 1, () => open(event.player));
}

function login({ player }) {
  sendPoints(player);
}

function shopCommand({ player }) {
  open(player);
  return true;
}

function npcOptions() {
  return Object.fromEntries(rewards().npcOptions.map((option) => [option, trade]));
}

function buttons() {
  const { group, rows, confirm: confirmButton } = rewards();
  return { rowsButton: uid(group, rows), confirmButton: uid(group, confirmButton) };
}

module.exports = function attach(api) {
  const { rowsButton, confirmButton } = buttons();
  api.persistAttribute(SPENT_ATTRIBUTE, 0);
  // After Records' login, which reads the league save these points come from.
  api.onPlayerLogin(login);
  api.onNpcInteraction(TUTOR, npcOptions());
  api.onCustomEvent("npc-dialogue:action", dialogueAction);
  api.onInterfaceActionButton(rowsButton, select);
  api.onInterfaceActionButton(confirmButton, confirm);
  api.registerCommand("leagueshop", shopCommand, api.core.PlayerRights.DEVELOPER, "Open the Leagues Reward Shop: ::leagueshop");
};

module.exports._test = { stock, available, SPENT_ATTRIBUTE };
