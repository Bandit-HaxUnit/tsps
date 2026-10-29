/**
 * The crystal extractor (rsprox, rev 235: recordings 940, 948, 978, 1024, 4292-4307; the Wiki;
 * docs/sailing.md). Built in the shipyard like any facility (73 Sailing, 67 Construction); at sea:
 * - Activate (op1): the player's sequence 13176 on the click; the next tick "The crystal extractor
 *   is now enabled.", the loc switched on (59703 -> 59702), sound 10899, and an invisible NPC on
 *   it (crystal_extractor_headbar) showing the charge on headbar 82. Within a dock's reach: "The
 *   crystal extractor doesn't seem to respond in this area." and nothing else.
 * - Charging, while the owner is aboard: every 5 ticks headbar 82 is sent again, its fill 0, 2,
 *   ... 38; on the 21st, 105 ticks after the last harvest, "Your crystal extractor has harvested a
 *   crystal mote!" (colour 00e6e6), the NPC goes and the loc plays 13177. Live is 100 ticks in
 *   about a third of cycles; here it is always 105.
 * - Harvest (op1 switched on): with no mote, "There are no motes in the crystal extractor." on
 *   arrival. With one, sequence 13178, then 3 ticks later (another click first cancels it) 250
 *   Sailing XP, sound 1298, the loc's 13175 and the NPC back at fill 0; a 1/6 chance of a crystal
 *   shard after Song of the Elves; and a wind mote for a switched-on wind or gale catcher with
 *   room (WindCatcher.Helm.js storeFromExtractor). Worked from the helm, it keeps the helmsman.
 * - The switch and the charge are kept with the boat. A Barracuda Trial's start empties it.
 * Ours: Deactivate (op2) was never captured: its message and the activate sequence mirror the
 * wind catcher's, and the charge is kept. Two shards in crystal-flecked waters, the bank boat's
 * area and the charge kept for a while after disembarking (Wiki) are left out.
 */
const { Sailing } = require("../../../src/main/typescript/elvarg/game/content/sailing/Sailing");
const { BoatManager } = require("../../../src/main/typescript/elvarg/game/content/sailing/BoatManager");
const { Animation } = require("../../../src/main/typescript/elvarg/game/model/Animation");
const { Skill } = require("../../../src/main/typescript/elvarg/game/model/Skill");
const { Task } = require("../../../src/main/typescript/elvarg/game/task/Task");
const { TaskManager } = require("../../../src/main/typescript/elvarg/game/task/TaskManager");
const { ItemIdentifiers } = require("../../../src/main/typescript/elvarg/util/ItemIdentifiers");
const { playSound, animateDeckLoc, dockNearTile } = require("./SailingContent.Sailing");
const { EXTRACTOR_SWITCHED_ON } = require("./BoatFacilities.Sailing");

const LOC_OFF = Number(Object.keys(EXTRACTOR_SWITCHED_ON)[0]);
const LOC_ON = EXTRACTOR_SWITCHED_ON[LOC_OFF];
const HEADBAR_NPC = 15111;
const HEADBAR = 82;
/** The charge goes up a step every 5 ticks; the 21st holds a mote. Fill 2 a step, after the first. */
const STEP_TICKS = 5;
const FULL = 21;
const FILL_PER_STEP = 2;
const HARVEST_TICKS = 3;
const HARVEST_XP = 250;
const SHARD_CHANCE = 1 / 6;
/** How near a dock the extractor stops responding (as near as the other dock checks reach). */
const DOCK_RANGE = 16;
const SEQ_ACTIVATE = 13176;
const SEQ_HARVEST = 13178;
const LOC_ANIM_ACTIVE = 13175;
const LOC_ANIM_EXTRACTED = 13177;
const SOUND_ENABLE = 10899;
const SOUND_HARVEST = 1298;

const ENABLED = "The crystal extractor is now enabled.";
const DISABLED = "The crystal extractor is now disabled.";
const NO_MOTES = "There are no motes in the crystal extractor.";
const NO_RESPONSE = "The crystal extractor doesn't seem to respond in this area.";
const EXTRACTED = "<col=00e6e6>Your crystal extractor has harvested a crystal mote!";

let pluginApi;

function isExtractorLoc(id) {
  return id === LOC_OFF || id === LOC_ON;
}

/** The player's own boat they're aboard, with its saved state, or undefined. */
function ownBoat(player) {
  const boat = Sailing.instanceAboard(player);
  const owned = boat && Sailing.activeBoat(player);
  return boat && owned ? { boat, owned } : undefined;
}

/** The extractor's deck loc on the boat, or undefined without one. */
function extractorOf(boat) {
  return (BoatManager.getSpec(boat)?.locs ?? []).find((loc) => isExtractorLoc(loc.id));
}

function nearDock(boat) {
  return dockNearTile({ x: boat.tileX, y: boat.tileY, z: boat.level }, DOCK_RANGE) !== undefined;
}

function chargeOf(owned) {
  return owned.crystalExtractorCharge ?? 0;
}

function fillOf(owned) {
  return Math.max(0, chargeOf(owned) - 1) * FILL_PER_STEP;
}

/** Runs `action` in `ticks`; keyed to the player, so their next click cancels it, unless `key` is given. */
function later(player, ticks, action, key = player) {
  TaskManager.submit(new (class extends Task {
    constructor() { super(ticks, key, false); }
    execute() {
      this.stop();
      action();
    }
  })());
}

/** The invisible NPC on the extractor that shows its charge, while it's charging. */
function showHeadbar(player, boat, owned) {
  const loc = extractorOf(boat);
  if (!loc) return;
  let npc = boat.crystalExtractorNpc;
  if (!npc) {
    npc = pluginApi.spawnNpc({
      id: HEADBAR_NPC,
      x: boat.deckBaseX + loc.x,
      y: boat.deckBaseY + loc.y,
      z: player.getLocation().getZ(),
      owner: player,
    });
    if (!npc) return;
    BoatManager.getDeck(boat)?.enter(npc);
    boat.crystalExtractorNpc = npc;
  }
  npc.showHeadbar(HEADBAR, { fill: fillOf(owned) });
}

function removeHeadbar(boat) {
  if (!boat.crystalExtractorNpc) return;
  pluginApi.removeNpc(boat.crystalExtractorNpc);
  boat.crystalExtractorNpc = undefined;
}

/** A step of charge every 5 ticks for as long as the owner is aboard and it's switched on. */
function charge(player, boat) {
  if (boat.crystalExtractorCharging) return;
  boat.crystalExtractorCharging = true;
  TaskManager.submit(new (class extends Task {
    constructor() { super(STEP_TICKS, boat, false); }
    execute() {
      const aboard = ownBoat(player);
      if (aboard?.boat !== boat || !aboard.owned.crystalExtractorOn || !extractorOf(boat)) {
        boat.crystalExtractorCharging = false;
        this.stop();
        return;
      }
      const { owned } = aboard;
      if (chargeOf(owned) >= FULL) return;
      owned.crystalExtractorCharge = chargeOf(owned) + 1;
      if (chargeOf(owned) < FULL) {
        showHeadbar(player, boat, owned);
        return;
      }
      player.sendMessage(EXTRACTED);
      removeHeadbar(boat);
      animateDeckLoc(player, boat, extractorOf(boat), LOC_ANIM_EXTRACTED);
    }
  })());
}

/** The charge as it stands: the headbar while charging, the extracted loc animation when full. */
function showCharge(player, boat, owned) {
  if (chargeOf(owned) >= FULL) {
    removeHeadbar(boat);
    animateDeckLoc(player, boat, extractorOf(boat), LOC_ANIM_EXTRACTED);
  } else {
    showHeadbar(player, boat, owned);
  }
  charge(player, boat);
}

function setEnabled(player, on) {
  const aboard = ownBoat(player);
  if (!aboard || !extractorOf(aboard.boat) || aboard.owned.crystalExtractorOn === on) return;
  if (on && nearDock(aboard.boat)) {
    player.sendMessage(NO_RESPONSE);
    return;
  }
  player.performAnimation(new Animation(SEQ_ACTIVATE));
  later(player, 1, () => {
    const { boat, owned } = aboard;
    const loc = extractorOf(boat);
    if (ownBoat(player)?.boat !== boat || !loc) return;
    owned.crystalExtractorOn = on;
    player.sendMessage(on ? ENABLED : DISABLED);
    BoatManager.setDeckLoc(boat, { ...loc, id: on ? LOC_ON : LOC_OFF });
    if (on) {
      playSound(player, SOUND_ENABLE);
      showCharge(player, boat, owned);
    } else {
      removeHeadbar(boat);
    }
  });
}

function activate({ player }) {
  setEnabled(player, true);
}

function deactivate({ player }) {
  setEnabled(player, false);
}

function songOfTheElvesComplete(player) {
  const request = { player, key: "song_of_the_elves" };
  pluginApi.emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

/** Takes the mote: XP, the charge started over, maybe a shard, and a wind mote for the catcher. */
function collect(player, boat, owned) {
  owned.crystalExtractorCharge = 0;
  player.getSkillManager().addExperiences(Skill.SAILING, HARVEST_XP);
  playSound(player, SOUND_HARVEST);
  animateDeckLoc(player, boat, extractorOf(boat), LOC_ANIM_ACTIVE);
  showCharge(player, boat, owned);
  if (songOfTheElvesComplete(player) && Math.random() < SHARD_CHANCE && player.getInventory().getFreeSlots() > 0) {
    player.getInventory().adds(ItemIdentifiers.CRYSTAL_SHARD, 1);
  }
  require("./WindCatcher.Helm").storeFromExtractor(player);
}

function harvest({ player }) {
  const aboard = ownBoat(player);
  if (!aboard || !extractorOf(aboard.boat) || !aboard.owned.crystalExtractorOn) return;
  if (nearDock(aboard.boat)) {
    player.sendMessage(NO_RESPONSE);
    return;
  }
  if (chargeOf(aboard.owned) < FULL) {
    player.sendMessage(NO_MOTES);
    return;
  }
  player.performAnimation(new Animation(SEQ_HARVEST));
  later(player, HARVEST_TICKS, () => {
    const { boat, owned } = aboard;
    if (ownBoat(player)?.boat !== boat || !extractorOf(boat) || chargeOf(owned) < FULL) return;
    collect(player, boat, owned);
  });
}

/** A Barracuda Trial's start or reset: the charge starts over (Wiki, 26 November 2025). */
function reset(player) {
  const aboard = ownBoat(player);
  if (!aboard || !aboard.owned.crystalExtractorOn) return;
  aboard.owned.crystalExtractorCharge = 0;
  showCharge(player, aboard.boat, aboard.owned);
}

/** Aboard with it switched on: its charge shows and goes on, once the deck is in place. */
function onBoarded({ player, boat, owned }) {
  if (!owned?.crystalExtractorOn) return;
  later(player, 1, () => {
    if (ownBoat(player)?.boat !== boat || !extractorOf(boat)) return;
    showCharge(player, boat, owned);
  }, boat);
}

function onLeft({ boat }) {
  removeHeadbar(boat);
}

module.exports = {
  name: "SailingCrystalExtractor",
  members: true,
  isExtractorLoc,
  reset,
  register(api) {
    pluginApi = api;
    api.onObjectInteraction("Crystal extractor", {
      Activate: activate,
      Deactivate: deactivate,
      Harvest: harvest,
    });
    api.onCustomEvent("sailing:boarded", onBoarded);
    api.onCustomEvent("sailing:left", onLeft);
  },
};
