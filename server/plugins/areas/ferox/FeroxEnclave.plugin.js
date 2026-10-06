/**
 * Ferox Enclave (https://oldschool.runescape.wiki/w/Ferox_Enclave), from OSRS captures
 * (docs/ferox-enclave.md):
 *
 * - The barriers: leaving warns once (teleblock warning, then "Continue through the Barrier?");
 *   crossing plays the drag animation and steps through a tick later. A teleblocked player can't
 *   come back in.
 * - The town is safe from other players unless one of them is teleblocked; the buffer outside the
 *   barriers too. Inside, varbit 6549 is set; in the buffer, varbit 10530.
 * - The Pools of Refreshment restore everything but special attack.
 * - The free-for-all portal and its arena: FreeForAll.js.
 */
const { Location } = require("../../../src/main/typescript/elvarg/game/model/Location");
const Bounds = require("./FeroxBounds");
const { createFreeForAll } = require("./FreeForAll");

const BUSY_VARBIT = 12393;
const INSIDE_VARBIT = 6549; // pvp_adjacent_area_client
const BUFFER_VARBIT = 10530; // wildy_hub_buffer
const WARNING_VARBIT = 10532; // wildy_hub_warning
const DISEASE_VARP = 456;
const DONT_ASK_ATTRIBUTE = "ferox:barrier-dont-ask";

const CROSS_ANIMATION = 4282; // sos_security_door_drag
const CROSS_SOUND = 4193;
const POOL_ANIMATION = 7305; // poh_pool_drink
const POOL_BUSY_TICKS = 3; // ours: the capture ends with busy still set

const BARRIER_WARNING = "When returning to the Enclave, if you are teleblocked, you will not<br>be allowed to enter the Enclave until the teleblock has worn off.<br><col=ef1020>You will also be attackable in the safe zone outside the Enclave if<br><col=ef1020>you are teleblocked.</col>";

let api = null;
let core = null;
/** The last varbit pair sent per player: "inside,buffer". */
const lastState = new WeakMap();

function later(player, ticks, action) {
  core.TaskManager.submit(new (class extends core.Task {
    constructor() {
      super(ticks, player, false);
    }

    execute() {
      this.stop();
      if (player.isRegistered?.() !== false) action();
    }
  })());
}

function isTeleblocked(player) {
  return player?.getCombat?.()?.getTeleblockTimer?.()?.finished?.() === false;
}

// ------------------------------------------------------------------ the barriers

/** Tick 0: face the way through, drag; tick 1: through (as captured). */
function cross(player, crossing) {
  const sender = player.getPacketSender();
  const target = new Location(crossing.target.x, crossing.target.y, crossing.target.z);
  sender.sendVarbit(BUSY_VARBIT, 1);
  player.setPositionToFace(target);
  player.performAnimation(new core.Animation(CROSS_ANIMATION));
  sender.sendSoundEffect(CROSS_SOUND, 2, 30, 255);
  later(player, 1, () => {
    sender.sendVarbit(BUSY_VARBIT, 0);
    player.moveTo(target);
    player.performAnimation(core.Animation.DEFAULT_RESET_ANIMATION);
  });
}

function warnThenCross(player, crossing) {
  const { DialogueChainBuilder, StatementDialogue, ActionDialogue } = core;
  player.getPacketSender().sendVarbit(BUSY_VARBIT, 1);
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new StatementDialogue(0, BARRIER_WARNING),
    new ActionDialogue(1, {
      execute: () => api.sendMultiChatboxPrompt(player, "Continue through the Barrier?",
        "Yes.", () => cross(player, crossing),
        "Yes, and don't ask again.", () => {
          player.setAttribute(DONT_ASK_ATTRIBUTE, true);
          player.getPacketSender().sendVarbit(WARNING_VARBIT, 1);
          cross(player, crossing);
        },
        "No.", () => player.getPacketSender().sendVarbit(BUSY_VARBIT, 0)),
    }),
  ));
}

function passThrough({ player, object }) {
  const crossing = Bounds.crossingTarget(player.getLocation?.(), object);
  if (!crossing) return true;
  if (crossing.entering) {
    if (isTeleblocked(player)) {
      player.sendMessage("A magical force prevents you from entering the Ferox Enclave while teleblocked.");
      return true;
    }
    cross(player, crossing);
    return true;
  }
  if (player.getAttribute(DONT_ASK_ATTRIBUTE) === true) cross(player, crossing);
  else warnThenCross(player, crossing);
  return true;
}

/** Safe from other players in the town and its buffer, unless either of them is teleblocked. */
function denySafeZoneAttack(event) {
  if (event.allow !== null || event.attacker?.isPlayer?.() !== true || event.target?.isPlayer?.() !== true) return;
  if (!Bounds.isSafeLocation(event.attacker.getLocation()) && !Bounds.isSafeLocation(event.target.getLocation())) return;
  if (!isTeleblocked(event.attacker) && !isTeleblocked(event.target)) event.allow = false;
}

// ------------------------------------------------------------------ restoring

/** Hitpoints, prayer, run energy and every skill back to base; poison, venom and disease cured. */
function restore(player, { prayersOff }) {
  const skills = player.getSkillManager();
  for (const skill of core.Skill.values()) skills.setCurrentLevels(skill, skills.getMaxLevel(skill));
  player.setPoisonDamage(0);
  player.setVenomed(false);
  player.setRunEnergy(100);
  const sender = player.getPacketSender();
  sender.sendPoisonType(0).sendRunEnergy().sendConfig(DISEASE_VARP, -1);
  if (prayersOff) core.PrayerHandler.deactivatePrayers(player);
}

/** Pool of Refreshment: everything but special attack, and prayers off (Wiki). */
function drink({ player }) {
  player.performAnimation(new core.Animation(POOL_ANIMATION));
  restore(player, { prayersOff: true });
  player.sendMessage("You feel reinvigorated after drinking from the pool.");
  later(player, 1, () => player.getPacketSender().sendVarbit(BUSY_VARBIT, 1));
  later(player, POOL_BUSY_TICKS, () => player.getPacketSender().sendVarbit(BUSY_VARBIT, 0));
}

// ------------------------------------------------------------------ every tick

function syncState({ player }) {
  const location = player.getLocation();
  const near = location.getZ() === 0 && location.getX() >= 3110 && location.getX() <= 3170
    && location.getY() >= 3605 && location.getY() <= 3660;
  const inside = near && Bounds.isInsideEnclave(location) ? 1 : 0;
  const buffer = near && !inside && Bounds.isInBuffer(location) ? 1 : 0;
  const state = `${inside},${buffer}`;
  if (lastState.get(player) === state) return;
  lastState.set(player, state);
  player.getPacketSender().sendVarbit(INSIDE_VARBIT, inside).sendVarbit(BUFFER_VARBIT, buffer);
}

function sendWarningVarbit({ player }) {
  if (player.getAttribute(DONT_ASK_ATTRIBUTE) === true) player.getPacketSender().sendVarbit(WARNING_VARBIT, 1);
}

let freeForAll = null;

function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  freeForAll = createFreeForAll(pluginApi, core, { restore, later });
}

module.exports = {
  name: "FeroxEnclave",
  _test: { passThrough, cross, denySafeZoneAttack, drink, restore, syncState, attach, freeForAll: () => freeForAll, DONT_ASK_ATTRIBUTE, BARRIER_WARNING },
  register(pluginApi) {
    attach(pluginApi);
    pluginApi.persistAttribute(DONT_ASK_ATTRIBUTE);
    freeForAll.register();
    pluginApi.onObjectFirstClick(Bounds.BARRIER_IDS, passThrough);
    pluginApi.onCanAttack(denySafeZoneAttack);
    pluginApi.onObjectInteraction("Pool of Refreshment", { Drink: drink });
    pluginApi.onPlayerProcess(syncState);
    pluginApi.onPlayerLogin(sendWarningVarbit);
  },
};
