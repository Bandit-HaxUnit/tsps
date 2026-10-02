"use strict";

/**
 * The Jaltevas pyramid lobby: the way in from Necropolis, the grouping obelisk's party board
 * (interfaces 772/774), the invocation board, the party overlay (773) and the raid entry.
 *
 * Party board protocol (lists drawn by cache scripts 6601/6722/6727, the management panel
 * initialised by 6729 with the invocation bitmaps) follows the cache interfaces.
 */

const Shared = require("./ToaShared");
const Parties = require("./ToaParties");
const Invocations = require("./ToaInvocations");
const Raid = require("./ToaRaid");
const Rewards = require("./ToaRewards");

const { INTERFACE, SCRIPT, VARBIT, VARP, EVENT } = Shared;

const OVERVIEW_BUTTONS_UID = (INTERFACE.PARTY_OVERVIEW << 16) | 1;
const OVERVIEW_PARTY_LIST_UID = (INTERFACE.PARTY_OVERVIEW << 16) | 16;
const MANAGEMENT_BUTTONS_UID = (INTERFACE.PARTY_MANAGEMENT << 16) | 1;
const MANAGEMENT_REWARD_INFO_UID = (INTERFACE.PARTY_MANAGEMENT << 16) | 96;
/** The details panel's pause buttons: tabs, members, applicants and invocations (0-97). */
const MANAGEMENT_PAUSE_LAST = 97;
const MANAGEMENT_PRESETS_UID = (INTERFACE.PARTY_MANAGEMENT << 16) | 98;
const REWARD_POTENTIAL_TEXT_UID = 50724925;

const OVERVIEW = { REFRESH: 0, MAKE_PARTY: 1, FILTER: 2 };
const MANAGEMENT = {
  OPEN_LIST: 0, REFRESH: 1, UNBLOCK: 2, SET_COMPLETIONS: 3, MEMBER_OPTION: 4, CLEAR_ALL: 5,
  LOAD_PRESET: 6, SAVE_PRESET: 7, TAB_FIRST: 8, TAB_LAST: 11, MEMBER_FIRST: 12, MEMBER_LAST: 19,
  ACCEPT_FIRST: 20, DECLINE_FIRST: 28, APPLICANT_LAST: 35, INVOCATION_FIRST: 36,
};
const VIEW = { NON_MEMBER: 0, MEMBER: 1, LEADER: 2, APPLICANT: 3, DECLINED: 4 };

const REWARD_POTENTIAL_INFO = "Reward Potential|"
  + "Before entering a raid, you can customise the difficulty of the challenges you'll face by using <col=ffffff>Invocations</col>. "
  + "There are a large variety of Invocations available, covering both challenge-specific mechanics as well as raid-wide systems.<br><br>"
  + "Enabling or disabling Invocations will change the <col=ffffff>Raid Level</col>. Higher Raid Levels will result in more rewards becoming available."
  + "<br><br>If a reward is outlined in <col=ffd270>gold</col>, it is reasonably possible to obtain it at this Raid Level. "
  + "If a reward is outlined in <col=ff7070>red</col>, it is not possible to obtain it at this Raid Level. "
  + "If a reward is not outlined, it is still possible, though highly unlikely, to obtain it at this Raid Level.|"
  + "Close|";

const NECROPOLIS_ENTRANCE_RADIUS = 8;
const SACK_GRAIN_CHANCE = 20;

// ------------------------------------------------------------------ entrances

function isNearNecropolisEntrance(location) {
  return location.getZ() === 0
    && Math.abs(location.getX() - Shared.NECROPOLIS_EXIT.x) <= NECROPOLIS_ENTRANCE_RADIUS
    && Math.abs(location.getY() - Shared.NECROPOLIS_EXIT.y) <= NECROPOLIS_ENTRANCE_RADIUS;
}

/** Necropolis' pyramid entry down into the lobby. */
function enterPyramid({ player, location }) {
  if (!isNearNecropolisEntrance(Shared.loc(location))) return false;
  const { Direction } = Shared.core();
  Shared.fadeMove(player, () => {
    player.moveTo(Shared.loc(Shared.LOBBY_ENTRANCE));
    player.setDirection?.(Direction.SOUTH);
  });
  return true;
}

function leavePyramid({ player }) {
  if (!Shared.inLobby(player.getLocation())) return false;
  const { Direction } = Shared.core();
  Shared.fadeMove(player, () => {
    player.moveTo(Shared.loc(Shared.NECROPOLIS_EXIT));
    player.setDirection?.(Direction.NORTH_WEST);
  });
  return true;
}

/** The lobby's raid entrance: the leader takes the party in, members follow. */
function enterTombs({ player }) {
  if (!Shared.inLobby(player.getLocation())) return false;
  const lobby = Parties.currentParty(player);
  if (!lobby) {
    Shared.options(player, "You are currently not in a raiding party.",
      "Form or join a party.", () => openOverview(player),
      "Cancel.", () => {});
    return true;
  }
  if (Rewards.hasLoot(player)) {
    Shared.statement(player, "You have unclaimed rewards from your last raid. Collect them from the chest first.");
    return true;
  }
  const raid = lobby.raid ?? Raid.begin(player);
  if (!raid) return true;
  raid.add(player);
  raid.enterRoom(player, "MAIN_HALL", { leaderOnly: !raid.room });
  Parties.stateOf(player).current = lobby;
  return true;
}

function searchSack({ player }) {
  if (!Shared.inLobby(player.getLocation())) return false;
  if (Shared.random(0, SACK_GRAIN_CHANCE) !== 0) {
    Shared.statement(player, "You go to search the sack, but the bank camel glares at you menacingly and spits in your direction");
    return;
  }
  Shared.statement(player, "You successfully take some grain while the bank camel isn't looking.");
  const { ItemIdentifiers } = Shared.core();
  player.getInventory().adds(ItemIdentifiers.GRAIN, 1);
}

function readInvocationBoard({ player }) {
  player.getPacketSender().sendInterface(INTERFACE.INVOCATION_INFO);
}

function inspectObelisk({ player, option }) {
  if (option !== "Inspect") return false;
  openOverview(player);
  return true;
}

// ------------------------------------------------------------------ lobby zone

function enterLobby({ player }) {
  player.getPacketSender().sendSubInterface(Shared.OVERLAY_HUD_UID, INTERFACE.PARTY_OVERLAY, 1);
  const party = Parties.currentParty(player);
  if (party) party.broadcastMembers();
  else Parties.sendEmptyPartyOverlay(player);
}

function leaveLobby({ player }) {
  if (Raid.raidOf(player) && Shared.inTombs(player.getLocation())) return;
  player.getPacketSender().closeSubInterface(Shared.OVERLAY_HUD_UID);
  const { applied, current } = Parties.forget(player);
  if (applied?.leader) refreshManagement(applied.leader);
  if (current && !current.insideRaid()) {
    player.sendMessage("You have left the lobby, so you have been removed from your party.");
    if (current.leader) refreshManagement(current.leader);
  }
}

function forgetOnLogout({ player }) {
  if (Raid.raidOf(player)) return;
  const { applied, current } = Parties.forget(player);
  if (applied?.leader) refreshManagement(applied.leader);
  if (current?.leader) refreshManagement(current.leader);
}

// ------------------------------------------------------------------ overview (772)

function openOverview(player) {
  const state = Parties.stateOf(player);
  state.viewing = null;
  const sender = player.getPacketSender();
  sender.sendConfig(VARP.CURRENT_PARTY, state.current ? 0 : -1);
  sender.sendInterface(INTERFACE.PARTY_OVERVIEW);
  // The list's buttons and rows are pause buttons (resume_pausebutton), as OSRS sets them;
  // as op1 clicks the script-built rows had nothing to click.
  sender.sendInterfaceFlagsRange(OVERVIEW_BUTTONS_UID, 0, 2, EVENT.CONTINUE);
  sender.sendInterfaceFlagsRange(OVERVIEW_PARTY_LIST_UID, 0, Shared.MAX_LOBBY_PARTIES - 1, EVENT.CONTINUE);
  sendPartyList(player);
}

/** One row per recruiting party: leader|members...|size|kc|invocations|level|mode|age|. */
function sendPartyList(player) {
  const state = Parties.stateOf(player);
  const friendsOnly = player.getPacketSender().getVarbit?.(VARBIT.FRIENDS_ONLY) === 1;
  state.listed = [];
  const sender = player.getPacketSender();
  const parties = Parties.lobbyParties.filter((party) => !friendsOnly || party.players.some((member) => isFriend(player, member)));
  for (let index = 0; index < Shared.MAX_LOBBY_PARTIES; index++) {
    const party = parties[index];
    if (!party) {
      sender.sendClientScript(SCRIPT.PARTY_LIST_ROW, index, "");
      continue;
    }
    let leaderName = party.leaderName;
    if (party.players.includes(player)) leaderName = `<col=FFFFFF>${leaderName}`;
    const fields = [leaderName];
    for (let i = 1; i < Shared.MAX_PARTY_SIZE; i++) fields.push(party.players[i] ? Shared.displayName(party.players[i]) : "");
    fields.push(party.players.length, party.settings.kcRequirement, party.settings.activeCount,
      party.settings.raidLevel, party.settings.mode, Shared.cycle() - party.createdAt);
    sender.sendClientScript(SCRIPT.PARTY_LIST_ROW, index, `${fields.join("|")}|`);
    state.listed.push(party);
  }
}

function isFriend(player, other) {
  return player.getRelations?.()?.isFriendWith?.(other.getUsername()) === true;
}

function clickOverviewButton(event) {
  const { player } = event;
  switch (slotOf(event)) {
    case OVERVIEW.REFRESH:
      sendPartyList(player);
      return;
    case OVERVIEW.MAKE_PARTY:
      makeOrViewParty(player);
      return;
    case OVERVIEW.FILTER: {
      const current = player.getPacketSender().getVarbit?.(VARBIT.FRIENDS_ONLY) ?? 0;
      player.getPacketSender().sendVarbit(VARBIT.FRIENDS_ONLY, current === 0 ? 1 : 0);
      sendPartyList(player);
      return;
    }
    default:
  }
}

function makeOrViewParty(player) {
  const state = Parties.stateOf(player);
  if (!state.current) {
    if (Parties.isListFull()) {
      player.sendMessage("The list of lobby parties is currently full. Please come back later or apply to an existing party.");
      return;
    }
    const applied = state.applied;
    if (applied && applied.withdraw(player) && applied.leader) refreshManagement(applied.leader);
    state.viewing = Parties.createParty(player);
    state.tab = 1;
  } else {
    state.viewing = state.current;
    state.tab = 0;
  }
  openManagement(player);
}

function selectParty(event) {
  const { player } = event;
  const state = Parties.stateOf(player);
  const party = state.listed[slotOf(event)];
  if (!party) return;
  if (state.current?.insideRaid()) {
    Shared.statement(player, "You should join your party in the tombs.");
    return;
  }
  if (!Parties.listed(party) || party.insideRaid()) {
    Shared.statement(player, "That party is no longer recruiting.");
    return;
  }
  state.viewing = party;
  openManagement(player);
}

// ------------------------------------------------------------------ management (774)

function openManagement(player) {
  player.getPacketSender().sendInterface(INTERFACE.PARTY_MANAGEMENT);
  refreshManagement(player);
}

function viewingParty(player) {
  const party = Parties.stateOf(player).viewing;
  if (!party || !party.leader) {
    openOverview(player);
    return null;
  }
  return party;
}

function viewingManagement(player, party) {
  return Parties.stateOf(player).viewing === party;
}

/** Redraws the management panel for a player looking at a party. */
function refreshManagement(player) {
  const state = Parties.stateOf(player);
  const party = state.viewing;
  if (!party || !party.leader) return;
  const sender = player.getPacketSender();
  state.viewingValue = party.isLeader(player) ? VIEW.LEADER
    : party.players.includes(player) ? VIEW.MEMBER
      : party.applicants.includes(player) ? VIEW.APPLICANT
        : party.blocked.includes(player) ? VIEW.DECLINED
          : VIEW.NON_MEMBER;
  for (let index = 0; index < Shared.MAX_PARTY_SIZE; index++) {
    const member = party.players[index];
    sender.sendClientScript(SCRIPT.PARTY_MEMBER_ROW, state.viewingValue, member ? statLine(member, member === player) : "");
  }
  for (const applicant of party.applicants) {
    sender.sendClientScript(SCRIPT.PARTY_APPLICANT_ROW, statLine(applicant, applicant === player));
  }
  const { settings } = party;
  sender.sendClientScript(SCRIPT.PARTY_MANAGEMENT_INIT, state.viewingValue, settings.kcRequirement,
    settings.activeCount, settings.raidLevel, state.tab, settings.bitmaps[0], settings.bitmaps[1], settings.bitmaps[2]);
  sender.sendInterfaceFlagsRange(MANAGEMENT_BUTTONS_UID, 0, MANAGEMENT_PAUSE_LAST, EVENT.CONTINUE);
  sender.sendInterfaceFlags(MANAGEMENT_REWARD_INFO_UID, EVENT.OP1);
  if (party.isLeader(player)) {
    sender.sendInterfaceFlagsRange(MANAGEMENT_PRESETS_UID, 0, Parties.PRESET_COUNT, EVENT.OP1 | EVENT.OP2);
  }
}

/** name|combat|attack|strength|ranged|magic|defence|hitpoints|prayer|entry / normal / expert| */
function statLine(player, self) {
  const { Skill } = Shared.core();
  const skills = player.getSkillManager();
  const counts = Raid.killCounts(player);
  const fields = [
    `${self ? "<col=FFFFFF>" : ""}${Shared.displayName(player)}`,
    player.getSkillManager().getCombatLevel?.() ?? 3,
    skills.getMaxLevel(Skill.ATTACK),
    skills.getMaxLevel(Skill.STRENGTH),
    skills.getMaxLevel(Skill.RANGED),
    skills.getMaxLevel(Skill.MAGIC),
    skills.getMaxLevel(Skill.DEFENCE),
    skills.getMaxLevel(Skill.HITPOINTS),
    skills.getMaxLevel(Skill.PRAYER),
    `${counts.entry} / ${counts.normal} / ${counts.expert}`,
  ];
  return `${fields.join("|")}|`;
}

function refreshPartyViewers(party) {
  for (const member of [...party.players, ...party.applicants, ...party.blocked]) {
    if (viewingManagement(member, party)) refreshManagement(member);
  }
}

function clickManagementButton(event) {
  const { player } = event;
  const slot = slotOf(event);
  const party = viewingParty(player);
  if (!party) return;
  const leader = party.isLeader(player);
  if (slot === MANAGEMENT.OPEN_LIST) {
    openOverview(player);
  } else if (slot === MANAGEMENT.REFRESH) {
    refreshManagement(player);
  } else if (slot === MANAGEMENT.UNBLOCK && leader) {
    party.blocked = [];
    Shared.statement(player, "All players rejected from this party have been unblocked and may apply again.");
    refreshManagement(player);
  } else if (slot === MANAGEMENT.SET_COMPLETIONS && leader) {
    promptCompletions(player, party);
  } else if (slot === MANAGEMENT.MEMBER_OPTION) {
    memberOption(player, party);
  } else if (slot === MANAGEMENT.CLEAR_ALL && leader) {
    Shared.confirm(player, "Are you sure you want to clear all active Invocations?", () => {
      party.settings.clear();
      Shared.sound(player, Shared.SOUND.CLEAR);
      refreshPartyViewers(party);
    });
  } else if (slot === MANAGEMENT.LOAD_PRESET && leader) {
    loadPreset(player, party);
  } else if (slot === MANAGEMENT.SAVE_PRESET && leader) {
    savePreset(player, party);
  } else if (slot >= MANAGEMENT.TAB_FIRST && slot <= MANAGEMENT.TAB_LAST) {
    Parties.stateOf(player).tab = slot - MANAGEMENT.TAB_FIRST;
    refreshManagement(player);
  } else if (slot >= MANAGEMENT.MEMBER_FIRST && slot <= MANAGEMENT.MEMBER_LAST && leader) {
    kick(player, party, party.players[slot - MANAGEMENT.MEMBER_FIRST]);
  } else if (slot >= MANAGEMENT.ACCEPT_FIRST && slot <= MANAGEMENT.APPLICANT_LAST && leader) {
    const accept = slot < MANAGEMENT.DECLINE_FIRST;
    answerApplicant(player, party, party.applicants[slot - (accept ? MANAGEMENT.ACCEPT_FIRST : MANAGEMENT.DECLINE_FIRST)], accept);
  } else if (slot >= MANAGEMENT.INVOCATION_FIRST && leader) {
    toggleInvocation(player, party, Invocations.keyAtSlot(slot - MANAGEMENT.INVOCATION_FIRST));
  }
}

function promptCompletions(player, party) {
  player.setEnteredAmountAction({
    execute: (value) => {
      party.settings.kcRequirement = Math.max(0, Math.min(100, value | 0));
      refreshPartyViewers(party);
    },
  });
  player.getPacketSender().sendEnterAmountPrompt("Set a preferred number of completions up to 100 (or 0 to clear it):");
}

function toggleInvocation(player, party, key) {
  if (!key || party.insideRaid()) return;
  const wasActive = party.settings.isActive(key);
  const refusal = party.settings.toggle(key);
  if (refusal) {
    player.sendMessage(refusal);
    return;
  }
  Shared.sound(player, wasActive ? Shared.SOUND.INVOCATION_OFF : Shared.SOUND.INVOCATION_ON);
  refreshPartyViewers(party);
}

/** The panel's one context button: apply, withdraw, leave or disband depending on who looks. */
function memberOption(player, party) {
  const state = Parties.stateOf(player);
  switch (state.viewingValue) {
    case VIEW.NON_MEMBER:
      applyToParty(player, party);
      return;
    case VIEW.MEMBER:
      if (state.current?.insideRaid()) {
        Shared.statement(player, "You should join your party in the tombs.");
        return;
      }
      if (party.leave(player, true)) {
        player.sendMessage(`You have left the party of ${party.leaderName}.`);
        refreshPartyViewers(party);
        openOverview(player);
      }
      return;
    case VIEW.LEADER:
      if (party.insideRaid()) return;
      party.disband();
      openOverview(player);
      return;
    case VIEW.APPLICANT:
      if (party.withdraw(player)) {
        player.sendMessage("You have withdrawn your party application.");
        refreshPartyViewers(party);
        refreshManagement(player);
      }
      return;
    case VIEW.DECLINED:
      Shared.statement(player, "You have been declined by this party.");
      return;
    default:
  }
}

function applyToParty(player, party) {
  const state = Parties.stateOf(player);
  if (state.current?.insideRaid()) {
    Shared.statement(player, "You should join your party in the tombs.");
    return;
  }
  const apply = () => {
    const previous = state.applied;
    if (previous && previous.withdraw(player) && previous.leader) refreshManagement(previous.leader);
    if (!party.apply(player)) {
      Shared.statement(player, "That party is no longer recruiting.");
      return;
    }
    player.sendMessage(`You have applied to join the party of ${party.leaderName}.`);
    state.tab = 1;
    refreshPartyViewers(party);
    refreshManagement(player);
  };
  if (state.current) {
    Shared.options(player, "You are already in a party",
      "Stay in my existing party.", () => refreshManagement(player),
      "Quit that one and apply to this one.", () => {
        const old = state.current;
        old.leave(player, true);
        refreshPartyViewers(old);
        apply();
      });
  } else {
    apply();
  }
}

function kick(player, party, target) {
  if (!target) return;
  if (target === player) {
    if (party.leave(player, true)) {
      player.sendMessage("You have left your party.");
      refreshPartyViewers(party);
      openOverview(player);
    }
    return;
  }
  party.removePlayer(target);
  Parties.sendEmptyPartyOverlay(target);
  target.sendMessage(`You have been kicked from the party of ${Shared.displayName(player)}.`);
  Shared.sound(target, Shared.SOUND.DECLINE);
  player.sendMessage(`You have kicked ${Shared.displayName(target)} from your party.`);
  if (viewingManagement(target, party)) refreshManagement(target);
  refreshManagement(player);
}

function answerApplicant(player, party, applicant, accept) {
  if (!applicant) return;
  if (accept && party.players.length >= Shared.MAX_PARTY_SIZE) {
    player.sendMessage("Your party is full.");
    return;
  }
  if (!party.answer(applicant, accept)) return;
  if (accept) {
    player.sendMessage(`You have accepted ${Shared.displayName(applicant)} into your party.`);
    applicant.sendMessage(`Your application to the party of ${party.leaderName} has been accepted.`);
    Shared.sound(applicant, Shared.SOUND.CONFIRM);
  } else {
    player.sendMessage(`You have declined the party application from ${Shared.displayName(applicant)}.`);
    applicant.sendMessage(`Your application to the party of ${party.leaderName} has been declined.`);
    Shared.sound(applicant, Shared.SOUND.DECLINE);
  }
  refreshPartyViewers(party);
}

function selectedPreset(player) {
  return (player.getPacketSender().getVarbit?.(VARBIT.PRESET_SELECT) ?? 0) - 1;
}

function savePreset(player, party) {
  const slot = selectedPreset(player);
  if (slot < 0) {
    player.sendMessage("You do not have a valid preset selected to save to.");
    return;
  }
  const presets = Parties.presetsOf(player);
  const save = () => {
    presets[slot] = [...party.settings.bitmaps];
    player.setAttribute("toa:invocation-presets", presets);
    player.getPacketSender().sendVarbit(VARBIT.PRESET_SELECT, 0);
    sendPresetVarps(player);
    player.sendMessage("Your preset has been saved.");
    Shared.sound(player, Shared.SOUND.CONFIRM);
    refreshManagement(player);
  };
  if (presets[slot].some((word) => word !== 0)) {
    Shared.options(player, "You already have a preset saved in this slot.",
      "Save and overwrite this preset.", save,
      "Cancel", () => refreshManagement(player));
  } else {
    save();
  }
}

function loadPreset(player, party) {
  const slot = selectedPreset(player);
  player.getPacketSender().sendVarbit(VARBIT.PRESET_SELECT, 0);
  if (slot < 0) {
    player.sendMessage("You do not have a valid preset selected to load from.");
    return;
  }
  const preset = Parties.presetsOf(player)[slot];
  if (preset.every((word) => word === 0)) {
    player.sendMessage("You do not have any invocations stored in this preset.");
    return;
  }
  party.settings.load(preset);
  player.sendMessage("Your preset has been loaded.");
  Shared.sound(player, Shared.SOUND.CONFIRM);
  refreshPartyViewers(party);
}

/** Each preset is three varps the panel reads to show what it holds. */
function sendPresetVarps(player) {
  const presets = Parties.presetsOf(player);
  presets.forEach((preset, index) => {
    for (let word = 0; word < 3; word++) {
      player.getPacketSender().sendConfig(VARP.PRESET_BASE + index * 3 + word, preset[word] | 0);
    }
  });
}

function clickPreset(event) {
  const { player } = event;
  const party = viewingParty(player);
  const slot = slotOf(event);
  if (!party || !party.isLeader(player) || slot < 0 || slot >= Parties.PRESET_COUNT) return;
  if ((event.opId ?? event.action) <= 1) {
    const current = player.getPacketSender().getVarbit?.(VARBIT.PRESET_SELECT) ?? 0;
    player.getPacketSender().sendVarbit(VARBIT.PRESET_SELECT, current === slot + 1 ? 0 : slot + 1);
    refreshManagement(player);
    return;
  }
  Shared.options(player, "Are you sure you wish to clear this preset?",
    "Clear this preset.", () => {
      Parties.presetsOf(player)[slot] = [0, 0, 0];
      sendPresetVarps(player);
      player.sendMessage("Your preset has been cleared.");
      Shared.sound(player, Shared.SOUND.CLEAR);
      refreshManagement(player);
    },
    "Cancel", () => refreshManagement(player));
}

function showRewardPotential({ player }) {
  player.getPacketSender().sendClientScript(SCRIPT.TEXT_POPUP, REWARD_POTENTIAL_INFO, REWARD_POTENTIAL_TEXT_UID);
}

/** Slot of a list click; resume_pausebutton clicks carry it as the action. */
function slotOf(event) {
  return Number.isInteger(event.slot) && event.slot >= 0 && event.slot < 0xffff ? event.slot : event.action;
}

function sendPresetsOnLogin({ player }) {
  if (Parties.presetsOf(player).some((preset) => preset.some((word) => word !== 0))) sendPresetVarps(player);
}

module.exports = function registerTombsLobby(api) {
  Shared.bind(api);
  Shared.onObject(api, "Entry", enterPyramid);
  Shared.onObject(api, "Entry", enterTombs);
  Shared.onObject(api, "Exit", leavePyramid);
  Shared.onObject(api, "Grouping Obelisk", inspectObelisk);
  Shared.onObject(api, "Invocation Board", readInvocationBoard);
  Shared.onObject(api, "Sack", searchSack);
  api.onZoneEnter(Shared.LOBBY, enterLobby);
  api.onZoneExit(Shared.LOBBY, leaveLobby);
  api.onPlayerLogout(forgetOnLogout);
  api.onPlayerLogin(sendPresetsOnLogin);
  api.onInterfaceActionButton(OVERVIEW_BUTTONS_UID, clickOverviewButton);
  api.onInterfaceActionButton(OVERVIEW_PARTY_LIST_UID, selectParty);
  api.onInterfaceActionButton(MANAGEMENT_BUTTONS_UID, clickManagementButton);
  api.onInterfaceActionButton(MANAGEMENT_REWARD_INFO_UID, showRewardPotential);
  api.onInterfaceActionButton(MANAGEMENT_PRESETS_UID, clickPreset);
  api.persistAttribute("toa:invocation-presets");
  api.persistAttribute("toa:completions");
};
