/**
 * Shattered Relics' unlocks screen (league_3_unlocks 733, data/league-shattered.json `unlocks`):
 * skills, bosses and quest packs bought with Sage's Renown (Wiki /Unlocks). What a character has
 * unlocked is saved and sent as the varbits the screen draws from. The unlocks are recorded only:
 * locked skills still give XP, locked bosses can be fought and quest packs complete no quests yet
 * (follow-ups in docs/leagues.md).
 *
 *   "league:unlock-skill" { player, skill }   unlocks a skill for free (the starting class)
 *   "league:open-unlocks" { player }          opens the screen
 *   "league:unlocks" { player } -> { skills, bosses, quests }
 */
const Common = require("./Common.LeagueMode");
const { FLAG_OP1 } = require("../../interface/widgetGroup");
const { data, isShattered } = require("./Shattered.LeagueMode");

/** { skills: [skill id], bosses: [npc id], quests: [pack name] }. */
const UNLOCKS_ATTRIBUTE = "league:unlocks";
const TABS = ["skills", "bosses", "quests"];

/** Per tab, the cache's entries in list order: { key, struct, name, cost?, skill?, npc?, index? }; read once. */
let entryLists = null;

function uid(group, child) {
  return (group << 16) | child;
}

function config() {
  return data.unlocks;
}

function entries(tab) {
  if (!entryLists) {
    const { CacheDefinitions } = Common.core;
    const { costParam, nameParam, skills, bosses, quests } = config();
    const read = (table, extra) => [...CacheDefinitions.getEnumValues(table.enum).entries()].sort(([a], [b]) => a - b).map(([key, struct]) => {
      const params = CacheDefinitions.getStructParams(Number(struct));
      return { key: Number(key), struct: Number(struct), name: String(params?.get(nameParam) ?? ""), cost: Number(params?.get(costParam)) || 0, ...extra(params) };
    });
    entryLists = {
      skills: read(skills, (params) => ({ skill: Number(params?.get(skills.skillParam)) })),
      bosses: read(bosses, (params) => ({ npc: Number(params?.get(bosses.npcParam)) })),
      quests: read(quests, (params) => ({ index: Number(params?.get(quests.indexParam)) })),
    };
  }
  return entryLists[tab];
}

function unlocked(player) {
  const value = player.getAttribute(UNLOCKS_ATTRIBUTE);
  const valid = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    skills: Array.isArray(valid.skills) ? valid.skills.map(Number) : [],
    bosses: Array.isArray(valid.bosses) ? valid.bosses.map(Number) : [],
    quests: Array.isArray(valid.quests) ? valid.quests.map(String) : [],
  };
}

function save(player, state) {
  player.setAttribute(UNLOCKS_ATTRIBUTE, state);
}

// ---- Quest pack prices ----

function pack(name) {
  return config().quests.packs[name] ?? null;
}

/** A pack's prerequisite packs, every level down. */
function prerequisites(name, seen = new Set()) {
  for (const required of pack(name)?.requires ?? []) {
    if (seen.has(required)) continue;
    seen.add(required);
    prerequisites(required, seen);
  }
  return seen;
}

/**
 * A pack's price now (Wiki /Unlocks: its prerequisites count while incomplete): its price less
 * the prices of the unlocked prerequisite packs that no other unlocked one includes. 0 = unlocked.
 */
function questPrice(name, unlockedPacks) {
  const row = pack(name);
  if (!row) return 0;
  if (unlockedPacks.has(name)) return 0;
  const done = [...prerequisites(name)].filter((required) => unlockedPacks.has(required));
  const outer = done.filter((required) => !done.some((other) => other !== required && prerequisites(other).has(required)));
  const paid = outer.reduce((sum, required) => sum + (pack(required)?.cost ?? 0), 0);
  return Math.max(1, row.cost - paid);
}

// ---- What the client is sent ----

function sendUnlocks(player) {
  const state = unlocked(player);
  const sender = player.getPacketSender();
  const { skills, bosses, quests } = config();
  for (const [skill, varbit] of Object.entries(skills.varbits)) sender.sendVarbit(varbit, state.skills.includes(Number(skill)) ? 1 : 0);
  for (const [npc, varbit] of Object.entries(bosses.varbits)) sender.sendVarbit(varbit, state.bosses.includes(Number(npc)) ? 1 : 0);
  const packs = new Set(state.quests);
  for (const entry of entries("quests")) sender.sendVarbit(quests.varbitBase + entry.index, questPrice(entry.name, packs));
}

/**
 * The screen opens on the tab and entry it showed last (the client keeps varps 3343 / 3344, and so
 * does `view`). No varp goes with the open: the confirm panel (733:40) shows itself whenever 3343 or
 * 3344 is sent on its own (its onVarTransmit runs script 5827), and the onLoad (5806) hides it.
 */
function open({ player }) {
  if (!isShattered(player)) return;
  const { group, tabs, tabChildren, entries: list, skills, bosses, quests } = config();
  sendUnlocks(player);
  const sender = player.getPacketSender();
  sender.sendInterface(group);
  sender.sendInterfaceFlagsRange(uid(group, tabs), 0, TABS.length * tabChildren - 1, FLAG_OP1);
  const rows = Math.max(...[skills, bosses, quests].map((table, tab) => entries(TABS[tab]).length * table.entryChildren));
  sender.sendInterfaceFlagsRange(uid(group, list), 0, rows - 1, FLAG_OP1);
}

function isOpen(player) {
  return player.getInterfaceId() === config().group;
}

/** Per player: the tab and entry shown (the server's copy of varps 3343 / 3344), for the session. */
const view = new WeakMap();

function viewOf(player) {
  return view.get(player) ?? { tab: 0, entry: -1 };
}

/** The tab (3343) and then no entry (3344): the redraw this sends ends with the confirm panel hidden. */
function showTab(player, tab) {
  view.set(player, { tab, entry: -1 });
  const sender = player.getPacketSender();
  sender.sendConfig(config().tabVarp, tab);
  sender.sendConfig(config().selectionVarp, 0);
}

function pickTab({ player, slot }) {
  if (!isShattered(player) || !isOpen(player)) return false;
  const child = Number(slot);
  const tab = child / config().tabChildren;
  if (!Number.isInteger(tab) || tab < 0 || tab >= TABS.length) return true;
  showTab(player, tab);
  return true;
}

function pickEntry({ player, slot }) {
  if (!isShattered(player) || !isOpen(player)) return false;
  const { tab } = viewOf(player);
  const table = config()[TABS[tab]];
  const offset = Number(slot) - table.selectChild;
  const entry = offset / table.entryChildren;
  if (!Number.isInteger(entry) || entry < 0 || entry >= entries(TABS[tab]).length) return true;
  view.set(player, { tab, entry });
  player.getPacketSender().sendConfig(config().selectionVarp, entry + 1);
  return true;
}

/** The price of the entry shown, or null when it can't be bought (already unlocked, always unlocked). */
function price(player, tab, entry) {
  const state = unlocked(player);
  if (TABS[tab] === "skills") {
    if (config().skills.alwaysUnlocked.includes(entry.skill) || state.skills.includes(entry.skill)) return null;
    return entry.cost;
  }
  if (TABS[tab] === "bosses") return state.bosses.includes(entry.npc) ? null : entry.cost;
  const cost = questPrice(entry.name, new Set(state.quests));
  return cost > 0 ? cost : null;
}

function unlock(player, tab, entry) {
  const state = unlocked(player);
  if (TABS[tab] === "skills") state.skills.push(entry.skill);
  else if (TABS[tab] === "bosses") state.bosses.push(entry.npc);
  else state.quests = [...new Set([...state.quests, entry.name, ...prerequisites(entry.name)])];
  save(player, state);
}

/** Accept (733:47): the entry shown, paid in Sage's Renown. */
function accept({ player }) {
  if (!isShattered(player) || !isOpen(player)) return false;
  const { tab, entry: index } = viewOf(player);
  const entry = entries(TABS[tab])[index];
  const cost = entry ? price(player, tab, entry) : null;
  if (cost !== null) {
    const spend = { player, amount: cost };
    Common.api.emitCustomEvent("league:spend-renown", spend);
    if (spend.spent) {
      unlock(player, tab, entry);
      sendUnlocks(player);
    }
  }
  // As a tab click does: the list redraws and the confirm panel closes.
  showTab(player, tab);
  return true;
}

function close({ player }) {
  if (!isShattered(player) || !isOpen(player)) return false;
  player.getPacketSender().sendInterfaceRemoval();
  return true;
}

function unlockSkill({ player, skill }) {
  if (!isShattered(player)) return;
  const id = Number(skill);
  if (config().skills.varbits[id] === undefined) return;
  const state = unlocked(player);
  if (!state.skills.includes(id)) state.skills.push(id);
  save(player, state);
  sendUnlocks(player);
}

function query(request) {
  if (!request) return;
  Object.assign(request, isShattered(request.player) ? unlocked(request.player) : { skills: [], bosses: [], quests: [] });
}

function login({ player }) {
  if (isShattered(player)) sendUnlocks(player);
}

function buttons() {
  const { group, tabs, entries: list, accept: acceptButton, close: closeButton } = config();
  return { tabs: uid(group, tabs), list: uid(group, list), accept: uid(group, acceptButton), close: uid(group, closeButton) };
}

module.exports = function attach(api) {
  const buttonIds = buttons();
  api.persistAttribute(UNLOCKS_ATTRIBUTE, {});
  api.onCustomEvent("league:unlock-skill", unlockSkill);
  api.onCustomEvent("league:open-unlocks", open);
  api.onCustomEvent("league:unlocks", query);
  api.onCustomEvent("league:login", login);
  api.onInterfaceActionButton(buttonIds.tabs, pickTab);
  api.onInterfaceActionButton(buttonIds.list, pickEntry);
  api.onInterfaceActionButton(buttonIds.accept, accept);
  api.onInterfaceActionButton(buttonIds.close, close);
};

module.exports._test = { questPrice, entries, unlocked, UNLOCKS_ATTRIBUTE };
