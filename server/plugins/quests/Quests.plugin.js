/**
 * Quests. Each quest lives in ./quests/<Name>.Quest.js and registers its own
 * logic, handlers and (for transcript-driven quests) variant/condition answers
 * through `api.core`; add one line per quest.
 *
 * Shield of Arrav is registered last so the shared Varrock NPCs it finishes on
 * (King Roald, Reldo, ...) fall back to it after the other quests' handlers.
 */
module.exports = {
  name: "Quests",
  register(api) {
    require("./quests/BigChompyBirdHunting.Quest")(api);
    require("./quests/Biohazard.Quest")(api);
    require("./quests/BlackKnightsFortress.Quest")(api);
    require("./quests/CooksAssistant.Quest")(api);
    require("./quests/DeathPlateau.Quest")(api);
    require("./quests/DemonSlayer.Quest")(api);
    require("./quests/DesertTreasureI.Quest")(api);
    require("./quests/DigSite.Quest")(api);
    require("./quests/DoricsQuest.Quest")(api);
    require("./quests/DragonSlayer.Quest")(api);
    require("./quests/DruidicRitual.Quest")(api);
    require("./quests/DwarfCannon.Quest")(api);
    require("./quests/ElementalWorkshopI.Quest")(api);
    require("./quests/ErnestTheChicken.Quest")(api);
    require("./quests/FamilyCrest.Quest")(api);
    require("./quests/FishingContest.Quest")(api);
    require("./quests/GertrudesCat.Quest")(api);
    require("./quests/GoblinDiplomacy.Quest")(api);
    require("./quests/GrandTree.Quest")(api);
    require("./quests/HazeelCult.Quest")(api);
    require("./quests/HeroesQuest.Quest")(api);
    require("./quests/HolyGrail.Quest")(api);
    require("./quests/ImpCatcher.Quest")(api);
    require("./quests/JunglePotion.Quest")(api);
    require("./quests/KnightsSword.Quest")(api);
    require("./quests/LostCity.Quest")(api);
    require("./quests/MerlinsCrystal.Quest")(api);
    require("./quests/MonksFriend.Quest")(api);
    require("./quests/MurderMystery.Quest")(api);
    require("./quests/NatureSpirit.Quest")(api);
    require("./quests/ObservatoryQuest.Quest")(api);
    require("./quests/PiratesTreasure.Quest")(api);
    require("./quests/PlagueCity.Quest")(api);
    require("./quests/PriestInPeril.Quest")(api);
    require("./quests/PrinceAliRescue.Quest")(api);
    require("./quests/RestlessGhost.Quest")(api);
    require("./quests/RomeoAndJuliet.Quest")(api);
    require("./quests/RuneMysteries.Quest")(api);
    require("./quests/ScorpionCatcher.Quest")(api);
    require("./quests/SeaSlug.Quest")(api);
    require("./quests/SheepHerder.Quest")(api);
    require("./quests/SheepShearer.Quest")(api);
    require("./quests/TempleOfIkov.Quest")(api);
    require("./quests/TouristTrap.Quest")(api);
    require("./quests/TreeGnomeVillage.Quest")(api);
    require("./quests/TribalTotem.Quest")(api);
    require("./quests/TrollStronghold.Quest")(api);
    require("./quests/VampyreSlayer.Quest")(api);
    require("./quests/WaterfallQuest.Quest")(api);
    require("./quests/WitchsHouse.Quest")(api);
    require("./quests/WitchsPotion.Quest")(api);
    require("./quests/ShieldOfArrav.Quest")(api);
  },
};
