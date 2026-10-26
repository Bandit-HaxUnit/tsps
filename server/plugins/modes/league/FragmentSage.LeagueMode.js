/**
 * Shattered Relics' three sets that give an item (data/league-shattered.json `sageEffects`; Wiki
 * /Fragments): Endless Knowledge (the Arcane grimoire, whose spellbook swap is its own unit in
 * leaguerelics, Leagues polish), Last Recall (the Crystal of memories) and Trailblazer (the
 * Portable waystone). A set's item (Fragments.setItem, the set struct's param 1471) is handed over
 * when the set becomes active and the character holds none (`league:fragments-changed`, and at
 * login). The crystal's Teleport-back returns to where the last teleport began (`teleport:landed`,
 * core); the waystone teleports to the league's waystones.
 */
const Common = require("./Common.LeagueMode");
const Fragments = require("./Fragments.LeagueMode");
const { data, isShattered } = require("./Shattered.LeagueMode");

/** Where the character's last teleport began, kept for the crystal. */
const RECALL_ATTRIBUTE = "league:last-recall";
/** Chatbox options a page: four places and "More...". */
const PAGE_SIZE = 5;

function effects() {
  return data.sageEffects;
}

function core() {
  return Common.core;
}

function itemName(itemId) {
  return core().ItemDefinition.forId(itemId)?.getName?.() ?? "an item";
}

// ---- The items, handed over ----

/** Whether the character holds the item anywhere: inventory, worn or banked. */
function holds(player, itemId) {
  const containers = [player.getInventory(), player.getEquipment()];
  for (let tab = 0; tab < core().Bank.TOTAL_BANK_TABS; tab++) containers.push(player.getBank(tab));
  return containers.some((container) => container?.contains?.(itemId));
}

/** Each active set's item, to a character who holds none. */
function grantItems({ player }) {
  if (!isShattered(player)) return;
  for (const set of effects().sets) {
    const itemId = Fragments.setItem(set);
    if (!itemId || Fragments.setTier(player, set) === 0 || holds(player, itemId)) continue;
    player.getInventory().forceAdd(player, new (core().Item)(itemId, 1));
    player.sendMessage(data.messages.sageItem.replace("{item}", itemName(itemId)));
  }
}

// ---- The Crystal of memories ----

function inBox(location, box) {
  const x = location.getX();
  const y = location.getY();
  return x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY && (box.z === undefined || location.getZ() === box.z);
}

/** `teleport:landed`: a Shattered character remembers where a teleport began, unless in an instance or a place the crystal can't return to. */
function rememberTeleport({ player, from, fromInstance }) {
  if (!isShattered(player) || fromInstance || !from || effects().noRecall.some((box) => inBox(from, box))) return;
  player.setAttribute(RECALL_ATTRIBUTE, { x: from.getX(), y: from.getY(), z: from.getZ() });
}

function recalled(player) {
  const saved = player.getAttribute(RECALL_ATTRIBUTE);
  return saved && Number.isInteger(saved.x) ? saved : null;
}

function teleport(player, location, wildernessLevel) {
  const { TeleportHandler, TeleportType } = core();
  if (!TeleportHandler.checkReqs(player, location, wildernessLevel)) return false;
  TeleportHandler.teleport(player, location, TeleportType.NORMAL, false);
  return true;
}

function teleportBack(event) {
  const { player } = event;
  if (!isShattered(player)) return false;
  const saved = recalled(player);
  if (!saved) player.sendMessage(data.messages.recallNothing);
  else teleport(player, new (core().Location)(saved.x, saved.y, saved.z), effects().crystal.wildernessLevel);
  return true;
}

function checkMemory(event) {
  const { player } = event;
  if (!isShattered(player)) return false;
  player.sendMessage(recalled(player) ? data.messages.recallMemory : data.messages.recallNothing);
  return true;
}

// ---- The Portable waystone ----

function questDone(player, key) {
  const quest = { player, key, complete: null };
  Common.api.emitCustomEvent("quest:is-complete", quest);
  return quest.complete === true;
}

function goToWaystone(player, place) {
  if (place.quest && !questDone(player, place.quest)) {
    player.sendMessage(data.messages.waystoneQuest.replace("{quest}", place.questName));
    return;
  }
  const [x, y, z] = place.tile;
  teleport(player, new (core().Location)(x, y, z), effects().waystone.wildernessLevel);
}

/** A paged chatbox menu of the waystones; "More..." shows the next page, the last page leads back to the first. */
function waystoneMenu(player, from = 0) {
  const places = effects().waystone.places;
  const room = PAGE_SIZE - 1;
  const page = places.slice(from, from + room);
  const options = page.flatMap((place) => [place.name, () => goToWaystone(player, place)]);
  const next = from + room < places.length ? from + room : 0;
  options.push(data.messages.waystoneMore, () => waystoneMenu(player, next));
  Common.api.sendMultiChatboxPrompt(player, data.messages.waystoneChoose, ...options);
}

function waystone(event) {
  if (!isShattered(event.player)) return false;
  waystoneMenu(event.player);
  return true;
}

module.exports = function attach(api) {
  api.persistAttribute(RECALL_ATTRIBUTE, null);
  api.onCustomEvent("league:fragments-changed", grantItems);
  api.onCustomEvent("league:login", grantItems);
  api.onCustomEvent("teleport:landed", rememberTeleport);
  api.onItemAction("Crystal of Echoes", { "Teleport-back": teleportBack, "Check-memories": checkMemory });
  api.onItemAction("Portable waystone", { Teleport: waystone });
};

module.exports._test = { grantItems, holds, rememberTeleport, teleportBack, checkMemory, goToWaystone, waystoneMenu, RECALL_ATTRIBUTE };
