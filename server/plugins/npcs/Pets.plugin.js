/**
 * Followers, ownership, storage and pet-specific behaviour.
 *
 * Ownership is item-backed: a pet item in the inventory, any bank tab, or an active
 * follower is the durable record; `pets.owned` remembers which pets Probita insures
 * for reclaim. Variants chosen with Metamorphosis persist in `pets:variant` keyed by
 * pet family, and are re-applied when the follower is summoned.
 */
const { NPC } = require("../../src/main/typescript/elvarg/game/entity/impl/npc/NPC");
const { Animation } = require("../../src/main/typescript/elvarg/game/model/Animation");
const { Item } = require("../../src/main/typescript/elvarg/game/model/Item");
const { Sound } = require("../../src/main/typescript/elvarg/game/Sound");
const { Sounds } = require("../../src/main/typescript/elvarg/game/Sounds");
const { Skill } = require("../../src/main/typescript/elvarg/game/model/Skill");
const { Bank } = require("../../src/main/typescript/elvarg/game/model/container/impl/Bank");
const { Misc } = require("../../src/main/typescript/elvarg/util/Misc");
const { NpcIdentifiers } = require("../../src/main/typescript/elvarg/util/NpcIdentifiers");

const CURRENT_PET_ATTRIBUTE = "pets:current";
/** The item of the follower the player logged out with; re-summoned on login. */
const LAST_PET_ATTRIBUTE = "pets:last";
const VARIANT_ATTRIBUTE = "pets:variant";
/** Every pet item the player has ever been awarded; Probita reclaims from it. */
const OWNED_ATTRIBUTE = "pets.owned";

const INTERACTION_ANIM = new Animation(827);
const FOLLOWER_INDEX_VARP = 447;
const MAX_XP = 200000000;
let pluginApi = null;

const PETS = [
  { enumName: "WISP", petId: NpcIdentifiers.WISP, morphId: 0, itemId: 28246, dialogue: -1 },
  { enumName: "BUTCH", petId: NpcIdentifiers.BUTCH, morphId: 0, itemId: 28248, dialogue: -1 },
  { enumName: "BARON", petId: NpcIdentifiers.BARON, morphId: 0, itemId: 28250, dialogue: -1 },
  { enumName: "LILVIATHAN", petId: NpcIdentifiers.LILVIATHAN, morphId: 0, itemId: 28252, dialogue: -1 },
  { enumName: "NID", petId: NpcIdentifiers.NID, morphId: 0, itemId: 29836, dialogue: -1 },
  { enumName: "SCURRY", petId: 7219, morphId: 0, itemId: 28801, dialogue: -1 },
  { enumName: "LIL_ZIK", petId: NpcIdentifiers.LIL_ZIK, morphId: 0, itemId: 22473, dialogue: -1 },
  { enumName: "TUMEKENS_GUARDIAN", petId: NpcIdentifiers.TUMEKENS_GUARDIAN, morphId: 0, itemId: 27352, dialogue: -1 },
  { enumName: "SMOL_HEREDIT", petId: NpcIdentifiers.SMOL_HEREDIT_2, morphId: 0, itemId: 28960, dialogue: -1, mainDrop: true },
  { enumName: "NEXLING", petId: NpcIdentifiers.NEXLING, morphId: 0, itemId: 26348, dialogue: -1 },
  { enumName: "VORKI", petId: NpcIdentifiers.VORKI, morphId: 0, itemId: 21992, dialogue: -1 },
  { enumName: "MUPHIN", petId: NpcIdentifiers.MUPHIN, morphId: 0, itemId: 27590, dialogue: -1 },
  { enumName: "LIL_CREATOR", petId: NpcIdentifiers.LIL_CREATOR, morphId: 0, itemId: 25348, dialogue: -1 },
  { enumName: "LIL_DESTRUCTOR", petId: NpcIdentifiers.LIL_DESTRUCTOR, morphId: 0, itemId: 25350, dialogue: -1 },
  { enumName: "JAL_NIB_REK", petId: 7675, morphId: 8011, itemId: 21291, dialogue: -1 },
  { enumName: "TZREK_ZUK", petId: 8011, morphId: 7675, itemId: 21291, dialogue: -1 },
  { enumName: "MIDNIGHT", petId: NpcIdentifiers.MIDNIGHT, morphId: 0, itemId: 21750, dialogue: -1 },
  { enumName: "NOON", petId: NpcIdentifiers.NOON, morphId: 0, itemId: 21748, dialogue: -1 },
  { enumName: "HERBI", petId: NpcIdentifiers.HERBI, morphId: 0, itemId: 21509, dialogue: -1 },
  { enumName: "ABYSSAL_ORPHAN", petId: 5884, morphId: 0, itemId: 13262, dialogue: 202, mainDrop: true,
    getDialogue(player) {
      if (!player?.getAppearance?.()?.isMale?.()) return 206;
      const ids = [202, 209];
      return ids[Misc.getRandom(ids.length - 1)];
    } },
  { enumName: "DARK_CORE", petId: 318, morphId: 8010, itemId: 12816, dialogue: 123 },
  { enumName: "CORPOREAL_CRITTER", petId: 8010, morphId: 318, itemId: 12816, dialogue: 123 },
  { enumName: "VENENATIS_SPIDERLING", petId: 5557, morphId: 11985, itemId: 13177, dialogue: 126 },
  { enumName: "VENENATIS_SPIDERLING_LEGACY", petId: 11985, morphId: 5557, itemId: 13177, dialogue: 126 },
  { enumName: "CALLISTO_CUB", petId: 5558, morphId: 11986, itemId: 13178, dialogue: 130 },
  { enumName: "CALLISTO_CUB_LEGACY", petId: 11986, morphId: 5558, itemId: 13178, dialogue: 130 },
  {
    enumName: "HELLPUPPY",
    // 317 clients reliably render the legacy hellcat model id.
    petId: 1625,
    morphId: 0,
    itemId: 13247,
    dialogue: 138,
    getDialogue() {
      const ids = [138, 143, 145, 150, 154];
      return ids[Misc.getRandom(ids.length - 1)];
    },
  },
  { enumName: "CHAOS_ELEMENTAL_JR", petId: 2055, morphId: 0, itemId: 11995, dialogue: 158 },
  { enumName: "SNAKELING", petId: 2130, morphId: 2131, itemId: 12921, dialogue: 162 },
  { enumName: "MAGMA_SNAKELING", petId: 2131, morphId: 2132, itemId: 12921, dialogue: 169 },
  { enumName: "TANZANITE_SNAKELING", petId: 2132, morphId: 2130, itemId: 12921, dialogue: 176 },
  { enumName: "VETION_JR", petId: 5536, morphId: 5537, itemId: 13179, dialogue: 183 },
  { enumName: "VETION_JR_REBORN", petId: 5537, morphId: 5536, itemId: 13179, dialogue: 189 },
  { enumName: "SCORPIAS_OFFSPRING", petId: 5561, morphId: 0, itemId: 13181, dialogue: 195 },
  {
    enumName: "TZREK_JAD",
    petId: 5893,
    morphId: 10625,
    itemId: 13225,
    dialogue: 212,
    getDialogue() {
      const ids = [212, 217];
      return ids[Misc.getRandom(ids.length - 1)];
    },
  },
  { enumName: "JALREK_JAD", petId: 10625, morphId: 5893, itemId: 13225, dialogue: 212 },
  { enumName: "SUPREME_HATCHLING", petId: 6628, morphId: 0, itemId: 12643, dialogue: 220 },
  { enumName: "PRIME_HATCHLING", petId: 6629, morphId: 0, itemId: 12644, dialogue: 223 },
  { enumName: "REX_HATCHLING", petId: 6630, morphId: 0, itemId: 12645, dialogue: 231 },
  { enumName: "CHICK_ARRA", petId: 6631, morphId: 0, itemId: 12649, dialogue: 239 },
  { enumName: "GENERAL_AWWDOR", petId: 6632, morphId: 0, itemId: 12650, dialogue: 247 },
  {
    enumName: "COMMANDER_MINIANA",
    petId: 6633,
    morphId: 0,
    itemId: 12651,
    dialogue: 250,
    getDialogue(player) {
      if (player?.getEquipment?.()?.contains?.(11806)) return 252;
      return 250;
    },
  },
  { enumName: "KRIL_TINYROTH", petId: 6634, morphId: 0, itemId: 12652, dialogue: 254 },
  { enumName: "BABY_MOLE", petId: 6635, morphId: 0, itemId: 12646, dialogue: 261 },
  { enumName: "PRINCE_BLACK_DRAGON", petId: 6636, morphId: 0, itemId: 12653, dialogue: 267 },
  // The cache's Kalphite princess item is 12647; 12654 is the duplicate id drops never use.
  { enumName: "KALPHITE_PRINCESS", petId: 6637, morphId: 6638, itemId: 12647, dialogue: 271 },
  { enumName: "MORPHED_KALPHITE_PRINCESS", petId: 6638, morphId: 6637, itemId: 12647, dialogue: 279 },
  { enumName: "SMOKE_DEVIL", petId: 6639, morphId: 8483, itemId: 12648, dialogue: 288 },
  { enumName: "SMOKE_DEVIL_NORMAL", petId: 8483, morphId: 6639, itemId: 12648, dialogue: 288 },
  { enumName: "KRAKEN", petId: 6640, morphId: 0, itemId: 12655, dialogue: 291 },
  { enumName: "PENANCE_PRINCESS", petId: 6642, morphId: 0, itemId: 12703, dialogue: 296 },
  { enumName: "OLMLET", petId: 7520, morphId: 8201, itemId: 20851, dialogue: 298 },
  { enumName: "PUPPADILE", petId: 8201, morphId: 8202, itemId: 20851, dialogue: 298 },
  { enumName: "TEKTINY", petId: 8202, morphId: 8203, itemId: 20851, dialogue: 298 },
  { enumName: "VANGUARD_PET", petId: 8203, morphId: 8204, itemId: 20851, dialogue: 298 },
  { enumName: "VASA_MINIRIO", petId: 8204, morphId: 8205, itemId: 20851, dialogue: 298 },
  { enumName: "VESPINA", petId: 8205, morphId: 7520, itemId: 20851, dialogue: 298 },
  { enumName: "SKOTOS", petId: 425, morphId: 0, itemId: 21273, dialogue: 298 },
  { enumName: "IKKLE_HYDRA", petId: NpcIdentifiers.IKKLE_HYDRA, morphId: NpcIdentifiers.IKKLE_HYDRA_2, itemId: 22746, dialogue: -1 },
  { enumName: "IKKLE_HYDRA_ELECTRIC", petId: NpcIdentifiers.IKKLE_HYDRA_2, morphId: NpcIdentifiers.IKKLE_HYDRA_3, itemId: 22746, dialogue: -1 },
  { enumName: "IKKLE_HYDRA_FIRE", petId: NpcIdentifiers.IKKLE_HYDRA_3, morphId: NpcIdentifiers.IKKLE_HYDRA_4, itemId: 22746, dialogue: -1 },
  { enumName: "IKKLE_HYDRA_EXTINGUISHED", petId: NpcIdentifiers.IKKLE_HYDRA_4, morphId: NpcIdentifiers.IKKLE_HYDRA, itemId: 22746, dialogue: -1 },
  // Cache `isFollower` ids: 2144/11159/11160 are the pet; 2143/11157/11158 are static copies.
  { enumName: "SRARACHA", petId: 2144, morphId: 11159, itemId: 23495, dialogue: -1 },
  { enumName: "SRARACHA_2", petId: 11159, morphId: 11160, itemId: 23495, dialogue: -1 },
  { enumName: "SRARACHA_3", petId: 11160, morphId: 2144, itemId: 23495, dialogue: -1 },
  { enumName: "SMOLCANO", petId: NpcIdentifiers.SMOLCANO_2, morphId: 0, itemId: 23760, dialogue: -1 },
  { enumName: "LITTLE_NIGHTMARE", petId: NpcIdentifiers.LITTLE_NIGHTMARE_2, morphId: 0, itemId: 24491, dialogue: -1 },
  { enumName: "YOUNGLLEF", petId: NpcIdentifiers.YOUNGLLEF_2, morphId: NpcIdentifiers.CORRUPTED_YOUNGLLEF_2, itemId: 23757, dialogue: -1 },
  { enumName: "CORRUPTED_YOUNGLLEF", petId: NpcIdentifiers.CORRUPTED_YOUNGLLEF_2, morphId: NpcIdentifiers.YOUNGLLEF_2, itemId: 23757, dialogue: -1 },
  { enumName: "TINY_TEMPOR", petId: NpcIdentifiers.TINY_TEMPOR_2, morphId: 0, itemId: 25602, dialogue: -1 },
  { enumName: "ABYSSAL_PROTECTOR", petId: NpcIdentifiers.ABYSSAL_PROTECTOR_2, morphId: 0, itemId: 26901, dialogue: -1 },
  { enumName: "HUBERTE", petId: NpcIdentifiers.HUBERTE_2, morphId: 0, itemId: 30152, dialogue: -1 },
  { enumName: "MOXI", petId: NpcIdentifiers.MOXI_2, morphId: 0, itemId: 30154, dialogue: -1 },
  { enumName: "BRAN", petId: NpcIdentifiers.BRAN_2, morphId: 0, itemId: 30622, dialogue: -1 },
  { enumName: "YAMI", petId: NpcIdentifiers.YAMI_2, morphId: 0, itemId: 30888, dialogue: -1 },
  { enumName: "DOM", petId: NpcIdentifiers.DOM_2, morphId: 0, itemId: 31130, dialogue: -1 },
  // The follower Gulldamar look: 14931 carries the Metamorph option live.
  { enumName: "GULL", petId: NpcIdentifiers.GULL_7, morphId: 0, itemId: 31285, dialogue: -1 },
  { enumName: "CHOMPY_CHICK", petId: NpcIdentifiers.CHOMPY_CHICK_2, morphId: 0, itemId: 13071, dialogue: -1 },
  { enumName: "BLOODHOUND", petId: NpcIdentifiers.BLOODHOUND_2, morphId: 0, itemId: 19730, dialogue: -1 },

  // Wintertodt's reward cart (followers are 7370, as in live captures).
  { enumName: "PHOENIX", petId: NpcIdentifiers.PHOENIX_2, morphId: 0, itemId: 20693, dialogue: -1 },
  { enumName: "HERON", petId: 6722, morphId: 10636, itemId: 13320, dialogue: -1, skill: Skill.FISHING, chance: 5000 },
  { enumName: "GREAT_BLUE_HERON", petId: 10636, morphId: 6722, itemId: 13320, dialogue: -1, skill: Skill.FISHING, chance: 5000 },
  {
    enumName: "BEAVER",
    petId: 6717,
    morphId: 0,
    itemId: 13322,
    dialogue: -1,
    skill: Skill.WOODCUTTING,
    chance: 5000,
  },
  {
    enumName: "GREY_CHINCHOMPA",
    petId: 6719,
    morphId: 6720,
    itemId: 13324,
    dialogue: -1,
    skill: Skill.HUNTER,
    chance: 3000,
  },
  {
    enumName: "RED_CHINCHOMPA",
    petId: 6718,
    morphId: 6719,
    itemId: 13323,
    dialogue: -1,
    skill: Skill.HUNTER,
    chance: 4000,
  },
  {
    enumName: "BLACK_CHINCHOMPA",
    petId: 6720,
    morphId: 6718,
    itemId: 13325,
    dialogue: -1,
    skill: Skill.HUNTER,
    chance: 5000,
  },
  {
    enumName: "ROCK_GOLEM",
    petId: NpcIdentifiers.ROCK_GOLEM_25,
    morphId: 0,
    itemId: 13321,
    dialogue: -1,
    skill: Skill.MINING,
    chance: 5000,
  },
  {
    enumName: "GIANT_SQUIRREL",
    petId: 7334,
    morphId: 0,
    itemId: 20659,
    dialogue: -1,
    skill: Skill.AGILITY,
    chance: 5000,
  },
  {
    enumName: "TANGLEROOT",
    petId: 7335,
    morphId: 0,
    itemId: 20661,
    dialogue: -1,
    skill: Skill.FARMING,
    chance: 5000,
  },
  {
    enumName: "ROCKY",
    petId: 7336,
    morphId: 0,
    itemId: 20663,
    dialogue: -1,
    skill: Skill.THIEVING,
    chance: 5000,
  },
  {
    enumName: "SOUP",
    petId: NpcIdentifiers.SOUP,
    morphId: 0,
    itemId: 31283,
    dialogue: -1,
    skill: Skill.SAILING,
    // Sailors roll Soup per action's own chance (Salvaging passes petChance); the flat
    // base keeps the entry resolvable for the skill event registration.
    chance: 800000,
  },

  // Kitten items 1555-1560: the quest grants the kitten; the item is the durable form.
  // The cache gives the six kitten followers ids 5591-5596 but does not link item colour
  // to npc, so the parallel item/npc order is used and a colour mismatch is possible.
  // ponytail: no kitten growth timer; a kitten stays a kitten until grown elsewhere.
  { enumName: "PET_KITTEN", petId: 5591, morphId: 0, itemId: 1555, dialogue: -1, reclaimable: false },
  { enumName: "PET_KITTEN_2", petId: 5592, morphId: 0, itemId: 1556, dialogue: -1, reclaimable: false },
  { enumName: "PET_KITTEN_3", petId: 5593, morphId: 0, itemId: 1557, dialogue: -1, reclaimable: false },
  { enumName: "PET_KITTEN_4", petId: 5594, morphId: 0, itemId: 1558, dialogue: -1, reclaimable: false },
  { enumName: "PET_KITTEN_5", petId: 5595, morphId: 0, itemId: 1559, dialogue: -1, reclaimable: false },
  { enumName: "PET_KITTEN_6", petId: 5596, morphId: 0, itemId: 1560, dialogue: -1, reclaimable: false },

  {
    enumName: "FIRE_RIFT_GUARDIAN",
    petId: 7337,
    morphId: 7338,
    itemId: 20665,
    dialogue: -1,
    skill: Skill.RUNECRAFTING,
    chance: 8000,
  },
  {
    enumName: "AIR_RIFT_GUARDIAN",
    petId: 7338,
    morphId: 7339,
    itemId: 20667,
    dialogue: -1,
    skill: Skill.RUNECRAFTING,
    chance: 8000,
  },
  {
    enumName: "MIND_RIFT_GUARDIAN",
    petId: 7339,
    morphId: 7340,
    itemId: 20669,
    dialogue: -1,
    skill: Skill.RUNECRAFTING,
    chance: 8000,
  },
  {
    enumName: "WATER_RIFT_GUARDIAN",
    petId: 7340,
    morphId: 7341,
    itemId: 20671,
    dialogue: -1,
    skill: Skill.RUNECRAFTING,
    chance: 8000,
  },
  {
    enumName: "EARTH_RIFT_GUARDIAN",
    petId: 7341,
    morphId: 7342,
    itemId: 20673,
    dialogue: -1,
    skill: Skill.RUNECRAFTING,
    chance: 8000,
  },
  {
    enumName: "BODY_RIFT_GUARDIAN",
    petId: 7342,
    morphId: 7343,
    itemId: 20675,
    dialogue: -1,
    skill: Skill.RUNECRAFTING,
    chance: 8000,
  },
  {
    enumName: "COSMIC_RIFT_GUARDIAN",
    petId: 7343,
    morphId: 7344,
    itemId: 20677,
    dialogue: -1,
    skill: Skill.RUNECRAFTING,
    chance: 8000,
  },
  {
    enumName: "CHAOS_RIFT_GUARDIAN",
    petId: 7344,
    morphId: 7345,
    itemId: 20679,
    dialogue: -1,
    skill: Skill.RUNECRAFTING,
    chance: 8000,
  },
  {
    enumName: "NATURE_RIFT_GUARDIAN",
    petId: 7345,
    morphId: 7346,
    itemId: 20681,
    dialogue: -1,
    skill: Skill.RUNECRAFTING,
    chance: 8000,
  },
  {
    enumName: "LAW_RIFT_GUARDIAN",
    petId: 7346,
    morphId: 7347,
    itemId: 20683,
    dialogue: -1,
    skill: Skill.RUNECRAFTING,
    chance: 8000,
  },
  {
    enumName: "DEATH_RIFT_GUARDIAN",
    petId: 7347,
    morphId: 7348,
    itemId: 20685,
    dialogue: -1,
    skill: Skill.RUNECRAFTING,
    chance: 8000,
  },
  {
    enumName: "SOUL_RIFT_GUARDIAN",
    petId: 7348,
    morphId: 7349,
    itemId: 20687,
    dialogue: -1,
    skill: Skill.RUNECRAFTING,
    chance: 8000,
  },
  {
    enumName: "ASTRAL_RIFT_GUARDIAN",
    petId: 7349,
    morphId: 7350,
    itemId: 20689,
    dialogue: -1,
    skill: Skill.RUNECRAFTING,
    chance: 8000,
  },
  {
    enumName: "BLOOD_RIFT_GUARDIAN",
    petId: 7350,
    morphId: 7337,
    itemId: 20691,
    dialogue: -1,
    skill: Skill.RUNECRAFTING,
    chance: 8000,
  },
];

const PET_BY_ID = new Map();
const PET_BY_ITEM_ID = new Map();
const PET_BY_NAME = new Map();

for (const pet of PETS) {
  PET_BY_ID.set(pet.petId, pet);
  PET_BY_NAME.set(pet.enumName, pet);
  if (Number.isInteger(pet.itemId) && !PET_BY_ITEM_ID.has(pet.itemId)) {
    PET_BY_ITEM_ID.set(pet.itemId, pet);
  }
}

const SKILLING_PETS = [
  PET_BY_NAME.get("HERON"),
  PET_BY_NAME.get("BEAVER"),
  PET_BY_NAME.get("GREY_CHINCHOMPA"),
  PET_BY_NAME.get("RED_CHINCHOMPA"),
  PET_BY_NAME.get("BLACK_CHINCHOMPA"),
  PET_BY_NAME.get("ROCK_GOLEM"),
  PET_BY_NAME.get("GIANT_SQUIRREL"),
  PET_BY_NAME.get("TANGLEROOT"),
  PET_BY_NAME.get("ROCKY"),
  PET_BY_NAME.get("SOUP"),
  ...PETS.filter((pet) => pet.enumName.endsWith("_RIFT_GUARDIAN")),
].filter((pet) => pet != null);

/** A skill has one pet whatever its colour; any other pet is its own item. */
function petFamily(pet) {
  return pet.skill != null ? `skill:${normalizeSkillName(pet.skill)}` : `item:${pet.itemId}`;
}

function getOwnedPetItems(player) {
  const owned = player.getAttribute(OWNED_ATTRIBUTE);
  return Array.isArray(owned) ? owned.filter((itemId) => getPetForItemId(itemId)) : [];
}

function ownsPetFamily(player, pet) {
  const family = petFamily(pet);
  return getOwnedPetItems(player).some((itemId) => {
    const owned = getPetForItemId(itemId);
    return owned != null && petFamily(owned) === family;
  });
}

function recordOwnership(player, pet) {
  if (pet?.reclaimable === false) return;
  const family = petFamily(pet);
  const owned = getOwnedPetItems(player);
  // One ownership record per pet family: a metamorphosis that changes the item (a
  // rift guardian's colour) replaces the old record instead of insuring both.
  const others = owned.filter((itemId) => {
    const other = getPetForItemId(itemId);
    return other == null || petFamily(other) !== family;
  });
  if (others.length === owned.length && owned.includes(pet.itemId)) return;
  player.setAttribute(OWNED_ATTRIBUTE, [...others, pet.itemId]);
  syncCollectionLog(player);
}

/** The collection log lists one item per pet: a skilling pet's base colour, never a morph. */
function collectionLogItemId(pet) {
  if (pet?.skill == null) return pet?.itemId;
  const base = SKILLING_PETS.find((candidate) => candidate.skill === pet.skill);
  return base?.itemId ?? pet.itemId;
}

/** Ticks the collection log's collected entries from the persisted ownership record. */
function syncCollectionLog(player) {
  const sender = player?.getPacketSender?.();
  if (typeof sender?.sendCollectionLogSnapshot !== "function") return;
  const itemIds = [];
  for (const itemId of getOwnedPetItems(player)) {
    const logId = collectionLogItemId(getPetForItemId(itemId));
    if (Number.isInteger(logId) && !itemIds.includes(logId)) itemIds.push(logId);
  }
  sender.sendCollectionLogSnapshot(itemIds.map((itemId, slot) => ({ slot, itemId, quantity: 1 })));
}

/** One pet item into the backpack, or the ground when there is no space. */
function deliverPetItem(player, itemId) {
  if (!player.getInventory().isFull()) {
    player.getInventory().adds(itemId, 1);
    return true;
  }
  ItemOnGroundManager.registerNonGlobal(player, new Item(itemId));
  return false;
}

/**
 * Awards a pet the way OSRS does: a follower if there is none, otherwise into the
 * backpack; a pet the player already owns is a "would have been followed" miss,
 * unless the pet is a main drop (Abyssal orphan, Smol Heredit) which always lands.
 */
function awardPet(player, itemId) {
  const pet = getPetForItemId(itemId);
  if (!pet) return false;
  if (ownsPetFamily(player, pet)) {
    if (pet.mainDrop) {
      deliverPetItem(player, pet.itemId);
      return true;
    }
    player.sendMessage("You have a funny feeling like you would have been followed...");
    return false;
  }
  recordOwnership(player, pet);
  const following = player.getAttribute?.(CURRENT_PET_ATTRIBUTE)?.isRegistered?.() === true;
  if (following && player.getInventory().isFull()) {
    // OSRS then loses the pet to Probita; the owned record lets her return it.
    player.sendMessage("You have a funny feeling like you would have been followed... Probita can help.");
    return true;
  }
  if (following) {
    player.getInventory().adds(pet.itemId, 1);
    player.sendMessage("You feel something weird sneaking into your backpack.");
    return true;
  }
  return drop(player, pet.itemId, true);
}

/** Does the player hold this pet item anywhere (follower, inventory, bank)? */
function holdsPetItem(player, itemId) {
  const current = player.getAttribute?.(CURRENT_PET_ATTRIBUTE);
  if (current?.isRegistered?.() && getPetByNpcId(current.getId())?.itemId === itemId) return true;
  if (player.getInventory?.()?.contains?.(itemId)) return true;
  const banks = player.getBanks?.() ?? [];
  for (let tab = 0; tab < Bank.TOTAL_BANK_TABS; tab++) {
    if (tab !== Bank.BANK_SEARCH_TAB_INDEX && banks[tab]?.contains?.(itemId)) return true;
  }
  return false;
}

/** Probita's "Let's have a look...": every insured pet the player no longer has comes back. */
function reclaimPets(event) {
  if (event.npcId !== NpcIdentifiers.PROBITA || event.action !== "open_interface" || event.target !== "Pet Insurance") {
    return;
  }
  event.handled = true;
  event.end = true;
  const { player } = event;
  // Pets are automatically, freely insured (Wiki, Probita); generic pets are excluded.
  const lost = getOwnedPetItems(player).filter((itemId) => !holdsPetItem(player, itemId));
  if (lost.length === 0) {
    player.sendMessage("You don't have any pets to reclaim.");
    return;
  }
  for (const itemId of lost) {
    if (player.getInventory().isFull()) {
      player.sendMessage("You need more inventory space to reclaim the rest of your pets.");
      return;
    }
    player.getInventory().adds(itemId, 1);
    player.sendMessage(`Probita returns your ${getPetDisplayName(getPetForItemId(itemId))}.`);
  }
  syncCollectionLog(player);
}

/** Boss pets come straight to the killer instead of landing on the floor. */
function awardDroppedPets({ player, drops }) {
  if (!player || !Array.isArray(drops)) return;
  for (let index = drops.length - 1; index >= 0; index--) {
    const itemId = drops[index]?.itemId ?? drops[index]?.id;
    if (!getPetForItemId(itemId)) continue;
    drops.splice(index, 1);
    awardPet(player, itemId);
  }
}

function getPetByNpcId(id) {
  return PET_BY_ID.get(id) ?? null;
}

function getPetForItemId(itemId) {
  return PET_BY_ITEM_ID.get(itemId) ?? null;
}

function getPetDialogue(pet, player) {
  if (!pet) {
    return -1;
  }
  if (typeof pet.getDialogue === "function") {
    return pet.getDialogue(player);
  }
  return pet.dialogue;
}

function getPetDisplayName(pet) {
  if (!pet) {
    return "pet";
  }
  return Misc.capitalizeWords(pet.enumName.toLowerCase().replace(/_/g, " "));
}

function normalizeSkillName(skill) {
  const skillName =
    skill?.getName?.() ??
    skill?.name ??
    (typeof skill === "number" && typeof Skill?.[skill] === "string" ? Skill[skill] : null);
  if (typeof skillName === "string" && skillName.length > 0) {
    return skillName.toLowerCase().replace(/_/g, " ");
  }
  if (typeof skill === "number" && typeof Skill?.[skill] === "string") {
    return Skill[skill].toLowerCase().replace(/_/g, " ");
  }
  return String(skill).toLowerCase().replace(/_/g, " ");
}

function log(event, extra = {}) {
  if (pluginApi && typeof pluginApi.log === "function") {
    pluginApi.log(event, extra);
    return;
  }
  try {
    console.log(`[plugin:Pets] ${event}`, extra);
  } catch {
    // Best-effort logging only.
  }
}

// ---------------------------------------------------------------- variants

function getVariantMap(player) {
  const stored = player.getAttribute?.(VARIANT_ATTRIBUTE);
  return stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
}

/** The stored npc id of the chosen metamorphosis form for this pet's family. */
function getStoredVariant(player, pet) {
  const variant = getVariantMap(player)[petFamily(pet)];
  const variantPet = Number.isInteger(variant) ? getPetByNpcId(variant) : null;
  return variantPet && petFamily(variantPet) === petFamily(pet) ? variant : 0;
}

function setStoredVariant(player, pet, npcId) {
  player.setAttribute(VARIANT_ATTRIBUTE, { ...getVariantMap(player), [petFamily(pet)]: npcId });
}

/** Re-applies the chosen form to a freshly summoned follower. */
function applyStoredVariant(player, npc, pet) {
  const variant = getStoredVariant(player, pet);
  if (variant && variant !== npc.getRealId?.()) {
    npc.setNpcTransformationId(variant);
  }
}

// ---------------------------------------------------------------- follower

function chooseSpawnLocation(player) {
  const tiles = [];
  const outterTiles = player?.outterTiles?.() ?? [];
  for (const tile of outterTiles) {
    if (RegionManager.blocked(tile, player.getPrivateArea())) {
      continue;
    }
    tiles.push(tile);
  }
  if (tiles.length === 0) {
    return player.getLocation().clone();
  }
  return tiles[Misc.getRandom(tiles.length - 1)];
}

function canSummonPetHere(player, reward) {
  if (reward) {
    return true;
  }
  const area = player.getArea?.();
  if (!area || typeof area.allowSummonPet !== "function") {
    return true;
  }
  return area.allowSummonPet(player) !== false;
}

function findOwnedPetItemSource(player) {
  if (!player) {
    return null;
  }

  const petItems = Array.from(PET_BY_ITEM_ID.values()).filter(
    (pet) => Number.isInteger(pet?.itemId) && pet.itemId > 0
  );

  const inventory = player.getInventory?.();
  for (const pet of petItems) {
    if (inventory?.contains?.(pet.itemId)) {
      return { itemId: pet.itemId, source: "inventory", bankTab: -1 };
    }
  }

  const banks = player.getBanks?.() ?? [];
  for (let tab = 0; tab < Bank.TOTAL_BANK_TABS; tab++) {
    if (tab === Bank.BANK_SEARCH_TAB_INDEX) {
      continue;
    }
    const bank = banks[tab];
    if (!bank) {
      continue;
    }
    for (const pet of petItems) {
      if (bank.contains?.(pet.itemId)) {
        return { itemId: pet.itemId, source: "bank", bankTab: tab };
      }
    }
  }

  return null;
}

function spawnPetNpc(npc) {
  if (World.getNpcs().add(npc)) {
    return {
      mode: "direct",
      alreadyQueued: false,
      addNpcQueueSize: World.getAddNPCQueue().length,
    };
  }

  const addQueue = World.getAddNPCQueue();
  const alreadyQueued = addQueue.includes(npc);
  if (!alreadyQueued) {
    addQueue.push(npc);
  }

  return {
    mode: "queued",
    alreadyQueued,
    addNpcQueueSize: addQueue.length,
  };
}

function despawnPetNpc(npc) {
  if (!npc) {
    return {
      removedFromAddQueue: false,
      queuedForRemoval: false,
      registered: false,
    };
  }

  const addQueue = World.getAddNPCQueue();
  let removedFromAddQueue = false;
  for (let index = addQueue.indexOf(npc); index !== -1; index = addQueue.indexOf(npc)) {
    addQueue.splice(index, 1);
    removedFromAddQueue = true;
  }

  let queuedForRemoval = false;
  const registered = typeof npc.isRegistered === "function" ? npc.isRegistered() : false;
  if (registered) {
    const removeQueue = World.getRemoveNPCQueue();
    if (!removeQueue.includes(npc)) {
      removeQueue.push(npc);
      queuedForRemoval = true;
    }
  }

  return {
    removedFromAddQueue,
    queuedForRemoval,
    registered,
  };
}

function syncFollowerIndex(player, pet) {
  const index = pet?.isRegistered?.() ? pet.getIndex?.() ?? -1 : -1;
  player?.getPacketSender?.().sendConfig(FOLLOWER_INDEX_VARP, index > 0 ? index : 65535);
}

function drop(player, itemId, reward, { silent = false } = {}) {
  const username = player?.getUsername?.() ?? null;
  const pet = getPetForItemId(itemId);
  if (!pet) {
    log("drop_not_pet_item", { username, itemId, reward });
    return false;
  }

  const existingPet = player.getAttribute?.(CURRENT_PET_ATTRIBUTE);
  if (existingPet && !existingPet.isRegistered?.()) {
    log("drop_clear_stale_current_pet", {
      username,
      itemId,
      stalePetId: existingPet.getId?.() ?? null,
    });
    player.setAttribute?.(CURRENT_PET_ATTRIBUTE, null);
  }

  if (!player.getAttribute(CURRENT_PET_ATTRIBUTE)) {
    if (!canSummonPetHere(player, reward)) {
      log("drop_blocked_by_area", {
        username,
        itemId,
        petNpcId: pet.petId,
        area: player.getArea?.()?.getName?.() ?? null,
        reward,
      });
      return false;
    }

    const location = chooseSpawnLocation(player);
    const npc = NPC.create(pet.petId, location);
    npc.setPet(true);
    npc.setOwner(player);
    npc.setFollowing(player);
    npc.setMobileInteraction(player);
    npc.setArea(player.getArea());
    applyStoredVariant(player, npc, pet);
    const spawnResult = spawnPetNpc(npc);
    log(spawnResult.mode === "direct" ? "drop_spawn_added" : "drop_spawn_queued", {
      username,
      itemId: pet.itemId,
      petNpcId: pet.petId,
      x: location.getX?.() ?? null,
      y: location.getY?.() ?? null,
      z: location.getZ?.() ?? null,
      addNpcQueueSize: spawnResult.addNpcQueueSize,
      spawnMode: spawnResult.mode,
      alreadyQueued: spawnResult.alreadyQueued,
      npcRegistered: npc.isRegistered?.() ?? null,
      npcIndex: npc.getIndex?.() ?? null,
    });

    player.setAttribute(CURRENT_PET_ATTRIBUTE, npc);
    player.setAttribute(LAST_PET_ATTRIBUTE, pet.itemId);
    syncFollowerIndex(player, npc);
    setTimeout(() => {
      const index = npc.getIndex?.() ?? -1;
      const inWorld = index > 0 ? World.getNpcs().get(index) === npc : false;
      log("drop_spawn_postcheck", {
        username,
        itemId: pet.itemId,
        petNpcId: pet.petId,
        spawnMode: spawnResult.mode,
        npcRegistered: npc.isRegistered?.() ?? null,
        npcIndex: index,
        inWorld,
        addNpcQueueSize: World.getAddNPCQueue().length,
        removeNpcQueueSize: World.getRemoveNPCQueue().length,
      });
      if (player.getAttribute?.(CURRENT_PET_ATTRIBUTE) === npc) {
        syncFollowerIndex(player, npc);
      }
    }, 1200);

    recordOwnership(player, pet);
    if (reward) {
      if (!silent) player.sendMessage("You have a funny feeling like you're being followed.");
    } else {
      player.getInventory().deleteNumber(pet.itemId, 1);
      Sounds.sendSound(player, Sound.DROP_ITEM);
      player.sendMessage("You drop your pet..");
      player.performAnimation(INTERACTION_ANIM);
      player.setPositionToFace(npc.getLocation());
    }
  } else if (reward) {
    if (!player.getInventory().isFull()) {
      player.getInventory().adds(pet.itemId, 1);
    } else {
      ItemOnGroundManager.registerNonGlobal(player, new Item(pet.itemId));
    }
    if (!silent) player.sendMessage("@dre@You've received a pet!");
  } else {
    const currentPet = player.getAttribute(CURRENT_PET_ATTRIBUTE);
    log("drop_already_has_pet", {
      username,
      itemId,
      currentPetId: currentPet?.getId?.() ?? null,
      currentPetRegistered: currentPet?.isRegistered?.() ?? null,
    });
    player.sendMessage("You already have a pet following you.");
  }

  return true;
}

function pickup(player, npc, { auto = false } = {}) {
  if (!npc || !player) {
    return false;
  }

  const pet = getPetByNpcId(npc.getId());
  if (
    !pet ||
    !npc.isPet?.() ||
    npc.getOwner?.()?.getIndex?.() !== player.getIndex?.()
  ) {
    return false;
  }

  if (player.getInventory().isFull()) {
    if (!auto) {
      player.sendMessage("You don't have enough inventory space.");
      return true;
    }
    // A logout cannot leave the follower behind: OSRS banks a pet with no inventory room.
    const bank = player.getBank?.(Bank.getTabForItem(player, pet.itemId));
    if (!bank || bank.adds(pet.itemId, 1) === false) {
      player.sendMessage("You don't have enough inventory or bank space for your pet.");
      return true;
    }
  } else {
    player.getInventory().adds(pet.itemId, 1);
  }

  player.getMovementQueue().reset();
  player.performAnimation(INTERACTION_ANIM);
  const despawnResult = despawnPetNpc(npc);
  log("pickup_despawn", {
    username: player?.getUsername?.() ?? null,
    petNpcId: npc.getId?.() ?? null,
    petIndex: npc.getIndex?.() ?? null,
    removedFromAddQueue: despawnResult.removedFromAddQueue,
    queuedForRemoval: despawnResult.queuedForRemoval,
    registered: despawnResult.registered,
    addNpcQueueSize: World.getAddNPCQueue().length,
    removeNpcQueueSize: World.getRemoveNPCQueue().length,
  });

  player.sendMessage("You pick up your pet..");
  Sounds.sendSound(player, Sound.PICK_UP_ITEM);
  // The item now in hand is the current form; a cross-item morph replaces the record.
  recordOwnership(player, pet);
  player.setAttribute(CURRENT_PET_ATTRIBUTE, null);
  if (!auto) player.setAttribute(LAST_PET_ATTRIBUTE, null);
  syncFollowerIndex(player, null);
  return true;
}

/** Logout/disconnect: remember the follower, then pick it up (bank if the backpack is full). */
function returnFollowerOnLogout(player) {
  const npc = player.getAttribute?.(CURRENT_PET_ATTRIBUTE);
  const pet = npc ? getPetByNpcId(npc.getId()) : null;
  if (pet) player.setAttribute(LAST_PET_ATTRIBUTE, pet.itemId);
  pickup(player, npc, { auto: true });
}

function morph(player, npc) {
  if (!npc || !player?.getAttribute?.(CURRENT_PET_ATTRIBUTE)) {
    return false;
  }

  const pet = getPetByNpcId(npc.getId());
  if (!pet || pet.morphId === 0) {
    return false;
  }

  if (player.getAttribute(CURRENT_PET_ATTRIBUTE) !== npc) {
    return false;
  }

  const next = getPetByNpcId(pet.morphId);
  if (!next || petFamily(next) !== petFamily(pet)) {
    // A cycle must stay within the pet's family so the item and ownership never change.
    player.sendMessage("Your pet can't change like that.");
    return false;
  }
  npc.setNpcTransformationId(pet.morphId);
  setStoredVariant(player, pet, pet.morphId);
  player.sendMessage("Your pet endures metamorphosis and transforms.");
  return true;
}

function interact(player, npc) {
  if (!npc || !player?.getAttribute?.(CURRENT_PET_ATTRIBUTE)) {
    return false;
  }

  const pet = getPetByNpcId(npc.getId());
  if (!pet) {
    return false;
  }

  if (player.getAttribute(CURRENT_PET_ATTRIBUTE) !== npc) {
    return false;
  }

  // Skilling pets carry dialogue -1: Interact is a no-op rather than an empty
  // dialogue box or the generic "Nothing interesting happens." fallback.
  if (getPetDialogue(pet, player) === -1) {
    return true;
  }

  // The wiki pet transcripts are not in npc-dialogues.json, so Interact stays a
  // deterministic no-op rather than inventing lines; pick-up and Metamorphosis still work.
  return true;
}

/** Which pet action a click maps to, from the NPC's cached options, then the click index. */
function handlePetClick(event) {
  if (!event?.player || !event.npc || !getPetByNpcId(event.npcId)) {
    return false;
  }
  const action = String(event.definition?.getActions?.()?.[event.clickType - 1] ?? "");
  const lower = action.toLowerCase();
  if (lower === "pick-up") return pickup(event.player, event.npc);
  if (lower === "metamorphosis" || lower === "metamorph") return morph(event.player, event.npc);
  if (lower === "talk-to" || lower === "interact" || lower === "stroke") {
    return interact(event.player, event.npc);
  }
  if (action) return false;
  // The client injects Talk-to/Metamorphosis/Pick-up on pet definitions that predate them.
  if (event.clickType === 1) return interact(event.player, event.npc);
  if (event.clickType === 2) return morph(event.player, event.npc) || pickup(event.player, event.npc);
  return pickup(event.player, event.npc);
}

function pickUpAction(event) {
  return pickup(event.player, event.npc);
}

function morphAction(event) {
  return morph(event.player, event.npc);
}

/** Re-summons the pet the player logged out with; a normal relog rebuilds at most one. */
function restoreFollowerOnLogin(player) {
  if (!player) return false;
  const existing = player.getAttribute?.(CURRENT_PET_ATTRIBUTE);
  if (existing && !existing.isRegistered?.()) {
    player.setAttribute(CURRENT_PET_ATTRIBUTE, null);
  }
  if (player.getAttribute?.(CURRENT_PET_ATTRIBUTE)) return false;

  const last = player.getAttribute?.(LAST_PET_ATTRIBUTE);
  const itemId = Number.isInteger(last) ? last : null;
  if (itemId && player.getInventory?.().contains?.(itemId)) {
    if (drop(player, itemId, true, { silent: true })) {
      player.getInventory().deleteNumber(itemId, 1);
      return true;
    }
  }
  // A logout with a full backpack banks the follower; take it back out on login.
  const banks = player.getBanks?.() ?? [];
  for (let tab = 0; itemId && tab < Bank.TOTAL_BANK_TABS; tab++) {
    if (tab === Bank.BANK_SEARCH_TAB_INDEX) continue;
    const bank = banks[tab];
    if (!bank?.contains?.(itemId)) continue;
    if (drop(player, itemId, true, { silent: true })) {
      player.getBank(tab).deleteNumber(itemId, 1);
      return true;
    }
    break;
  }
  return summonOwnedPetOnBotLogin(player);
}

function summonOwnedPetOnBotLogin(player) {
  if (!player?.isPlayerBot?.() || !player.isPlayerBot()) {
    return false;
  }
  if (player.getAttribute?.(CURRENT_PET_ATTRIBUTE)) {
    return false;
  }

  const ownedPet = findOwnedPetItemSource(player);
  if (!ownedPet) {
    return false;
  }

  // Use reward summon path to avoid interaction-side effects while auto-restoring bots.
  const summoned = drop(player, ownedPet.itemId, true, { silent: true });
  if (!summoned) {
    return false;
  }

  if (ownedPet.source === "inventory") {
    player.getInventory().deleteNumber(ownedPet.itemId, 1);
  } else {
    player.getBank(ownedPet.bankTab).deleteNumber(ownedPet.itemId, 1);
  }
  return true;
}

/** rune id -> rift guardian colour, chinchompa npc id -> baby chinchompa colour; filled at register. */
const SKILL_PET_VARIANTS = new Map();

function skillPetHandler(skill) {
  return (event) => onSkill(event.player, skill, event);
}

function onPetItemDropPolicy(event) {
  if (!event?.player) return;
  if (drop(event.player, event.itemId, false)) {
    event.handled = true;
  }
}

function onPetPlayerLogout({ player }) {
  returnFollowerOnLogout(player);
}

function onPetPlayerDisconnect({ player }) {
  returnFollowerOnLogout(player);
}

function onPetPlayerLogin({ player }) {
  syncFollowerIndex(player, player.getAttribute?.(CURRENT_PET_ATTRIBUTE));
  restoreFollowerOnLogin(player);
  syncCollectionLog(player);
}

/**
 * Rolls a skill's pet at the Wiki rate, 1 in (base - level * 25), fifteen times as
 * likely at 200M XP. Emitters pass the action's base as petBase (or a finished
 * petChance), how many rolls it earned (rift guardians roll per essence), and the
 * runeId / npcId that picks the pet's colour. No rate means the action can't roll.
 */
function onSkill(player, skill, { petBase, petChance, rolls = 1, runeId, npcId } = {}) {
  const pet =
    SKILL_PET_VARIANTS.get(`rune:${runeId}`) ??
    SKILL_PET_VARIANTS.get(`npc:${npcId}`) ??
    SKILLING_PETS.find((candidate) => candidate.skill === skill);
  if (!pet || !player) return false;
  let chance = petChance;
  if (!(Number.isFinite(chance) && chance > 0) && Number.isFinite(petBase) && petBase > 0) {
    const skills = player.getSkillManager();
    chance = (petBase - skills.getMaxLevel(skill) * 25) / (skills.getExperience(skill) >= MAX_XP ? 15 : 1);
  }
  if (!(Number.isFinite(chance) && chance > 0)) return false;
  let hit = false;
  for (let roll = 0; roll < Math.max(1, rolls | 0) && !hit; roll++) {
    hit = Math.random() < 1 / chance;
  }
  if (!hit) return false;
  if (!ownsPetFamily(player, pet)) {
    World.sendMessage(
      `@dre@${player.getUsername()} just found a stray ${getPetDisplayName(pet)} while ${normalizeSkillName(skill)}!`
    );
  }
  awardPet(player, pet.itemId);
  return true;
}

function fillSkillPetVariants({ ItemIdentifiers, NpcIdentifiers: Npcs }) {
  if (!PET_BY_NAME.has("QUETZIN")) {
    const pet = { enumName: "QUETZIN", petId: Npcs.QUETZIN, morphId: 0, itemId: ItemIdentifiers.QUETZIN, dialogue: -1 };
    PETS.push(pet); PET_BY_ID.set(pet.petId, pet); PET_BY_NAME.set(pet.enumName, pet); PET_BY_ITEM_ID.set(pet.itemId, pet);
  }
  for (const pet of PETS) {
    if (!pet.enumName.endsWith("_RIFT_GUARDIAN")) continue;
    const runeId = ItemIdentifiers[pet.enumName.replace("_RIFT_GUARDIAN", "_RUNE")];
    if (Number.isInteger(runeId)) SKILL_PET_VARIANTS.set(`rune:${runeId}`, pet);
  }
  SKILL_PET_VARIANTS.set(`npc:${Npcs.HERBIBOAR}`, PET_BY_NAME.get("HERBI"));
  SKILL_PET_VARIANTS.set(`npc:${Npcs.QUETZIN}`, PET_BY_NAME.get("QUETZIN"));
  SKILL_PET_VARIANTS.set(`npc:${Npcs.CHINCHOMPA}`, PET_BY_NAME.get("GREY_CHINCHOMPA"));
  SKILL_PET_VARIANTS.set(`npc:${Npcs.CARNIVOROUS_CHINCHOMPA}`, PET_BY_NAME.get("RED_CHINCHOMPA"));
  SKILL_PET_VARIANTS.set(`npc:${Npcs.BLACK_CHINCHOMPA}`, PET_BY_NAME.get("BLACK_CHINCHOMPA"));
}

let World;
let RegionManager;
let ItemOnGroundManager;

module.exports = {
  name: "Pets",
  register(api) {
    World = api.getWorld();
    RegionManager = api.getRegionManager();
    ItemOnGroundManager = api.getItemOnGroundManager();
    pluginApi = api;
    fillSkillPetVariants(api.core);
    api.persistAttribute(OWNED_ATTRIBUTE);
    api.persistAttribute(LAST_PET_ATTRIBUTE);
    api.persistAttribute(VARIANT_ATTRIBUTE);

    for (const skill of new Set(SKILLING_PETS.map((pet) => pet.skill))) {
      api.onCustomEvent(`${normalizeSkillName(skill)}:success`, skillPetHandler(skill));
    }
    api.onCustomEvent("npc-drops:roll", awardDroppedPets);
    api.onCustomEvent("npc-dialogue:action", reclaimPets);
    api.onItemDropPolicy(onPetItemDropPolicy);

    const petNpcIds = Array.from(PET_BY_ID.keys());
    for (let clickType = 1; clickType <= 5; clickType++) {
      api.onNpcClick(petNpcIds, clickType, handlePetClick);
    }
    api.onAnyNpcInteraction({ "Pick-up": pickUpAction, Metamorphosis: morphAction, Metamorph: morphAction });

    api.onPlayerLogout(onPetPlayerLogout);
    api.onPlayerDisconnect(onPetPlayerDisconnect);
    api.onPlayerLogin(onPetPlayerLogin);

    api.log("registered", {
      pets: PETS.length,
      skillingPets: SKILLING_PETS.length,
    });
  },

  // Exposed for tests/pets.test.cjs; nothing else reads them.
  __internals: {
    PETS,
    PET_BY_ID,
    PET_BY_ITEM_ID,
    petFamily,
    getStoredVariant,
    applyStoredVariant,
    morph,
    interact,
    pickup,
    handlePetClick,
    awardPet,
    getOwnedPetItems,
  },
};
