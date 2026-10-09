/**
 * Quests. Each quest lives in ./quests/<Name>.Quest.js and registers its own
 * logic, handlers and (for transcript-driven quests) variant/condition answers
 * through `api.core`; add each quest to QUESTS (and F2P_QUESTS if free-to-play).
 *
 * Shield of Arrav is registered last so the shared Varrock NPCs it finishes on
 * (King Roald, Reldo, ...) fall back to it after the other quests' handlers.
 */
const QUESTS = [
  "AnimalMagnetism", "AscentOfArceuus", "AtFirstLight", "BigChompyBirdHunting", "Biohazard", "BlackKnightsFortress", "ChildrenOfTheSun", "ClientOfKourend",
  "ClockTower", "ColdWar", "Contact", "CooksAssistant", "CorsairCurse", "CreatureOfFenkenstrain", "CurrentAffairs", "DeathPlateau",
  "DemonSlayer", "DepthsOfDespair", "DesertTreasureI", "DeviousMinds", "DigSite", "DoricsQuest", "DragonSlayer", "DruidicRitual",
  "DwarfCannon", "EadgarsRuse", "EaglesPeak", "ElementalWorkshopI", "ElementalWorkshopII", "EnlightenedJourney", "ErnestTheChicken", "EthicallyAcquiredAntiquities",
  "EyesOfGlouphrie", "FairytaleIGrowingPains", "FairytaleIICureAQueen", "FallenFromGrace", "FamilyCrest", "FightArena", "FishingContest", "ForsakenTower",
  "FremennikTrials", "GardenOfDeath", "GardenOfTranquillity", "GertrudesCat", "GettingAhead", "GhostsAhoy", "GoblinDiplomacy", "GrandTree",
  "HandInTheSand", "HauntedMine", "HazeelCult", "HeroesQuest", "HolyGrail", "HorrorFromTheDeep", "IcthlarinsLittleHelper", "IdesOfMilk",
  "ImpCatcher", "InAidOfTheMyreque", "InSearchOfTheMyreque", "JunglePotion", "KnightsSword", "LegendsQuest", "LostCity", "LostTribe",
  "MakingHistory", "MeatAndGreet", "MerlinsCrystal", "MisthalinMystery", "MonksFriend", "MountainDaughter", "MurderMystery", "MyArmsBigAdventure",
  "NatureSpirit", "ObservatoryQuest", "OlafsQuest", "PathOfGlouphrie", "PiratesTreasure", "PlagueCity", "PorcineOfInterest", "PriestInPeril",
  "PrinceAliRescue", "PryingTimes", "QueenOfThieves", "RagAndBoneManI", "RagAndBoneManII", "RecruitmentDrive", "RedReef", "Regicide",
  "RestlessGhost", "RibbitingTale", "RomeoAndJuliet", "RovingElves", "RumDeal", "RuneMysteries", "ScorpionCatcher", "Scrambled",
  "SeaSlug", "ShadesOfMortton", "ShadowOfTheStorm", "ShadowsOfCustodia", "SheepHerder", "SheepShearer", "ShiloVillage", "SleepingGiants",
  "SlugMenace", "SoulsBane", "SpiritsOfTheElid", "TaiBwoWannaiTrio", "TailOfTwoCats", "TaleOfTheRighteous", "TearsOfGuthix", "TempleOfIkov",
  "TheGolem", "ThroneOfMiscellania", "TouristTrap", "TowerOfLife", "TreeGnomeVillage", "TribalTotem", "TrollRomance", "TrollStronghold",
  "TroubledTortugans", "TwilightPromise", "UndergroundPass", "VampyreSlayer", "Wanted", "Watchtower", "WaterfallQuest", "WhatLiesBelow",
  "WitchsHouse", "WitchsPotion", "XMarksTheSpot", "ZogreFleshEaters", "ShieldOfArrav",
];

// Free-to-play quests (OSRS wiki); the rest stay unloaded on a free-to-play world.
const F2P_QUESTS = new Set([
  "BlackKnightsFortress", "CooksAssistant", "CorsairCurse", "DemonSlayer", "DoricsQuest",
  "DragonSlayer", "ErnestTheChicken", "GoblinDiplomacy", "ImpCatcher", "KnightsSword",
  "MisthalinMystery", "IdesOfMilk", "PiratesTreasure", "PrinceAliRescue", "RestlessGhost", "RomeoAndJuliet",
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
