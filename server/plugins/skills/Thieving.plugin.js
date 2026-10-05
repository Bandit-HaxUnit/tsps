const { Skill } = require("../../src/main/typescript/elvarg/game/model/Skill");
const { Item } = require("../../src/main/typescript/elvarg/game/model/Item");
const { Animation } = require("../../src/main/typescript/elvarg/game/model/Animation");
const { Task } = require("../../src/main/typescript/elvarg/game/task/Task");
const { HitDamage } = require("../../src/main/typescript/elvarg/game/content/combat/hit/HitDamage");
const { HitMask } = require("../../src/main/typescript/elvarg/game/content/combat/hit/HitMask");
const { Sound } = require("../../src/main/typescript/elvarg/game/Sound");
const { Sounds } = require("../../src/main/typescript/elvarg/game/Sounds");
const { TimerKey } = require("../../src/main/typescript/elvarg/util/timers/TimerKey");
const { ItemIds } = require("../../src/main/typescript/elvarg/util/IdEnums");
const { ArceuusSpells } = require("../../src/main/typescript/elvarg/game/content/combat/magic/ArceuusSpells");

const THIEVING_ANIMATION = new Animation(881);
const PICKPOCKET_COOLDOWN_MS = 1200;
// Wiki (Pickpocketing): a failed pickpocket stops the player moving for 9 ticks and from
// pickpocketing again for 8, whichever NPC it was.
const PICKPOCKET_STUN_TICKS = 9;
const PICKPOCKET_STUN_LOCK_TICKS = 8;

const PICKPOCKETS = [
  {
    name: "Man",
    petBase: 257211,
    level: 1,
    xp: 8,
    stunDamage: 1,
    rewards: [[ItemIds.COINS, 3]],
  },
  {
    name: "Farmer",
    petBase: 257211,
    level: 10,
    xp: 14.5,
    stunDamage: 1,
    rewards: [[ItemIds.COINS, 9], [ItemIds.POTATO_SEED, 1]],
  },
  {
    name: "Rogue",
    petBase: 257211,
    level: 32,
    xp: 36.5,
    stunDamage: 2,
    rewards: [[ItemIds.COINS, 34], [ItemIds.LOCKPICK, 1], [ItemIds.JUG_OF_WINE, 1]],
  },
  {
    name: "Master Farmer",
    petBase: 257211,
    level: 38,
    xp: 43,
    stunDamage: 3,
    rewards: [[ItemIds.POTATO_SEED, 1], [ItemIds.ONION_SEED, 1], [ItemIds.MARRENTILL_SEED, 1], [ItemIds.RANARR_SEED, 1]],
  },
  {
    name: "Guard",
    petBase: 257211,
    level: 40,
    xp: 47,
    stunDamage: 2,
    rewards: [[ItemIds.COINS, 30]],
  },
  {
    name: "Paladin",
    petBase: 127056,
    level: 70,
    xp: 152,
    stunDamage: 3,
    rewards: [[ItemIds.COINS, 80], [ItemIds.CHAOS_RUNE, 2]],
  },
  {
    name: "Gnome",
    petBase: 108718,
    level: 75,
    xp: 199,
    stunDamage: 1,
    rewards: [[ItemIds.COINS, 300], [ItemIds.GOLD_ORE, 1], [ItemIds.EARTH_RUNE, 1]],
  },
];

const PICKPOCKET_BY_NAME = new Map(PICKPOCKETS.map((entry) => [entry.name, entry]));
PICKPOCKET_BY_NAME.set("Woman", PICKPOCKET_BY_NAME.get("Man"));

const STALLS = new Map([
  ["Bakery stall", { petBase: 124066, level: 5, xp: 16, rewards: [[ItemIds.COINS, 20]] }],
  ["Silk stall", { petBase: 68926, level: 20, xp: 24, rewards: [[ItemIds.COINS, 60]] }],
  ["Tea stall", { petBase: 68926, level: 5, xp: 16, rewards: [[ItemIds.COINS, 20]] }],
  ["Fur stall", { petBase: 36490, level: 35, xp: 36, rewards: [[ItemIds.COINS, 100]] }],
  ["Gem stall", { petBase: 36490, level: 75, xp: 160, rewards: [[ItemIds.UNCUT_SAPPHIRE, 1], [ItemIds.UNCUT_EMERALD, 1]] }],
  ["Seed Stall", { petBase: 36490, level: 27, xp: 10, rewards: [[ItemIds.POTATO_SEED, 1], [ItemIds.ONION_SEED, 1]] }],
]);

STALLS.set("Baker's stall", STALLS.get("Bakery stall"));
STALLS.set("Baker's Stall", STALLS.get("Bakery stall"));
STALLS.set("Gem Stall", STALLS.get("Gem stall"));

function randomReward(rewards) {
  const [itemId, maxAmount] = rewards[Math.floor(Math.random() * rewards.length)];
  const amount = Math.max(1, Math.floor(Math.random() * maxAmount) + 1);
  return new Item(itemId, amount);
}

function pickpocketSucceeded(player, def) {
  const level = player.getSkillManager().getCurrentLevel(Skill.THIEVING);
  const factor = Math.floor(Math.random() * (level + 5));
  const fluke = Math.floor(Math.random() * (def.level + 1));
  return factor > fluke;
}

let TaskManager;
let CombatFactory;
let pluginApi;

function handleStealFromStall(event) {
  const stall = STALLS.get(event.definition.getName());
  if (!stall) {
    return;
  }

  const player = event.player;
  if (player.getSkillManager().getCurrentLevel(Skill.THIEVING) < stall.level) {
    player.sendMessage(`You need a Thieving level of at least ${stall.level} to do this.`);
    event.handled = true;
    return;
  }
  if (!player.getClickDelay().elapsedTime(1000)) {
    event.handled = true;
    return;
  }
  if (player.getInventory().isFull()) {
    player.getInventory().full();
    event.handled = true;
    return;
  }

  player.getClickDelay().reset();
  player.setPositionToFace(event.object.getLocation());
  player.performAnimation(THIEVING_ANIMATION);
  const reward = randomReward(stall.rewards);
  player.getInventory().addItem(reward);
  player.getSkillManager().addExperiences(Skill.THIEVING, stall.xp);
  player.sendMessage(`You steal ${reward.getAmount()} x ${reward.getDefinition().getName()}.`);
  pluginApi.emitCustomEvent("thieving:success", { player, skill: Skill.THIEVING, petBase: stall.petBase });
  event.handled = true;
}

/** The attempt message goes out on the click; the animation and the outcome follow a tick later. */
class PickpocketTask extends Task {
  constructor(player, npc, name, def) {
    super(1, player.getIndex());
    this.player = player;
    this.npc = npc;
    this.name = name;
    this.def = def;
  }

  execute() {
    this.stop();
    const { player, npc } = this;
    if (!player.isRegistered() || !npc.isRegistered() || player.getHitpoints() <= 0) return;
    player.performAnimation(THIEVING_ANIMATION);
    resolvePickpocket(player, npc, this.name, this.def);
  }
}

function resolvePickpocket(player, npc, name, def) {
  if (pickpocketSucceeded(player, def)) {
    const loot = randomReward(def.rewards);
    player.getInventory().addItem(loot);
    player.sendMessage(`You pick the ${name}'s pocket.`);
    player.getSkillManager().addExperiences(Skill.THIEVING, def.xp);
    pluginApi.emitCustomEvent("thieving:success", { player, skill: Skill.THIEVING, petBase: def.petBase });
    return;
  }

  if (ArceuusSpells.hasShadowVeil(player) && Math.random() < 0.15) {
    player.sendMessage("Your shadow veil prevents you from being noticed.");
    return;
  }

  npc.setPositionToFace(player.getLocation());
  npc.forceChat("What do you think you're doing?");
  npc.performAnimation(new Animation(npc.getAttackAnim()));
  player.sendMessage(`You fail to pickpocket the ${name}.`);
  Sounds.sendSound(player, Sound.THIEVING_STUNNED);
  CombatFactory.stunTicks(player, PICKPOCKET_STUN_TICKS, true);
  player
    .getCombat()
    .getHitQueue()
    .addPendingDamage([new HitDamage(def.stunDamage, HitMask.RED)]);
}

function pickpocket(event) {
  const { player, npc } = event;
  const def = PICKPOCKET_BY_NAME.get(event.definition.getName());
  if (!def) {
    return;
  }

  if (!player.getClickDelay().elapsedTime(PICKPOCKET_COOLDOWN_MS)) {
    event.handled = true;
    return;
  }
  if (player.getSkillManager().getCurrentLevel(Skill.THIEVING) < def.level) {
    player.sendMessage(`You need a Thieving level of at least ${def.level} to do this.`);
    event.handled = true;
    return;
  }
  // The stun's last tick still holds the player in place but no longer stops a pickpocket.
  if (player.getTimers().getTicks(TimerKey.STUN) > PICKPOCKET_STUN_TICKS - PICKPOCKET_STUN_LOCK_TICKS) {
    event.handled = true;
    return;
  }
  if (CombatFactory.inCombat(player)) {
    player.sendMessage("You must wait a few seconds after being in combat to do this.");
    event.handled = true;
    return;
  }
  if (CombatFactory.inCombat(npc)) {
    player.sendMessage("That npc is currently in combat and cannot be pickpocketed.");
    event.handled = true;
    return;
  }
  if (player.getInventory().isFull()) {
    player.getInventory().full();
    event.handled = true;
    return;
  }

  // The attempt message goes out on the click; the animation and the outcome (experience and loot,
  // or the stun) come together on the next tick. Wiki (Pickpocketing): NPCs may be pickpocketed
  // every two ticks.
  player.getMovementQueue().reset();
  player.setPositionToFace(npc.getLocation());
  const name = event.definition.getName().toLowerCase();
  player.sendMessage(`You attempt to pick the ${name}'s pocket.`);
  player.getClickDelay().reset();
  npc.getTimers().registers(TimerKey.ATTACK_IMMUNITY, 10);
  TaskManager.submit(new PickpocketTask(player, npc, name, def));

  event.handled = true;
}

module.exports = {
  name: "Thieving",
  members: true,
  register(api) {
    pluginApi = api;
    TaskManager = api.getTaskManager();
    CombatFactory = api.getCombatFactory();
    for (const name of PICKPOCKET_BY_NAME.keys()) {
      api.onNpcInteraction(name, { Pickpocket: pickpocket });
    }

    for (const name of STALLS.keys()) {
      api.onObjectInteraction(name, { [name === "Seed Stall" ? "Steal from" : "Steal-from"]: handleStealFromStall });
    }

    api.log("registered", {
      pickpocketNames: PICKPOCKET_BY_NAME.size,
      stallNames: STALLS.size,
    });
  },
};

module.exports._test = { pickpocket };
