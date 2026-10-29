"use strict";

// Wiki: opposing-god equipment at entry invokes the portal's animal until the wait ends.
// https://oldschool.runescape.wiki/w/Castle_Wars#Waiting_area
const GOD_PARAMS = { saradomin: 40, zamorak: 41, guthix: 42 };
const FORM_GAMEVALS = { saradomin: "castlewars_rabbit", zamorak: "castlewars_imp", guthix: "castlewars_sheep" };
const FORM_NAMES = { saradomin: "rabbit", zamorak: "imp", guthix: "sheep" };
const TOPLEVEL = 161;
// Cache gameframe mounts: chat, music, settings and logout remain available.
const HIDDEN_TABS = [[76, 593], [77, 320], [78, 629], [79, 149], [80, 387], [81, 541], [82, 218], [83, 7], [84, 109], [85, 429], [88, 216]];
const HIDDEN_GROUPS = new Set([...HIDDEN_TABS.map(([, group]) => group), 77]);
const QUICK_PRAYER_DONE = { group: 77, child: 5 };
const ACTIVITY_MESSAGE = "You can't do that while transformed in the Castle Wars waiting room.";

let core;
let game;
const pending = new WeakMap();
const transformed = new WeakSet();

function prepareWaitingForm(player, portalGod) {
  pending.delete(player);
  if (!FORM_GAMEVALS[portalGod]) return;
  for (const [slot, item] of player.getEquipment().getItems().entries()) {
    if (!item || item.getId() <= 0 || item.getAmount() <= 0) continue;
    const cached = core.CacheDefinitions.getItem(item.getId());
    if (cached.wearPos !== slot || cached.noteTemplate >= 0 || cached.placeholderTemplate >= 0) continue;
    if (Object.entries(GOD_PARAMS).some(([god, param]) => god !== portalGod && cached.params?.get(param) === 1)) {
      pending.set(player, portalGod);
      return;
    }
  }
}

function applyWaitingForm(player) {
  const god = pending.get(player);
  pending.delete(player);
  if (!god) return;
  const npc = core.CacheDefinitions.getNpcId(FORM_GAMEVALS[god]);
  if (npc == null) return;
  transformed.add(player);
  player.setNpcTransformationId(npc);
  player.getUpdateFlag().flag(core.Flag.APPEARANCE);
  for (const [tab] of HIDDEN_TABS) player.getPacketSender().closeSubInterface((TOPLEVEL << 16) | tab);
  const form = FORM_NAMES[god];
  player.sendMessage(`You have been turned into ${form === "imp" ? "an" : "a"} ${form} for wearing an item of another god.`);
}

function clearWaitingForm(player) {
  pending.delete(player);
  if (!transformed.delete(player)) return;
  player.setNpcTransformationId(-1);
  const sender = player.getPacketSender();
  for (const [tab, group] of HIDDEN_TABS) {
    if (tab === 76) core.WeaponInterfaceManager.assign(player);
    else if (tab === 81) player.getQuickPrayers().handleWidgetAction(QUICK_PRAYER_DONE.group, QUICK_PRAYER_DONE.child);
    else if (tab === 82) sender.sendTabInterface(6, player.getSpellbook().getInterfaceId());
    else sender.sendTabInterface(tab, group).sendGameframeTabSetup(group);
  }
  player.getEquipment().refreshItems();
  player.getInventory().refreshItems();
  player.getUpdateFlag().flag(core.Flag.APPEARANCE);
}

function refuseActivity(event) {
  if (!transformed.has(event.player) || event.action === "bonus") return;
  event.allow = false;
  event.player.sendMessage(ACTIVITY_MESSAGE);
}

function refuseInteraction(event) {
  if (!transformed.has(event.player)) return;
  if (event.object && game.data.WAITING_EXIT_IDS.has(event.object.getId())) return;
  event.handled = true;
  event.player.sendMessage(ACTIVITY_MESSAGE);
}

function refuseButton(event) {
  if (transformed.has(event.player) && HIDDEN_GROUPS.has(event.buttonId >>> 16)) {
    event.handled = true;
    event.player.sendMessage(ACTIVITY_MESSAGE);
  }
}

function clearOnLogout({ player }) {
  clearWaitingForm(player);
}

module.exports = function attachCastleWarsWaitingRoom(api, castleWars) {
  core = api.core;
  game = castleWars;
  Object.assign(game, { prepareWaitingForm, applyWaitingForm, clearWaitingForm, isWaitingTransformed: (player) => transformed.has(player) });
  api.onCanEquip(refuseActivity);
  api.onCanUnequip(refuseActivity);
  api.onCanUseItem(refuseActivity);
  api.onCanEat(refuseActivity);
  api.onCanDrink(refuseActivity);
  api.onBeforeObjectInteraction(refuseInteraction);
  api.onBeforeNpcInteraction(refuseInteraction);
  api.onButtonClick(refuseButton);
  api.onInterfaceActionClick(refuseButton);
  api.onPlayerLogout(clearOnLogout);
};

module.exports._test = { prepareWaitingForm, applyWaitingForm, clearWaitingForm, FORM_GAMEVALS };
