"use strict";

// OSRS requirements/rewards; the identifiers describe this server's rev237 cache.
// https://oldschool.runescape.wiki/w/Hunter
function build(core) {
  const { ItemIdentifiers: I, NpcIdentifiers: N, ObjectIdentifiers: O } = core;
  const traps = {
    bird: { level: 1, item: I.BIRD_SNARE, idle: O.BIRD_SNARE_2, fail: O.BIRD_SNARE, animation: 5208 },
    box: { level: 27, item: I.BOX_TRAP, idle: O.BOX_TRAP_5, fail: O.BOX_TRAP_7, animation: 5208 },
    magic: { level: 71, item: I.MAGIC_BOX, idle: O.MAGIC_BOX, fail: O.MAGIC_BOX_FAILED, animation: 5212 },
    deadfall: { level: 23, idle: O.DEADFALL, fail: O.BOULDER_14, animation: 5212, knife: true, logs: true, max: 1 },
    pit: { level: 31, idle: O.SPIKED_PIT, fail: O.COLLAPSED_TRAP, animation: 5228, knife: true, logs: true },
    orange: { level: 47, tree: O.YOUNG_TREE_2, idleTree: O.YOUNG_TREE, idle: O.NET_TRAP, fail: O.NET_TRAP_4, bait: I.MARRENTILL_TAR, animation: 5215 },
    red: { level: 59, tree: O.YOUNG_TREE_5, idleTree: O.YOUNG_TREE_4, idle: O.NET_TRAP_10, fail: O.NET_TRAP_9, bait: I.TARROMIN_TAR, animation: 5215 },
    black: { level: 67, tree: O.YOUNG_TREE_11, idleTree: O.YOUNG_TREE_10, idle: O.NET_TRAP_20, fail: O.NET_TRAP_14, bait: I.HARRALANDER_TAR, animation: 5215 },
    swamp: { level: 29, tree: O.YOUNG_TREE_8, idleTree: O.YOUNG_TREE_7, idle: O.NET_TRAP_15, fail: O.NET_TRAP_19, bait: I.GUAM_TAR, animation: 5215 },
  };
  const creatures = [
    // npc, trap, level, xp, caught loc, base chance / never-fail level, rewards
    [N.CRIMSON_SWIFT, "bird", 1, 34, O.BIRD_SNARE_7, 100, 32, [[I.BONES, 1], [I.RAW_BIRD_MEAT, 1], [I.RED_FEATHER, 5, 10]]],
    [N.GOLDEN_WARBLER, "bird", 5, 47, O.BIRD_SNARE_11, 100, 37, [[I.BONES, 1], [I.RAW_BIRD_MEAT, 1], [I.YELLOW_FEATHER, 5, 10]]],
    [N.COPPER_LONGTAIL, "bird", 9, 61, O.BIRD_SNARE_13, 100, 41, [[I.BONES, 1], [I.RAW_BIRD_MEAT, 1], [I.ORANGE_FEATHER, 5, 10]]],
    [N.CERULEAN_TWITCH, "bird", 11, 64.5, O.BIRD_SNARE_9, 100, 43, [[I.BONES, 1], [I.RAW_BIRD_MEAT, 1], [I.BLUE_FEATHER, 5, 10]]],
    [N.TROPICAL_WAGTAIL, "bird", 19, 95.2, O.BIRD_SNARE_5, 100, 51, [[I.BONES, 1], [I.RAW_BIRD_MEAT, 1], [I.STRIPY_FEATHER, 5, 10]]],
    [N.FERRET, "box", 27, 115, O.SHAKING_BOX_4, 145, 72, [[I.FERRET, 1]]],
    [N.CHINCHOMPA, "box", 53, 198.25, O.SHAKING_BOX_2, 145, 94, [[I.CHINCHOMPA_2, 1]]],
    [N.CARNIVOROUS_CHINCHOMPA, "box", 63, 265, O.SHAKING_BOX_3, 115, 107, [[I.RED_CHINCHOMPA_2, 1]]],
    [N.BLACK_CHINCHOMPA, "box", 73, 315, O.SHAKING_BOX, 115, 107, [[I.BLACK_CHINCHOMPA, 1]]],
    [N.WILD_KEBBIT, "deadfall", 23, 128, O.BOULDER_19, 115, 60, [[I.BONES, 1], [I.KEBBIT_CLAWS, 1]]],
    [N.BARB_TAILED_KEBBIT, "deadfall", 33, 168, O.BOULDER_18, 115, 70, [[I.BONES, 1], [I.BARB_TAIL_HARPOON, 1]]],
    [N.PRICKLY_KEBBIT, "deadfall", 37, 204, O.BOULDER_16, 115, 75, [[I.BONES, 1], [I.KEBBIT_SPIKE, 1]]],
    [N.SABRE_TOOTHED_KEBBIT, "deadfall", 51, 200, O.BOULDER_17, 115, 90, [[I.BONES, 1], [I.KEBBIT_TEETH, 1]]],
    [N.SWAMP_LIZARD, "swamp", 29, 152, O.NET_TRAP_17, 115, 74, [[I.SWAMP_LIZARD, 1]]],
    [N.ORANGE_SALAMANDER, "orange", 47, 224, O.NET_TRAP_2, 115, 88, [[I.ORANGE_SALAMANDER, 1]]],
    [N.RED_SALAMANDER, "red", 59, 272, O.NET_TRAP_7, 115, 91, [[I.RED_SALAMANDER, 1]]],
    [N.BLACK_SALAMANDER, "black", 67, 319.5, O.NET_TRAP_12, 115, 107, [[I.BLACK_SALAMANDER, 1]]],
    [N.SPINED_LARUPIA, "pit", 31, 180, O.COLLAPSED_TRAP_4, 145, 68, [[I.BIG_BONES, 1], [I.LARUPIA_FUR, 1]]],
    [N.HORNED_GRAAHK, "pit", 41, 240, O.COLLAPSED_TRAP_3, 145, 80, [[I.BIG_BONES, 1], [I.GRAAHK_FUR, 1]]],
    [N.SABRE_TOOTHED_KYATT, "pit", 55, 300, O.COLLAPSED_TRAP_5, 145, 97, [[I.BIG_BONES, 1], [I.KYATT_FUR, 1]]],
    [N.IMP, "magic", 71, 450, O.MAGIC_BOX_3, 115, 110, [[I.IMP_IN_A_BOX_2_, 1]]],
  ].map(([npc, trap, level, xp, caught, base, never, loot]) => ({ npc, trap, level, xp, caught, base, never, loot }));
  const butterflies = [
    [N.RUBY_HARVEST, I.RUBY_HARVEST, 15, 24, 25, 44, core.Skill.ATTACK],
    [N.SAPPHIRE_GLACIALIS, I.SAPPHIRE_GLACIALIS, 25, 34, 35, 54, core.Skill.DEFENCE],
    [N.SNOWY_KNIGHT, I.SNOWY_KNIGHT, 35, 44, 45, 64, core.Skill.HITPOINTS],
    [N.BLACK_WARLOCK, I.BLACK_WARLOCK, 45, 54, 55, 74, core.Skill.STRENGTH],
  ].map(([npc, jar, level, xp, hands, handsXp, boost]) => ({ npc, jar, level, xp, hands, handsXp, boost }));
  const implings = [
    ["BABY", 17, 27, 20, 18], ["YOUNG", 22, 32, 22, 20],
    ["GOURMET", 28, 38, 24, 22], ["EARTH", 36, 46, 27, 25],
    ["ESSENCE", 42, 52, 29, 27], ["ECLECTIC", 50, 60, 34, 32],
    ["NATURE", 58, 68, 36, 34], ["MAGPIE", 65, 75, 216, 44],
    ["NINJA", 74, 84, 240, 52], ["DRAGON", 83, 93, 300, 65],
    ["CRYSTAL", 80, 90, 280, 280], ["LUCKY", 89, 99, 380, 80],
  ].map(([key, level, hands, xp, puroXp]) => ({ key, level, hands, xp, puroXp, jar: I[`${key}_IMPLING_JAR`],
    npcs: Object.entries(N).filter(([name]) => new RegExp(`^${key}_IMPLING(?:_\\d+)?$`).test(name)).map(([, id]) => id) }));
  const falconry = [
    [N.SPOTTED_KEBBIT, 43, 104, I.SPOTTED_KEBBIT_FUR, N.GYR_FALCON],
    [N.DARK_KEBBIT, 57, 132, I.DARK_KEBBIT_FUR, N.GYR_FALCON_2],
    [N.DASHING_KEBBIT, 69, 156, I.DASHING_KEBBIT_FUR, N.GYR_FALCON_3],
  ].map(([npc, level, xp, fur, falcon]) => ({ npc, level, xp, fur, falcon }));
  const birdhouses = [
    [I.BIRD_HOUSE, I.LOGS, 5, 5, 15, 280], [I.OAK_BIRD_HOUSE, I.OAK_LOGS, 15, 14, 20, 420],
    [I.WILLOW_BIRD_HOUSE, I.WILLOW_LOGS, 25, 24, 25, 560], [I.TEAK_BIRD_HOUSE, I.TEAK_LOGS, 35, 34, 30, 700],
    [I.MAPLE_BIRD_HOUSE, I.MAPLE_LOGS, 45, 44, 35, 820], [I.MAHOGANY_BIRD_HOUSE, I.MAHOGANY_LOGS, 50, 49, 40, 960],
    [I.YEW_BIRD_HOUSE, I.YEW_LOGS, 60, 59, 45, 1020], [I.MAGIC_BIRD_HOUSE, I.MAGIC_LOGS, 75, 74, 50, 1140],
    [I.REDWOOD_BIRD_HOUSE, I.REDWOOD_LOGS, 90, 89, 55, 1200],
  ].map(([item, logs, crafting, level, craftXp, xp], index) => ({ item, logs, crafting, level, craftXp, xp, index }));
  const aerialFish = [
    [I.BLUEGILL, 35, 43, 16.5, 11.5, 3.5], [I.COMMON_TENCH, 51, 56, 45, 40, 10],
    [I.MOTTLED_EEL, 68, 73, 90, 65, 20], [I.GREATER_SIREN, 87, 91, 130, 100, 25],
  ].map(([item, hunter, fishing, hunterXp, fishingXp, cookingXp]) => ({ item, hunter, fishing, hunterXp, fishingXp, cookingXp }));
  const data = { traps, creatures, butterflies, implings, falconry, birdhouses, aerialFish };
  // Fail on a stale enum at startup instead of creating invalid items/objects in-game.
  for (const value of [...creatures.map(c => [c.npc, c.caught, ...c.loot.map(l => l[0])]),
    ...butterflies.map(c => [c.npc, c.jar]), ...implings.map(c => [c.jar, ...c.npcs]),
    ...falconry.map(c => [c.npc, c.fur, c.falcon]), ...birdhouses.map(c => [c.item, c.logs]), ...aerialFish.map(c => [c.item])].flat()) {
    if (!Number.isInteger(value)) throw new Error("Hunter data references an unavailable cache identifier");
  }
  return data;
}

module.exports = { build };
