"use strict";

/**
 * Tombs of Amascut loot. One unique at most per raid, its chance set by the party's total
 * points and raid level and its recipient picked in proportion to points; everyone else
 * rolls the points-scaled common table. Unclaimed loot stays on the player (persisted) until
 * taken from the reward chest or the lobby's retrieval chest.
 */

const Shared = require("./ToaShared");

const ATTR_LOOT = "toa:loot";
const LOOT_SLOTS = 6;
const UNIQUE_CAP_PERCENT = 55;
const DUNG_POINTS = 1500;

/** Common table: an item and its points divisor (quantity = points / divisor). NR RewardEncounter. */
function commonTable(I) {
  return [
    [I.COINS, 1], [I.DEATH_RUNE, 20], [I.SOUL_RUNE, 40], [I.GOLD_ORE, 90], [I.DRAGON_DART_TIP, 100],
    [I.MAHOGANY_LOGS, 100], [I.SAPPHIRE, 200], [I.EMERALD, 250], [I.GOLD_BAR, 250], [I.POTATO_CACTUS, 250],
    [I.RAW_SHARK, 250], [I.RUBY, 300], [I.DIAMOND, 400], [I.RAW_MANTA_RAY, 450], [I.CACTUS_SPINE, 600],
    [I.DRAGONSTONE, 600], [I.BATTLESTAFF, 1100], [I.COCONUT_MILK, 1100], [I.LILY_OF_THE_SANDS, 1100],
    [I.TOADFLAX_SEED, 1400], [I.RANARR_SEED, 1800], [I.TORSTOL_SEED, 2200], [I.SNAPDRAGON_SEED, 2200],
    [I.DRAGON_MED_HELM, 4000], [I.MAGIC_SEED, 6500], [I.BLOOD_ESSENCE, 7500],
  ];
}

/** Wiki unique weights out of 24; `rare` ones need raid level 150, the rest 50, or a 1/50 roll. */
function uniqueTable(I) {
  return [
    { id: I.LIGHTBEARER, weight: 7, level: 50 },
    { id: I.OSMUMTENS_FANG, weight: 7, level: 50 },
    { id: I.ELIDINIS_WARD, weight: 3, level: 150 },
    { id: I.MASORI_MASK, weight: 2, level: 150 },
    { id: I.MASORI_BODY, weight: 2, level: 150 },
    { id: I.MASORI_CHAPS, weight: 2, level: 150 },
    { id: I.TUMEKENS_SHADOW_UNCHARGED_, weight: 1, level: 150 },
  ];
}

/** Each boss's invocations; all of one set at raid level 450+ earns its remnant. */
const REMNANT_SETS = [
  ["REMNANT_OF_AKKHA", ["DOUBLE_TROUBLE", "KEEP_BACK", "STAY_VIGILANT", "FEELING_SPECIAL"]],
  ["REMNANT_OF_ZEBAK", ["NOT_JUST_A_HEAD", "ARTERIAL_SPRAY", "BLOOD_THINNERS", "UPSET_STOMACH"]],
  ["REMNANT_OF_BA_BA", ["MIND_THE_GAP", "GOTTA_HAVE_FAITH", "JUNGLE_JAPES", "SHAKING_THINGS_UP", "BOULDERDASH"]],
  ["REMNANT_OF_KEPHRI", ["LIVELY_LARVAE", "MORE_OVERLORDS", "BLOWING_MUD", "MEDIC", "AERIAL_ASSAULT"]],
  ["ANCIENT_REMNANT", ["ANCIENT_HASTE", "ACCELERATION", "PENETRATION", "OVERCLOCKED", "OVERCLOCKED_2", "INSANITY"]],
];

function lootOf(player) {
  const loot = player.getAttribute(ATTR_LOOT);
  return Array.isArray(loot) ? loot : [];
}

function setLoot(player, loot) {
  player.setAttribute(ATTR_LOOT, loot.length > 0 ? loot : null);
}

function hasLoot(player) {
  return lootOf(player).length > 0;
}

/** Wiki: points / (10500 - 20 x (raid level up to 400, plus a third of the next 150)) percent. */
function uniqueChancePercent(points, raidLevel) {
  const low = Math.min(400, raidLevel);
  const high = Math.max(0, Math.min(150, raidLevel - 400));
  const quotient = 10500 - 20 * (low + high / 3);
  return Math.min(UNIQUE_CAP_PERCENT, points / quotient);
}

function weightedPick(entries, weightOf) {
  const total = entries.reduce((sum, entry) => sum + weightOf(entry), 0);
  if (total <= 0) return null;
  let roll = Math.random() * total;
  for (const entry of entries) {
    roll -= weightOf(entry);
    if (roll < 0) return entry;
  }
  return entries[entries.length - 1];
}

function owns(player, id) {
  const { Bank } = Shared.core();
  if (player.getInventory().contains(id) || player.getEquipment().contains(id)) return true;
  for (let tab = 0; tab < Bank.TOTAL_BANK_TABS; tab++) {
    if (player.getBank(tab)?.contains?.(id)) return true;
  }
  return false;
}

/** Rolls every player's chest for a finished raid. Returns { uniqueWinner, uniqueId, petWinner }. */
function rollRaidLoot(raid) {
  const I = Shared.core().ItemIdentifiers;
  const players = raid.players.slice();
  const pointsOf = (player) => raid.member(player).points;
  const raidLevel = raid.raidLevel;
  const total = players.reduce((sum, player) => sum + pointsOf(player), 0);
  const chance = uniqueChancePercent(total, raidLevel);
  let uniqueWinner = null;
  let uniqueId = -1;
  if (Math.random() * 100 < chance) {
    const unique = weightedPick(uniqueTable(I), (entry) => entry.weight);
    if (raidLevel >= unique.level || Shared.random(0, 49) === 0) {
      uniqueWinner = weightedPick(players, (player) => Math.max(0, pointsOf(player)));
      uniqueId = unique.id;
    }
  }
  // Approximation (no wiki access when written): the pet rolls at 1/20 of the unique rate.
  const petWinner = Math.random() * 100 < chance / 20 ? weightedPick(players, (player) => Math.max(0, pointsOf(player))) : null;
  for (const player of players) {
    const loot = rollPlayer(raid, player, player === uniqueWinner ? uniqueId : -1);
    if (player === petWinner) loot.push({ id: I.TUMEKENS_GUARDIAN, amount: 1 });
    setLoot(player, loot.slice(0, LOOT_SLOTS));
  }
  return { uniqueWinner, uniqueId, petWinner };
}

function rollPlayer(raid, player, uniqueId) {
  const I = Shared.core().ItemIdentifiers;
  const points = raid.member(player).points;
  const raidLevel = raid.raidLevel;
  const loot = [];
  const add = (id, amount = 1) => {
    if (loot.length >= LOOT_SLOTS || amount <= 0) return;
    const existing = loot.find((entry) => entry.id === id);
    if (existing) existing.amount += amount;
    else loot.push({ id, amount });
  };
  if (points < DUNG_POINTS) {
    add(I.FOSSILISED_DUNG);
    return loot;
  }
  if (raid.totalDeaths < 1) {
    if (raidLevel >= 350 && !owns(player, I.MASORI_CRAFTING_KIT)) add(I.MASORI_CRAFTING_KIT);
    if (raidLevel >= 400 && !owns(player, I.MENAPHITE_ORNAMENT_KIT)) add(I.MENAPHITE_ORNAMENT_KIT);
    if (raidLevel >= 450) {
      const remnant = REMNANT_SETS.find(([key, invocations]) =>
        invocations.every((name) => raid.settings.isActive(name)) && !owns(player, I[key]));
      if (remnant) add(I[remnant[0]]);
    }
    if (raidLevel >= 500) add(I.CURSED_PHALANX);
  }
  if (uniqueId !== -1) {
    add(uniqueId);
  } else {
    const factor = raidLevel < 300 ? 1 : 1.15 + 0.01 * ((raidLevel - 300) / 5);
    const table = commonTable(I).filter(([, divisor]) => points >= divisor);
    for (let roll = 0; roll < 3 && table.length > 0; roll++) {
      const [id, divisor] = Shared.randomOf(table);
      add(id, Math.floor(Math.floor(points / divisor) * factor));
    }
  }
  if (Shared.random(0, 14) === 0) add(I.THREAD_OF_ELIDINIS);
  if (Shared.random(0, 19) === 0) add(Shared.randomOf([I.BREACH_OF_THE_SCARAB, I.JEWEL_OF_THE_SUN, I.EYE_OF_THE_CORRUPTOR]));
  if (Shared.random(0, 25) === 0) add(I.CLUE_SCROLL_ELITE_);
  return loot;
}

module.exports = {
  ATTR_LOOT,
  LOOT_SLOTS,
  lootOf,
  setLoot,
  hasLoot,
  uniqueChancePercent,
  rollRaidLoot,
};
