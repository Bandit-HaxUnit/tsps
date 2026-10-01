"use strict";

const Runtime = require("./hunter/Runtime");
const Traps = require("./hunter/Traps");
const Catching = require("./hunter/Catching");
const Birdhouses = require("./hunter/Birdhouses");
const Tracking = require("./hunter/Tracking");
const Pitfalls = require("./hunter/Pitfalls");
const Aerial = require("./hunter/Aerial");
const MagicBoxes = require("./hunter/MagicBoxes");

module.exports = {
  name: "Hunter",
  register(api) {
    api.onServerStartup(Runtime.start.bind(null, api));
    api.onServerShutdown(Runtime.shutdown);
    api.persistAttribute(Birdhouses.ATTRIBUTE);
    api.onPlayerLogin(Birdhouses.login);
    api.onPlayerLogout(Runtime.cleanup);
    api.onPlayerDisconnect(Runtime.cleanup);
    api.onPlayerDeath(Runtime.cleanup);
    api.onPlayerProcess(Runtime.processPlayer);
    api.onCanEquip(Runtime.equipment);
    api.onCanUnequip(Runtime.equipment);
    api.onNpcRoute(Runtime.npcRoute);
    api.onAnyNpcInteraction({ Catch: Runtime.catchNpc, Tease: Pitfalls.tease, Retrieve: Catching.retrieve });
    api.onNpcInteraction("Matthias", { "Quick-falcon": Catching.hire, Falconry: Catching.hire });
    api.onNpcInteraction("Alry the Angler", { "Get bird": Aerial.borrow });
    api.onItemAction("Bird snare", { Lay: Traps.activate });
    api.onItemAction("Box trap", { Lay: Traps.activate });
    api.onItemAction("Magic box", { Activate: Traps.activate });
    api.onGroundItemSecondClick([api.core.ItemIdentifiers.BIRD_SNARE, api.core.ItemIdentifiers.BOX_TRAP, api.core.ItemIdentifiers.MAGIC_BOX], Traps.groundActivate);
    for (const name of ["Bird snare", "Box trap", "Shaking box", "Magic box", "Magic box failed", "Deadfall", "Boulder", "Net trap", "Young tree", "Collapsed trap"])
      api.onObjectInteraction(name, { Check: Traps.check, Retrieve: Traps.check, Dismantle: Traps.dismantle, Deactivate: Traps.dismantle, Reset: Traps.reset, Investigate: Traps.investigate, "Set-trap": Traps.build, Trap: Traps.build });
    api.onObjectInteraction("Pit", { Trap: Pitfalls.build });
    api.onObjectInteraction("Spiked pit", { Jump: Pitfalls.jump, Dismantle: Traps.dismantle });
    for (const name of ["Burrow", "Bush", "Plant", "Snow drift", "Disturbed sand", "Tunnel", "Hollow log", "Cactus", "Rockslide", "Jungle plant"])
      api.onObjectInteraction(name, { Inspect: Tracking.inspect, Search: Tracking.inspect, Attack: Tracking.catchPrey });
    api.onObjectInteraction("Space", { Build: Birdhouses.build });
    for (const name of ["Birdhouse", "Oak birdhouse", "Willow birdhouse", "Teak birdhouse", "Maple birdhouse", "Mahogany birdhouse", "Yew birdhouse", "Magic birdhouse", "Redwood birdhouse", "Birdhouse (empty)", "Oak birdhouse (empty)", "Willow birdhouse (empty)", "Teak birdhouse (empty)", "Maple birdhouse (empty)", "Mahogany birdhouse (empty)", "Yew birdhouse (empty)", "Magic birdhouse (empty)", "Redwood birdhouse (empty)"])
      api.onObjectInteraction(name, { Interact: Birdhouses.empty, Empty: Birdhouses.empty, Reset: Birdhouses.reset, Seeds: Birdhouses.seeds, Dismantle: Birdhouses.dismantle });
    for (const name of ["Ruby harvest", "Sapphire glacialis", "Snowy knight", "Black warlock"])
      api.onItemAction(name, { Release: Catching.release });
    for (const name of ["Baby impling jar", "Young impling jar", "Gourmet impling jar", "Earth impling jar", "Essence impling jar", "Eclectic impling jar", "Nature impling jar", "Magpie impling jar", "Ninja impling jar", "Dragon impling jar", "Crystal impling jar", "Lucky impling jar"])
      api.onItemAction(name, { Loot: Catching.loot });
    for (const name of ["Ferret", "Swamp lizard", "Orange salamander", "Red salamander", "Black salamander"])
      api.onItemAction(name, { Release: Runtime.release });
    for (const name of ["Imp-in-a-box(2)", "Imp-in-a-box(1)"])
      api.onItemAction(name, { "Bank-all": MagicBoxes.explain, Bank: MagicBoxes.explain, "Talk-to": MagicBoxes.explain, Release: MagicBoxes.release });
    api.onItemOnObject(Runtime.objectUse, { noted: false });
    api.onItemOnItem(Runtime.itemUse, { noted: false });
    api.onItemOnPlayer(Catching.boost, { noted: false });
    api.onItemOnNpc(Aerial.tench, { noted: false });
  },
};
