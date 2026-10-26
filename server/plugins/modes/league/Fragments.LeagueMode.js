/**
 * Shattered Relics' fragments screen (league_3_fragments 735, data/league-shattered.json
 * `fragments`): which fragments a character owns (their fragment XP) and which sit in its seven
 * slots, saved and sent as the varbits the screen draws from. A slot opens at the points the
 * cache's enum 4127 gives (Wiki /Fragments: one to seven slots). Equip and Unequip work anywhere
 * for now; fragments don't drop and have no effect yet (follow-ups in docs/leagues.md).
 *
 *   "league:grant-fragment" { player, id, xp? }   owns a fragment (1 XP, level 1, unless more is given)
 *   "league:open-fragments" { player }            opens the screen
 */
const Common = require("./Common.LeagueMode");
const { FLAG_OP1, FLAG_OP2 } = require("../../interface/widgetGroup");
const { data, isShattered } = require("./Shattered.LeagueMode");

/** Fragment id -> fragment XP (absent = not owned). */
const FRAGMENTS_ATTRIBUTE = "league:fragments";
/** The seven slots' fragment ids (0 = empty). */
const SLOTS_ATTRIBUTE = "league:fragment-slots";

/** The cache's fragment ids (enum 4136's structs, param 1455), read once. */
let fragmentIds = null;
/** The points each slot opens at (enum 4127), read once. */
let slotThresholds = null;

function uid(group, child) {
  return (group << 16) | child;
}

function config() {
  return data.fragments;
}

function ids() {
  if (fragmentIds) return fragmentIds;
  const { CacheDefinitions } = Common.core;
  fragmentIds = new Set([...CacheDefinitions.getEnumValues(config().enum).values()]
    .map((struct) => Number(CacheDefinitions.getStructParams(Number(struct))?.get(config().idParam)))
    .filter((id) => Number.isInteger(id) && id > 0));
  return fragmentIds;
}

function thresholds() {
  if (slotThresholds) return slotThresholds;
  slotThresholds = [...Common.core.CacheDefinitions.getEnumValues(config().slotsEnum).entries()]
    .sort(([a], [b]) => a - b).map(([, points]) => Number(points));
  return slotThresholds;
}

function owned(player) {
  const value = player.getAttribute(FRAGMENTS_ATTRIBUTE);
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function slots(player) {
  const value = player.getAttribute(SLOTS_ATTRIBUTE);
  const list = Array.isArray(value) ? value.map((id) => Number(id) || 0) : [];
  return config().slotVarbits.map((_, slot) => list[slot] ?? 0);
}

function points(player) {
  const query = { player, points: 0, tasks: 0 };
  Common.api.emitCustomEvent("league:points", query);
  return Number(query.points) || 0;
}

/** Slots open at the character's points (script 5786). */
function openSlots(player) {
  const earned = points(player);
  return thresholds().filter((needed) => earned >= needed).length;
}

function sendFragments(player) {
  const sender = player.getPacketSender();
  const xp = owned(player);
  for (const id of ids()) sender.sendVarbit(config().xpVarbitBase + id - 1, Math.min(0xffff, Number(xp[id]) || 0));
  sendSlots(player);
}

function sendSlots(player) {
  const sender = player.getPacketSender();
  slots(player).forEach((id, slot) => sender.sendVarbit(config().slotVarbits[slot], id));
}

function grant(request) {
  const { player } = request ?? {};
  const id = Number(request?.id);
  if (!isShattered(player) || !ids().has(id)) return;
  const xp = owned(player);
  player.setAttribute(FRAGMENTS_ATTRIBUTE, { ...xp, [id]: Math.max(Number(xp[id]) || 0, Number(request.xp) || 1) });
  sendFragments(player);
}

function open({ player }) {
  if (!isShattered(player)) return;
  const { group, list, listChildren, loadout, loadoutChildren } = config();
  sendFragments(player);
  const sender = player.getPacketSender();
  sender.sendInterface(group);
  sender.sendInterfaceFlagsRange(uid(group, list), 0, Math.max(...ids()) * listChildren - 1, FLAG_OP1 | FLAG_OP2);
  sender.sendInterfaceFlagsRange(uid(group, loadout), 0, config().slotVarbits.length * loadoutChildren - 1, FLAG_OP1 | FLAG_OP2);
}

function isOpen(player) {
  return player.getInterfaceId() === config().group;
}

/** Equip (735:18 op2): an owned fragment into the first empty open slot; never twice. */
function equip(event) {
  const { player } = event;
  if (!isShattered(player) || !isOpen(player)) return false;
  const slot = Number(event.slot);
  if (Number(event.opId ?? event.action) !== config().equipOp || slot % config().listChildren !== 0) return true;
  const id = slot / config().listChildren + 1;
  const current = slots(player);
  if (!ids().has(id) || !(Number(owned(player)[id]) > 0) || current.includes(id)) return true;
  const free = current.findIndex((entry, index) => entry === 0 && index < openSlots(player));
  if (free < 0) return true;
  current[free] = id;
  player.setAttribute(SLOTS_ATTRIBUTE, current);
  sendSlots(player);
  return true;
}

/** Unequip (735:36 op2): that slot's fragment comes off. */
function unequip(event) {
  const { player } = event;
  if (!isShattered(player) || !isOpen(player)) return false;
  const child = Number(event.slot) - 1;
  if (Number(event.opId ?? event.action) !== config().unequipOp || child < 0 || child % config().loadoutChildren !== 0) return true;
  const slot = child / config().loadoutChildren;
  const current = slots(player);
  if (slot >= current.length || current[slot] === 0) return true;
  current[slot] = 0;
  player.setAttribute(SLOTS_ATTRIBUTE, current);
  sendSlots(player);
  return true;
}

function unequipAll({ player }) {
  if (!isShattered(player) || !isOpen(player)) return false;
  player.setAttribute(SLOTS_ATTRIBUTE, config().slotVarbits.map(() => 0));
  sendSlots(player);
  return true;
}

function close({ player }) {
  if (!isShattered(player) || !isOpen(player)) return false;
  player.getPacketSender().sendInterfaceRemoval();
  return true;
}

function login({ player }) {
  if (isShattered(player)) sendFragments(player);
}

function buttons() {
  const { group, list, loadout, unequipAll: all, close: closeButton } = config();
  return { list: uid(group, list), loadout: uid(group, loadout), all: uid(group, all), close: uid(group, closeButton) };
}

module.exports = function attach(api) {
  const buttonIds = buttons();
  api.persistAttribute(FRAGMENTS_ATTRIBUTE, {});
  api.persistAttribute(SLOTS_ATTRIBUTE, []);
  api.onCustomEvent("league:grant-fragment", grant);
  api.onCustomEvent("league:open-fragments", open);
  api.onCustomEvent("league:login", login);
  api.onInterfaceActionButton(buttonIds.list, equip);
  api.onInterfaceActionButton(buttonIds.loadout, unequip);
  api.onInterfaceActionButton(buttonIds.all, unequipAll);
  api.onInterfaceActionButton(buttonIds.close, close);
};

module.exports._test = { openSlots, slots, owned, ids, FRAGMENTS_ATTRIBUTE, SLOTS_ATTRIBUTE };
