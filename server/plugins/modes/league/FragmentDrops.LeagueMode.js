/**
 * Shattered Relics' fragment drops (data/league-shattered.json `fragmentDrops`). Wiki /Fragments:
 * fragments come from the activity at hand, more often the more XP it gives, and combat ones by
 * the NPC's tier. They arrive as the cache's Unidentified fragment items, which Break opens into a
 * fragment of their kind not yet mastered: a new one is owned at level 1, a known one gains 500
 * fragment XP (Fragments.award). A full inventory drops the item to the floor. The rates are this
 * server's (the Wiki gives none).
 *
 * `::fragment <id|category> [tier]` (developer) hands one out.
 */
const Common = require("./Common.LeagueMode");
const Fragments = require("./Fragments.LeagueMode");
const { data, isShattered } = require("./Shattered.LeagueMode");

/** The combat tiers still to open, oldest first: each combat drop queues its NPC's tier for its Break. */
const PENDING_ATTRIBUTE = "league:fragment-pending";

/** NPC name (lower case) -> combat tier, read once from the data. */
let tierByName = null;
/** Fragment id -> its name in the cache, read once. */
let names = null;

function drops() {
  return data.fragmentDrops;
}

function tierOf(name) {
  if (!tierByName) {
    tierByName = new Map();
    for (const [tier, row] of Object.entries(drops().combatTiers)) {
      for (const npc of row.npcs ?? []) tierByName.set(npc.toLowerCase(), Number(tier));
    }
  }
  return tierByName.get(String(name ?? "").toLowerCase()) ?? 1;
}

function nameOf(id) {
  if (!names) {
    const { CacheDefinitions } = Common.core;
    names = new Map([...CacheDefinitions.getEnumValues(data.fragments.enum).values()].map((struct) => {
      const params = CacheDefinitions.getStructParams(Number(struct));
      return [Number(params?.get(data.fragments.idParam)), String(params?.get(data.fragments.nameParam) ?? "")];
    }));
  }
  return names.get(Number(id)) ?? "";
}

function pending(player) {
  const value = player.getAttribute(PENDING_ATTRIBUTE);
  return Array.isArray(value) ? value.map(Number) : [];
}

/** Into the inventory, or onto the floor when it is full (Wiki). */
function giveItem(player, category) {
  const { Item } = Common.core;
  player.getInventory().forceAdd(player, new Item(drops().items[category], 1));
}

function dropCombat(player, tier) {
  player.setAttribute(PENDING_ATTRIBUTE, [...pending(player), tier]);
  giveItem(player, "combat");
}

/** onExperienceGained: a skill's XP may turn up its category's fragment, more likely the more XP. */
function skillingDrop({ player, skill, experience }) {
  if (!isShattered(player)) return;
  const category = drops().skills[Number(skill?.getClientId?.())];
  if (!category) return;
  if (Math.random() < Number(experience) / drops().xpPerDrop[category]) giveItem(player, category);
}

/** onNpcDeath: a kill may turn up a combat fragment of the NPC's tier, more likely the tougher the NPC. */
function combatDrop({ killer, npc }) {
  if (!killer?.isPlayer?.() || !isShattered(killer)) return;
  const definition = npc?.getCurrentDefinition?.(killer) ?? npc?.getDefinition?.();
  const hitpoints = Number(definition?.getHitpoints?.()) || 0;
  if (hitpoints <= 0) return;
  if (Math.random() < Math.min(1, hitpoints / drops().hitpointsPerDrop)) dropCombat(killer, tierOf(definition?.getName?.()));
}

/** The fragments an item of this category can open into, for a combat tier (its own tier first, then the others). */
function pool(player, category, tier) {
  const findable = (ids) => ids.filter((id) => Fragments.findable(player, id));
  if (category !== "combat") return findable(drops().categories[category]);
  const tiers = Object.keys(drops().combatTiers).map(Number).sort((a, b) => Math.abs(a - tier) - Math.abs(b - tier) || a - b);
  for (const each of tiers) {
    const found = findable(drops().combatTiers[each].fragments);
    if (found.length) return found;
  }
  return [];
}

/** Break: the item opens into a fragment of its kind that isn't mastered yet. */
function breakFragment(event) {
  const { player, itemId } = event;
  if (!isShattered(player)) return false;
  const category = Object.keys(drops().items).find((key) => drops().items[key] === Number(itemId));
  if (!category) return false;
  const queue = pending(player);
  const tier = category === "combat" ? queue[0] ?? 1 : null;
  const options = pool(player, category, tier);
  if (!options.length) {
    player.sendMessage(data.messages.fragmentsMastered);
    return true;
  }
  player.getInventory().delete(Number(itemId), 1);
  if (category === "combat" && queue.length) player.setAttribute(PENDING_ATTRIBUTE, queue.slice(1));
  const id = options[Math.floor(Math.random() * options.length)];
  const { duplicate } = Fragments.award(player, id);
  player.sendMessage((duplicate ? data.messages.fragmentDuplicate : data.messages.fragmentFound)
    .replace("{name}", nameOf(id)).replace("{xp}", data.fragmentXp.duplicate));
  return true;
}

function fragmentCommand({ player, parts }) {
  const what = String(parts[1] ?? "").toLowerCase();
  if (!isShattered(player) || !what) {
    player.sendMessage(data.messages.fragmentUsage);
    return true;
  }
  if (drops().items[what] !== undefined) {
    if (what === "combat") dropCombat(player, Number(parts[2]) || 1);
    else giveItem(player, what);
    return true;
  }
  const id = Number(what);
  if (!nameOf(id)) {
    player.sendMessage(data.messages.fragmentUsage);
    return true;
  }
  Fragments.award(player, id);
  player.sendMessage(data.messages.fragmentFound.replace("{name}", nameOf(id)));
  return true;
}

/** The Unidentified fragment items' names in the cache, for the Break option hook. */
function itemNames() {
  return Object.values(drops().items).map((id) => Common.core.CacheDefinitions.getItem(id)?.name).filter(Boolean);
}

module.exports = function attach(api) {
  api.persistAttribute(PENDING_ATTRIBUTE, []);
  api.onExperienceGained(skillingDrop);
  api.onNpcDeath(combatDrop);
  for (const name of itemNames()) api.onItemAction(name, { Break: breakFragment });
  api.registerCommand("fragment", fragmentCommand, api.core.PlayerRights.DEVELOPER,
    "Give a Shattered Relics fragment: ::fragment <id|harvesting|production|skilling|combat|misc> [tier]");
};

module.exports._test = { tierOf, pool, PENDING_ATTRIBUTE };
