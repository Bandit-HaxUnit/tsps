/**
 * Quests. Each quest lives in ./quests/<Name>.Quest.js and registers its own
 * logic, handlers and (for transcript-driven quests) variant/condition answers
 * through `api.core`; add each quest to QUESTS (and F2P_QUESTS if free-to-play).
 *
 * Shield of Arrav is registered last so the shared Varrock NPCs it finishes on
 * (King Roald, Reldo, ...) fall back to it after the other quests' handlers.
 */
const QUESTS = [
  "AscentOfArceuus", "AtFirstLight", "BigChompyBirdHunting", "Biohazard", "BlackKnightsFortress", "ChildrenOfTheSun", "ClientOfKourend", "ClockTower",
  "CooksAssistant", "CorsairCurse", "CreatureOfFenkenstrain", "CurrentAffairs", "DeathPlateau", "DemonSlayer", "DepthsOfDespair", "DesertTreasureI",
  "DigSite", "DoricsQuest", "DragonSlayer", "DruidicRitual", "DwarfCannon", "EadgarsRuse", "EaglesPeak", "ElementalWorkshopI",
  "ElementalWorkshopII", "ErnestTheChicken", "EthicallyAcquiredAntiquities", "EyesOfGlouphrie", "FairytaleIGrowingPains", "FairytaleIICureAQueen", "FamilyCrest", "FightArena",
  "FishingContest", "ForsakenTower", "FremennikTrials", "GardenOfDeath", "GardenOfTranquillity", "GertrudesCat", "GettingAhead", "GhostsAhoy",
  "GoblinDiplomacy", "GrandTree", "HandInTheSand", "HazeelCult", "HeroesQuest", "HolyGrail", "HorrorFromTheDeep", "IcthlarinsLittleHelper",
  "IdesOfMilk", "ImpCatcher", "InAidOfTheMyreque", "InSearchOfTheMyreque", "JunglePotion", "KnightsSword", "LegendsQuest", "LostCity",
  "LostTribe", "MakingHistory", "MerlinsCrystal", "MisthalinMystery", "MonksFriend", "MurderMystery", "MyArmsBigAdventure", "NatureSpirit",
  "ObservatoryQuest", "OlafsQuest", "PathOfGlouphrie", "PiratesTreasure", "PlagueCity", "PorcineOfInterest", "PriestInPeril", "PrinceAliRescue",
  "PryingTimes", "QueenOfThieves", "RagAndBoneManI", "RagAndBoneManII", "RecruitmentDrive", "Regicide", "RestlessGhost", "RomeoAndJuliet",
  "RovingElves", "RumDeal", "RuneMysteries", "ScorpionCatcher", "SeaSlug", "ShadesOfMortton", "ShadowOfTheStorm", "SheepHerder",
  "SheepShearer", "ShiloVillage", "SoulsBane", "SpiritsOfTheElid", "TaiBwoWannaiTrio", "TaleOfTheRighteous", "TearsOfGuthix", "TempleOfIkov",
  "TheGolem", "TouristTrap", "TowerOfLife", "TreeGnomeVillage", "TribalTotem", "TrollRomance", "TrollStronghold", "UndergroundPass",
  "VampyreSlayer", "Wanted", "Watchtower", "WaterfallQuest", "WitchsHouse", "WitchsPotion", "XMarksTheSpot", "ZogreFleshEaters",
  "ShieldOfArrav",
];

// Free-to-play quests (OSRS wiki); the rest stay unloaded on a free-to-play world.
const F2P_QUESTS = new Set([
  "BlackKnightsFortress", "CooksAssistant", "CorsairCurse", "DemonSlayer", "DoricsQuest",
  "DragonSlayer", "ErnestTheChicken", "GoblinDiplomacy", "ImpCatcher", "KnightsSword",
  "MisthalinMystery", "PiratesTreasure", "PrinceAliRescue", "RestlessGhost", "RomeoAndJuliet",
  "RuneMysteries", "SheepShearer", "ShieldOfArrav", "VampyreSlayer", "WitchsPotion",
  "XMarksTheSpot",
]);

function questsForWorld({ WorldDefinition }) {
  return WorldDefinition.isMembersWorld() ? QUESTS : QUESTS.filter((quest) => F2P_QUESTS.has(quest));
}

module.exports = {
  name: "Quests",
  register(api) {
    for (const quest of questsForWorld(api.core)) require(`./quests/${quest}.Quest`)(api);
  },
};
