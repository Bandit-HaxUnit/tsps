"use strict";

const Events = require("./random-events/RandomEvents");
const Lamp = require("./random-events/GenieLamp");

module.exports = {
  name: "RandomEvents",
  register(api) {
    api.registerCommand("randevt", Events.spawnCommand, api.core.PlayerRights.OWNER, "Test a random event ([id] = zero-based event index; omit for random)");
    api.onServerStartup(Events.initialize.bind(null, api));
    api.onServerShutdown(Events.shutdown);
    api.onPlayerLogin(Events.login);
    api.onPlayerProcess(Events.processPlayer);
    api.onPlayerLogout(Events.logoutCleanup);
    api.onPlayerDisconnect(Events.logoutCleanup);
    api.onPlayerDeath(Events.cleanup);
    api.onPlayerLogout(Lamp.cleanup);
    api.onPlayerDisconnect(Lamp.cleanup);
    api.onPlayerDeath(Lamp.cleanup);
    api.onNpcInteraction("Genie", { "Talk-to": Events.talk, Dismiss: Events.dismiss });
    api.onNpcInteraction("Sandwich lady", { "Talk-to": Events.talk, Dismiss: Events.dismiss });
    api.onNpcInteraction("Drunken Dwarf", { "Talk-to": Events.talk, Dismiss: Events.dismiss });
    api.onNpcInteraction("Rick Turpentine", { "Talk-to": Events.talk, Dismiss: Events.dismiss });
    api.onNpcInteraction("Mysterious Old Man", { "Talk-to": Events.talk, Dismiss: Events.dismiss });
    api.onNpcInteraction("Niles", { "Talk-to": Events.talk, Dismiss: Events.dismiss });
    api.onNpcInteraction("Miles", { "Talk-to": Events.talk, Dismiss: Events.dismiss });
    api.onNpcInteraction("Giles", { "Talk-to": Events.talk, Dismiss: Events.dismiss });
    api.onNpcInteraction("Count Check", { "Talk-to": Events.talk, Dismiss: Events.dismiss });
    api.onNpcInteraction("Capt' Arnav", { "Talk-to": Events.talk, Dismiss: Events.dismiss });
    api.onNpcInteraction("Bee keeper", { "Talk-to": Events.talk, Dismiss: Events.dismiss });
    api.onNpcInteraction("Quiz Master", { "Talk-to": Events.talk, Dismiss: Events.dismiss });
    api.onNpcInteraction("Sergeant Damien", { "Talk-to": Events.talk, Dismiss: Events.dismiss });
    api.onNpcInteraction("Freaky Forester", { "Talk-to": Events.talk, Dismiss: Events.dismiss });
    api.onNpcInteraction("Leo", { "Talk-to": Events.talk, Dismiss: Events.dismiss });
    api.onNpcInteraction("Flippa", { "Talk-to": Events.talk, Dismiss: Events.dismiss });
    api.onNpcInteraction("Evil Bob", { "Talk-to": Events.talk, Dismiss: Events.dismiss });
    api.onNpcInteraction("Postie Pete", { "Talk-to": Events.talk, Dismiss: Events.dismiss });
    api.onNpcInteraction("Pillory Guard", { "Talk-to": Events.talk, Dismiss: Events.dismiss });
    api.onNpcInteraction("Dunce", { "Talk-to": Events.talk, Dismiss: Events.dismiss });
    api.onInterfaceActionClick(Events.chooseSandwich);
    api.onInterfaceActionClick(Events.chooseCerter);
    api.onItemAction("Lamp", { Rub: Lamp.rub.bind(null, api) });
    api.onItemAction("Book of Knowledge", { Read: Lamp.read.bind(null, api) });
    require("./random-events/CountCheck")(api, Events);
    require("./random-events/KissTheFrog")(api, Events);
    require("./random-events/CaptArnav")(api, Events);
    require("./random-events/Beekeeper")(api, Events);
    require("./random-events/QuizMaster")(api, Events);
    require("./random-events/DrillDemon")(api, Events);
    require("./random-events/FreakyForester")(api, Events);
    require("./random-events/Gravedigger")(api, Events);
    require("./random-events/Pinball")(api, Events);
    require("./random-events/EvilBob")(api, Events);
    require("./random-events/EvilTwin")(api, Events);
    require("./random-events/Maze")(api, Events);
    require("./random-events/Mime")(api, Events);
    require("./random-events/Pillory")(api, Events);
    require("./random-events/SurpriseExam")(api, Events);
  },
};
