/**
 * Kylie Minnow's fishing platform at the Fishing Guild (OSRS Wiki: Fishing Guild, Kylie Minnow and
 * her transcript). She lets a player onto it for good once they talk to her with 82 Fishing (not
 * boostable), Fishing Contest complete and the full angler's outfit worn. The row boat on the
 * guild's north dock then takes them out; the boat on the platform brings them back.
 *
 * Access is varbit 5669, which Kylie's spawn (7735) transforms on: 0-1 show her as 7727
 * (Talk-to), 2 as 7728 (Talk-to, Trade). 1 marks that the player has heard her introduction.
 */
const QuestRuntime = require("../../quests/QuestRuntime");
const AnglerOutfit = require("./AnglerOutfit.Fishing");

const ACCESS_VARBIT = 5669;
const SPOKEN = 1;
const ACCESS = 2;
const ACCESS_ATTRIBUTE = "fishing:minnow-platform";
const PLATFORM_LEVEL = 82;
const PAGE = "Kylie Minnow";
const FIRST_TALK = "standard-dialogue-first-time-talking-to-kylie-minnow-without-the-requirements";
const ASK_AGAIN = "So, how about letting me out onto your fishing platform?";
const AFTER_ACCESS = "after-gaining-access-talking-to-kylie";
const BOAT_WITHOUT_LEVEL = "standard-dialogue-attempting-to-board-the-boat-without-82-fishing";
const BOAT_WITHOUT_ACCESS = "standard-dialogue-attempting-to-board-the-boat-before-speaking-to-kylie";
const MINNOWS_PER_SHARK = 40;

// The guild boat (30376) is the 3x3 at 2599,3426 with the dock below it; the platform boat (30377)
// is the 3x3 at 2613,3437 with the platform above it. Both landing tiles are walkable in the cache.
const PLATFORM_LANDING = Object.freeze([2614, 3440, 0]);
const DOCK_LANDING = Object.freeze([2600, 3425, 0]);

let api = null;
let core = null;
let kylieIds = new Set();

function accessState(player) {
  return Number(player.getAttribute(ACCESS_ATTRIBUTE)) || 0;
}

function setAccessState(player, value) {
  player.setAttribute(ACCESS_ATTRIBUTE, value);
  player.getPacketSender().sendVarbit(ACCESS_VARBIT, value);
}

function hasAccess(player) {
  return accessState(player) >= ACCESS;
}

function hasPlatformLevel(player) {
  return player.getSkillManager().getMaxLevel(core.Skill.FISHING) >= PLATFORM_LEVEL;
}

function completedFishingContest(player) {
  const quest = QuestRuntime.getRegisteredQuests().find((registered) => registered.name === "Fishing Contest");
  return !quest || quest.isComplete(player);
}

function meetsRequirements(player) {
  return hasPlatformLevel(player) && completedFishingContest(player) && AnglerOutfit.wearsFullOutfit(player);
}

/** Plays Kylie's lines from her transcript page (data/definitions/npc-dialogues.json). */
function sayAsKylie(player, npcId, steps) {
  const record = QuestRuntime.loadTranscripts(api)?.[PAGE];
  if (!Array.isArray(steps) || !record) return false;
  const { startDialogue } = require("../../npcs/NpcDialogues.plugin.js");
  const definition = core.NpcDefinition.forId(npcId);
  const context = { player, npc: null, npcId, definition, pages: [{ page: PAGE, variants: [] }] };
  startDialogue(api, { player, npcId, npc: null, definition }, steps, record.branches, context);
  return true;
}

function variant(name) {
  return QuestRuntime.loadTranscripts(api)?.[PAGE]?.variants?.[name];
}

function talkToKylie({ player }) {
  const { NpcIdentifiers: N } = core;
  if (hasAccess(player)) {
    return sayAsKylie(player, N.KYLIE_MINNOW_2, variant(AFTER_ACCESS));
  }
  const intro = variant(FIRST_TALK);
  if (accessState(player) < SPOKEN) {
    setAccessState(player, SPOKEN);
    return sayAsKylie(player, N.KYLIE_MINNOW, intro);
  }
  // The transcript's "talking again" variant is the same ask, pointing back at the first talk.
  const ask = intro?.findIndex((step) => step.player === ASK_AGAIN) ?? -1;
  return sayAsKylie(player, N.KYLIE_MINNOW, ask >= 0 ? intro.slice(ask) : intro);
}

function minnows(player) {
  return player.getInventory().getAmount(core.ItemIdentifiers.MINNOW);
}

/** Answers the prose conditions in Kylie's transcript; meeting them is what grants access. */
function kylieCondition({ player, npcId, text }) {
  if (!kylieIds.has(npcId)) return null;
  switch (text) {
    case "If the player meets all the requirements:":
      if (!meetsRequirements(player)) return false;
      setAccessState(player, ACCESS);
      return true;
    case "If the player doesn't have 82 Fishing:":
      return !hasPlatformLevel(player);
    case "If the player hasn't completed the Fishing Contest:":
      return !completedFishingContest(player);
    case "If the player isn't wearing the Angler's outfit:":
      return !AnglerOutfit.wearsFullOutfit(player);
    case "With open inventory space and at least 40 minnows:":
      return player.getInventory().getFreeSlots() > 0 && minnows(player) >= MINNOWS_PER_SHARK;
    case "Without at least 40 minnows:":
      return minnows(player) < MINNOWS_PER_SHARK;
    case "Without free inventory space:":
      return player.getInventory().getFreeSlots() === 0;
    default:
      return null;
  }
}

function travelToPlatform({ player }) {
  const { NpcIdentifiers: N } = core;
  if (!hasPlatformLevel(player)) {
    return sayAsKylie(player, N.KYLIE_MINNOW, variant(BOAT_WITHOUT_LEVEL));
  }
  if (!hasAccess(player)) {
    return sayAsKylie(player, N.KYLIE_MINNOW, variant(BOAT_WITHOUT_ACCESS));
  }
  player.moveTo(new core.Location(...PLATFORM_LANDING));
  return true;
}

function leavePlatform({ player }) {
  player.moveTo(new core.Location(...DOCK_LANDING));
  return true;
}

function restoreAccess({ player }) {
  const state = accessState(player);
  if (state > 0) {
    player.getPacketSender().sendVarbit(ACCESS_VARBIT, state);
  }
}

function attach(pluginApi) {
  api = pluginApi;
  core = api.core;
  const { NpcIdentifiers: N } = core;
  kylieIds = new Set([N.KYLIE_MINNOW, N.KYLIE_MINNOW_2]);

  api.persistAttribute(ACCESS_ATTRIBUTE);
  api.onPlayerLogin(restoreAccess);
  api.onNpcInteraction("Kylie Minnow", { "Talk-to": talkToKylie });
  api.onNpcDialogueCondition(kylieCondition);
  api.onObjectInteraction("Row boat", { "Travel to platform": travelToPlatform, "Leave platform": leavePlatform });
}

module.exports = {
  attach, hasAccess, talkToKylie, kylieCondition, travelToPlatform, leavePlatform,
  ACCESS_VARBIT, ACCESS_ATTRIBUTE, PLATFORM_LANDING, DOCK_LANDING,
};
