"use strict";

/**
 * Getting in and out of the Sorceress's Garden, and the gates into each maze.
 *
 * The Apprentice (cache NPC 1808, spawned at 3321,3139) teleports the player into the
 * central garden after Prince Ali Rescue is complete; below that she refuses with the
 * Wiki's line. The Wiki also requires having asked Osman about the garden first, which
 * this plugin folds into the quest requirement (noted in the PR).
 *
 * Her right-click Teleport and the Talk-to conversation both end in the overheard
 * "Seventior Disthinte Molesko!" and a teleport to (2912,5472). A follower stops the
 * teleport with the Wiki's pet line; the only follower state readable from another plugin
 * is the Pets plugin's `pets:current` attribute. Drinking from the fountain (12941) sends
 * the player back to the Apprentice's house.
 *
 * The gates (12617 winter, 12639 autumn, 12719 spring, 11987 summer) are already walkable
 * in the cache, so opening one only checks the level; a low-level player who walks through
 * anyway is turned back by the maze's Area.postEnter. Entry is checked against the current
 * (boosted) Thieving level, per the Wiki.
 */

const Gardens = require("./Gardens.SorceresssGarden");

const {
  APPRENTICE_TILE,
  CENTRAL_GARDEN,
  FOUNTAIN_ID,
  PLANE,
  SEASONS,
  meetsLevel,
  seasonForGate,
} = Gardens;

const APPRENTICE_NAME = "Apprentice";
/** The Pets plugin's follower attribute; the pet NPC is stored there while following. */
const PET_ATTRIBUTE = "pets:current";
/** Persisted flag: the Apprentice has cast the teleport at least once. */
const TELEPORTED_ATTRIBUTE = "sorceress-s-garden:teleported";
const PAR_QUEST_KEY = "prince_ali_rescue";

const REFUSAL_LINE = "I can't do that now, I'm far too busy sweeping.";
const PET_LINE =
  "Oh, I'm sorry, could you pick up your follower first? I'm really not sure that I could teleport the both of you.";
const SPELL_LINE = "Seventior Disthinte Molesko!";
const GATE_IDS = Object.values(SEASONS).map((season) => season.gateId);

let api;
let core;

const centralGarden = () => new core.Location(CENTRAL_GARDEN.x, CENTRAL_GARDEN.y, PLANE);
const apprenticeHouse = () => new core.Location(APPRENTICE_TILE.x, APPRENTICE_TILE.y, PLANE);
const thievingLevel = (player) => player.getSkillManager().getCurrentLevel(core.Skill.THIEVING);

function questComplete(player, key) {
  const request = { player, key, complete: false };
  api.emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

function isUnlocked(player) {
  return questComplete(player, PAR_QUEST_KEY);
}

/** Only the Pets plugin's following pet is visible from here; other followers are not. */
function hasFollower(player) {
  const pet = player.getAttribute?.(PET_ATTRIBUTE);
  return pet?.isRegistered?.() === true;
}

function conversation(player, npcId, lines, onDone) {
  const { DialogueChainBuilder, NpcDialogue, PlayerDialogue, ActionDialogue } = core;
  const builder = new DialogueChainBuilder();
  lines.forEach(([speaker, text], index) => {
    builder.add(
      speaker === "npc" ? new NpcDialogue(index, npcId, text) : new PlayerDialogue(index, text)
    );
  });
  if (onDone) builder.add(new ActionDialogue(lines.length, { execute: onDone }));
  player.getDialogueManager().startDialogues(builder);
}

function teleportIn(player, npc) {
  npc?.forceChat?.(SPELL_LINE);
  player.moveTo(centralGarden());
  player.setAttribute(TELEPORTED_ATTRIBUTE, true);
}

function talkToApprentice(event) {
  const { player, npc, npcId } = event;
  if (!isUnlocked(player)) {
    conversation(player, npcId, [["npc", REFUSAL_LINE]]);
    return;
  }
  if (hasFollower(player)) {
    conversation(player, npcId, [["npc", PET_LINE]]);
    return;
  }
  const firstVisit = !player.getAttribute(TELEPORTED_ATTRIBUTE);
  const lines = firstVisit
    ? [
        ["npc", "Oh you wouldn't mind?"],
        ["player", "Of course not. I'd be glad to help."],
        ["npc", "Okay, here goes! Remember, to return, just drink from the fountain."],
      ]
    : [
        ["player", "Hey apprentice, do you want to try out your teleport skills again?"],
        ["npc", "Okay, here goes - and remember, to return just drink from the fountain."],
      ];
  conversation(player, npcId, lines, () => teleportIn(player, npc));
}

function teleportByApprentice(event) {
  const { player, npc, npcId } = event;
  if (!isUnlocked(player)) {
    conversation(player, npcId, [["npc", REFUSAL_LINE]]);
    return;
  }
  if (hasFollower(player)) {
    conversation(player, npcId, [["npc", PET_LINE]]);
    return;
  }
  teleportIn(player, npc);
}

function openGate(event) {
  const season = seasonForGate(event.objectId);
  if (!season) return false;
  if (!meetsLevel(season, thievingLevel(event.player))) {
    event.player.sendMessage(`You need a Thieving level of ${season.level} to enter this garden.`);
    return;
  }
  event.player.sendMessage("You open the gate.");
}

function drinkFromFountain(event) {
  if (event.objectId !== FOUNTAIN_ID) return false;
  event.player.moveTo(apprenticeHouse());
}

module.exports = function registerApprentice(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  api.persistAttribute(TELEPORTED_ATTRIBUTE);
  api.onNpcInteraction(APPRENTICE_NAME, {
    "Talk-to": talkToApprentice,
    Teleport: teleportByApprentice,
  });
  api.onObjectClick(GATE_IDS, 1, openGate);
  api.onObjectInteraction("Fountain", { "Drink-from": drinkFromFountain });
};

module.exports._test = {
  setCore(value) {
    core = value;
  },
  REFUSAL_LINE,
  PET_LINE,
  SPELL_LINE,
  TELEPORTED_ATTRIBUTE,
  PET_ATTRIBUTE,
  isUnlocked,
  hasFollower,
  teleportIn,
  talkToApprentice,
  teleportByApprentice,
  openGate,
  drinkFromFountain,
  _setApi(value) {
    api = value;
  },
};
