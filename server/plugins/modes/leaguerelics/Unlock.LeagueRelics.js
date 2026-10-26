/**
 * Choosing a relic: the checks (a league character, a real slot, the tier's points, no pick in
 * that tier yet, a bank when the relic hands out an item), the save, the captured presentation
 * and the items. Also the "New Relic Available!" popup when points cross a tier's cost, and the
 * selection varbits at login. Relics are permanent (Wiki: a tier's choice cannot be changed).
 */
const Common = require("./Common.LeagueRelics");

function uid(group, child) {
  return (group << 16) | child;
}

function sendSelections(player) {
  const sender = player.getPacketSender();
  const picks = Common.chosen(player);
  Common.data.selectionVarbits.forEach((varbit, tier) => sender.sendVarbit(varbit, picks[tier] | 0));
  sender.sendVarbit(Common.data.lastViewedVarbit, 0);
}

/** The items a relic hands out, by id (names the cache no longer has are skipped; the data says which). */
function grantedItems(relic) {
  const { ItemIdentifiers } = Common.core;
  return (relic.grants ?? []).map((name) => ItemIdentifiers[name]).filter((id) => Number.isInteger(id));
}

/** The bank tabs that hold items (the search tab holds none). */
function bankTabs() {
  const { Bank } = Common.core;
  const tabs = [];
  for (let tab = 0; tab < Bank.TOTAL_BANK_TABS; tab++) if (tab !== Bank.BANK_SEARCH_TAB_INDEX) tabs.push(tab);
  return tabs;
}

/** Whether every item the relic hands out has a slot in the inventory or the bank, so a permanent pick is never saved without its items. */
function canDeliver(player, relic) {
  const items = grantedItems(relic);
  if (items.length === 0) return true;
  const room = player.getInventory().getFreeSlots() + bankTabs().reduce((free, tab) => free + player.getBank(tab).getFreeSlots(), 0);
  return items.length <= room;
}

/** Why a pick is refused (a message key), or null when it may go ahead. `bankOpen` is the bank as it was when the relic interface opened. */
function refusal(player, type, tier, slot, bankOpen) {
  if (type === null) return "notLeague";
  const relic = Common.relic(type, tier, slot);
  if (!relic) return "noSuchRelic";
  if (Common.chosen(player)[tier] !== undefined) return "alreadyChosen";
  if (Common.points(player) < Common.catalog(type).tiers[tier].cost) return "notEnoughPoints";
  if (relic.requiresBank && grantedItems(relic).length > 0 && !bankOpen) return "needsBank";
  if (!canDeliver(player, relic)) return "noRoom";
  return null;
}

/** Each item goes to the inventory if it fits, else to its bank tab, else to any tab with room (canDeliver found one). */
function grant(player, relic) {
  const { Item, Bank } = Common.core;
  for (const id of grantedItems(relic)) {
    const item = new Item(id, 1);
    if (player.getInventory().getAddableAmount(item) >= 1) {
      player.getInventory().add(item, true);
      continue;
    }
    const preferred = Bank.getTabForItem(player, id);
    const tab = [preferred, ...bankTabs()].find((candidate) => player.getBank(candidate).getFreeSlots() > 0);
    if (tab !== undefined) player.getBank(tab).add(item, true);
  }
}

/** The captured unlock: the tier's selection varbit, the animation, the league's graphic, the modal closed, four sounds. */
function present(player, type, tier) {
  const { Animation, Graphic } = Common.core;
  const { interface: ui, selectionVarbits } = Common.data;
  const sender = player.getPacketSender();
  sender.sendVarbit(selectionVarbits[tier], Common.chosen(player)[tier]);
  player.performAnimation(new Animation(ui.unlockAnimation));
  player.performGraphic(new Graphic(Common.league(type).unlockSpotanim, 0, ui.unlockGraphicHeight));
  sender.sendInterfaceRemoval();
  for (const [sound, delay] of ui.unlockSounds) sender.sendSound(sound, 1, delay);
}

/**
 * Chooses relic `slot` (1-3) of `tier` (0-7) for the player, or tells them why not.
 * `bankOpen` is the bank as it was when the relic interface opened (the modal replaces it);
 * callers with no interface pass nothing and the bank as it is now counts.
 * Returns true when the relic was unlocked.
 */
function unlock(player, tier, slot, { bankOpen = Common.core.Bank.isOpen(player) } = {}) {
  const type = Common.leagueOf(player);
  const why = refusal(player, type, tier, slot, bankOpen);
  if (why) {
    player.sendMessage(Common.message(why));
    return false;
  }
  const relic = Common.relic(type, tier, slot);
  player.setAttribute(Common.RELICS_ATTRIBUTE, { ...Common.chosen(player), [tier]: slot });
  present(player, type, tier);
  grant(player, relic);
  Common.api.emitCustomEvent("league:relic-unlocked", { player, league: type, tier, slot, relic: relic.key });
  return true;
}

/** Points crossing a tier's cost show the popup once, for each tier still open (capture 227/00070). */
function pointsChanged({ player, points, previous }) {
  const type = Common.leagueOf(player);
  if (type === null) return;
  const picks = Common.chosen(player);
  const popup = Common.data.notifications.relicAvailable;
  Common.catalog(type).tiers.forEach((tier, tierIndex) => {
    if (picks[tierIndex] !== undefined || tier.cost <= previous || tier.cost > points) return;
    Common.api.emitCustomEvent("notification:show", {
      player,
      title: popup.title,
      text: popup.text.replace("{tier}", String(tierIndex + 1)),
      colour: popup.colour,
      jingle: popup.jingle,
    });
  });
}

function login({ player }) {
  sendSelections(player);
}

/** `league:highest-tier` { player } -> tier: the highest tier index chosen (LeagueMode's XP rate reads it). */
function answerHighestTier(query) {
  if (!query?.player || Common.leagueOf(query.player) === null) return;
  query.tier = Common.highestTier(query.player);
}

/** `league:has-relic` { player, relic: key } -> active: the character's league has that relic and chose it. */
function answerHasRelic(query) {
  if (!query) return;
  query.active = query.player ? Common.hasRelic(query.player, query.relic) : false;
}

/** `league:relics` { player } -> league, chosen (tier index -> slot). */
function answerRelics(query) {
  if (!query) return;
  const type = query.player ? Common.leagueOf(query.player) : null;
  query.league = type;
  query.chosen = type === null ? {} : { ...Common.chosen(query.player) };
}

module.exports = function attach(api) {
  api.persistAttribute(Common.RELICS_ATTRIBUTE, {});
  api.onCustomEvent("league:login", login);
  api.onCustomEvent("league:points-changed", pointsChanged);
  api.onCustomEvent("league:highest-tier", answerHighestTier);
  api.onCustomEvent("league:has-relic", answerHasRelic);
  api.onCustomEvent("league:relics", answerRelics);
};

module.exports.unlock = unlock;
module.exports.refusal = refusal;
module.exports.uid = uid;
