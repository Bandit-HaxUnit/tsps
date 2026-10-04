// Run after `yarn build`: node --test tests/pets.test.cjs
const assert = require("node:assert/strict");
const { test, beforeEach } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
require("../dist/game/cache/CachePipeline").CachePipeline.initialize();

const { Skill } = require("../dist/game/model/Skill");
const { Location } = require("../dist/game/model/Location");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");
const { NpcIdentifiers } = require("../dist/util/NpcIdentifiers");

const events = new Map();
const broadcasts = [];
const loginHooks = [];
const logoutHooks = [];
const collectionLogSnapshots = [];
const npcApi = {};
const world = {
  sendMessage: (message) => broadcasts.push(message),
  getNpcs: () => npcApi,
  getAddNPCQueue: () => npcApi.addQueue,
  getRemoveNPCQueue: () => npcApi.removeQueue,
};
npcApi.add = () => false;
npcApi.get = () => null;
npcApi.addQueue = [];
npcApi.removeQueue = [];

const Pets = require("../plugins/npcs/Pets.plugin");
Pets.register({
  core: { ItemIdentifiers, NpcIdentifiers },
  getWorld: () => world,
  getRegionManager: () => ({ blocked: () => true }),
  getItemOnGroundManager: () => ({ registerNonGlobal() {}, registerLocation() {} }),
  persistAttribute() {},
  onCustomEvent: (name, handler) => events.set(name, handler),
  onItemDropPolicy() {},
  onAnyNpcInteraction() {},
  onNpcClick() {},
  onPlayerLogout: (handler) => logoutHooks.push(handler),
  onPlayerDisconnect() {},
  onPlayerLogin: (handler) => loginHooks.push(handler),
  log() {},
});

const GIANT_SQUIRREL = 20659;
const AIR_RIFT_GUARDIAN = 20667;
const BLOOD_RIFT_GUARDIAN = 20691;
const HELLPUPPY = 13247;
const SNAKELING_ITEM = 12921;

/** A player whose follower is already out, so awards land in the backpack. */
function createPlayer({ level = 99, xp = 13034431 } = {}) {
  const attributes = new Map([["pets:current", { isRegistered: () => true, getId: () => -1 }]]);
  const inventory = [];
  const messages = [];
  return {
    messages,
    inventory,
    getUsername: () => "Tester",
    getIndex: () => 1,
    isPlayerBot: () => false,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getSkillManager: () => ({ getMaxLevel: () => level, getExperience: () => xp }),
    getInventory: () => ({
      isFull: () => inventory.length >= 28,
      adds: (itemId) => inventory.push(itemId),
      deleteNumber: (itemId, amount) => {
        for (let i = 0; i < amount; i++) inventory.splice(inventory.indexOf(itemId), 1);
      },
      contains: (itemId) => inventory.includes(itemId),
    }),
    getBanks: () => [],
    getBank: () => ({ adds: () => true, contains: () => false }),
    getPacketSender: () => ({
      sendConfig() {},
      sendSoundEffect() {},
      sendCollectionLogSnapshot: (slots) => collectionLogSnapshots.push(slots),
    }),
    getArea: () => null,
    getPrivateArea: () => null,
    outterTiles: () => [new Location(1, 1, 0)],
    getLocation: () => new Location(0, 0, 0),
    setPositionToFace() {},
    performAnimation() {},
    getMovementQueue: () => ({ reset() {} }),
    sendMessage: (message) => messages.push(message),
  };
}

function createPetNpc(player, npcId) {
  return {
    id: npcId,
    transformed: undefined,
    isRegistered: () => true,
    isPet: () => true,
    getId() {
      return this.transformed ?? this.id;
    },
    getRealId() {
      return this.id;
    },
    getIndex: () => 7,
    getOwner: () => player,
    setNpcTransformationId(id) {
      this.transformed = id;
    },
  };
}

const realRandom = Math.random;
beforeEach(() => {
  Math.random = realRandom;
  broadcasts.length = 0;
  collectionLogSnapshots.length = 0;
});

test("agility rolls the giant squirrel at 1 in (base - level * 25)", () => {
  const player = createPlayer({ level: 99 });
  let seen;
  Math.random = () => { seen = true; return 1 / (35609 - 99 * 25) - 1e-9; };
  events.get("agility:success")({ player, skill: Skill.AGILITY, petBase: 35609 });
  assert.ok(seen);
  assert.deepEqual(player.inventory, [GIANT_SQUIRREL]);
  assert.match(broadcasts[0], /Giant Squirrel while agility/i);

  Math.random = () => 1 / (35609 - 99 * 25);
  events.get("agility:success")({ player: createPlayer(), skill: Skill.AGILITY, petBase: 35609 });
  assert.equal(broadcasts.length, 1);
});

test("an action without a rate never rolls", () => {
  const player = createPlayer();
  Math.random = () => 0;
  events.get("hunter:success")({ player, skill: Skill.HUNTER, npcId: -1 });
  assert.deepEqual(player.inventory, []);
});

test("the rift guardian takes the colour of the rune crafted and rolls per essence", () => {
  const player = createPlayer();
  let rolls = 0;
  Math.random = () => (++rolls === 3 ? 0 : 1);
  events.get("runecrafting:success")({
    player,
    skill: Skill.RUNECRAFTING,
    petBase: 1795758,
    rolls: 3,
    runeId: ItemIdentifiers.AIR_RUNE,
  });
  assert.equal(rolls, 3);
  assert.deepEqual(player.inventory, [AIR_RIFT_GUARDIAN]);
});

test("a second pet of the same skill is a would-have-been-followed miss", () => {
  const player = createPlayer();
  Math.random = () => 0;
  events.get("runecrafting:success")({ player, skill: Skill.RUNECRAFTING, petBase: 1795758, runeId: ItemIdentifiers.AIR_RUNE });
  events.get("runecrafting:success")({ player, skill: Skill.RUNECRAFTING, petBase: 804984, runeId: ItemIdentifiers.BLOOD_RUNE });
  assert.deepEqual(player.inventory, [AIR_RIFT_GUARDIAN]);
  assert.ok(!player.inventory.includes(BLOOD_RIFT_GUARDIAN));
  assert.equal(player.messages.at(-1), "You have a funny feeling like you would have been followed...");
});

test("a boss pet drop goes to the killer, not the floor", () => {
  const player = createPlayer();
  const drops = [{ itemId: ItemIdentifiers.BONES, amount: 1 }, { itemId: HELLPUPPY, amount: 1 }];
  events.get("npc-drops:roll")({ player, drops });
  assert.deepEqual(drops.map((drop) => drop.itemId), [ItemIdentifiers.BONES]);
  assert.deepEqual(player.inventory, [HELLPUPPY]);
  assert.deepEqual(player.getAttribute("pets.owned"), [HELLPUPPY]);
});

test("the collection log snapshot ticks every owned pet item", () => {
  const player = createPlayer();
  player.setAttribute("pets.owned", [HELLPUPPY, GIANT_SQUIRREL]);
  events.get("npc-drops:roll")({ player, drops: [{ id: 12921, amount: 1 }] });
  const last = collectionLogSnapshots.at(-1);
  assert.deepEqual(last, [
    { slot: 0, itemId: HELLPUPPY, quantity: 1 },
    { slot: 1, itemId: GIANT_SQUIRREL, quantity: 1 },
    { slot: 2, itemId: SNAKELING_ITEM, quantity: 1 },
  ]);
});

test("Probita returns owned pets the player no longer has, once", () => {
  const player = createPlayer();
  player.setAttribute("pets.owned", [HELLPUPPY, GIANT_SQUIRREL]);
  player.inventory.push(GIANT_SQUIRREL);
  const reclaim = () => {
    const event = { player, npcId: NpcIdentifiers.PROBITA, action: "open_interface", target: "Pet Insurance" };
    events.get("npc-dialogue:action")(event);
    return event;
  };
  assert.equal(reclaim().handled, true);
  assert.deepEqual(player.inventory, [GIANT_SQUIRREL, HELLPUPPY]);
  reclaim();
  assert.deepEqual(player.inventory, [GIANT_SQUIRREL, HELLPUPPY]);
  assert.equal(player.messages.at(-1), "You don't have any pets to reclaim.");
});

test("every skilling-pet collection log item has a roll source", () => {
  const log = require("../../client/common/collectionlog/collection-log.json");
  const skilling = log.categories.find((category) => category.structId === 529)?.itemIds ?? [];
  assert.ok(skilling.length > 0, "the Skilling Pets collection log category is empty");
  const rollable = new Set(Pets.__internals.PETS.filter((pet) => pet.skill != null).map((pet) => pet.itemId));
  for (const itemId of skilling) {
    assert.ok(rollable.has(itemId), `collection log item ${itemId} has no skilling roll source`);
  }
});

test("every metamorphosis cycle stays inside the pet's family", () => {
  const { PETS, PET_BY_ID, petFamily } = Pets.__internals;
  for (const pet of PETS) {
    if (pet.morphId === 0) continue;
    const next = PET_BY_ID.get(pet.morphId);
    assert.ok(next, `${pet.enumName} morphs to unknown npc ${pet.morphId}`);
    assert.equal(petFamily(next), petFamily(pet), `${pet.enumName} morphs outside its family`);
  }
});

test("metamorphosis cycles one step and stores the chosen variant", () => {
  const player = createPlayer();
  const npc = createPetNpc(player, 2130);
  player.setAttribute("pets:current", npc);

  assert.equal(Pets.__internals.morph(player, npc), true);
  assert.equal(npc.transformed, 2131);
  assert.deepEqual(player.getAttribute("pets:variant"), { "item:12921": 2131 });

  assert.equal(Pets.__internals.morph(player, npc), true);
  assert.equal(npc.transformed, 2132);

  assert.equal(Pets.__internals.morph(player, npc), true);
  assert.equal(npc.transformed, 2130);
  assert.deepEqual(player.getAttribute("pets:variant"), { "item:12921": 2130 });
});

test("a pet with no metamorphosis cycle refuses to morph", () => {
  const player = createPlayer();
  const npc = createPetNpc(player, 6717);
  player.setAttribute("pets:current", npc);
  assert.equal(Pets.__internals.morph(player, npc), false);
  assert.equal(npc.transformed, undefined);
  assert.equal(player.getAttribute("pets:variant"), undefined);
});

test("the stored variant is re-applied to a freshly summoned follower", () => {
  const player = createPlayer();
  player.setAttribute("pets:variant", { "item:12921": 2132 });
  const pet = Pets.__internals.PET_BY_ITEM_ID.get(SNAKELING_ITEM);
  const npc = createPetNpc(player, 2130);
  Pets.__internals.applyStoredVariant(player, npc, pet);
  assert.equal(npc.transformed, 2132);
});

test("a cross-item morph keeps one ownership record and ticks the base log item", () => {
  const player = createPlayer();
  const npc = createPetNpc(player, 7337);
  player.setAttribute("pets:current", npc);
  player.setAttribute("pets.owned", [20665]);
  assert.equal(Pets.__internals.morph(player, npc), true);
  assert.equal(npc.transformed, 7338);
  assert.deepEqual(player.getAttribute("pets:variant"), { "skill:runecrafting": 7338 });
  assert.equal(Pets.__internals.pickup(player, npc), true);
  assert.deepEqual(player.inventory, [20667]);
  assert.deepEqual(player.getAttribute("pets.owned"), [20667]);
  assert.deepEqual(collectionLogSnapshots.at(-1), [{ slot: 0, itemId: 20665, quantity: 1 }]);
});

test("a cached Metamorphosis option dispatches to morph, Talk-to to interact", () => {
  const player = createPlayer();
  const npc = createPetNpc(player, 2130);
  player.setAttribute("pets:current", npc);
  const definition = { getActions: () => ["Talk-to", null, "Pick-up", "Metamorphosis", null] };

  assert.equal(Pets.__internals.handlePetClick({ player, npc, npcId: 2130, clickType: 4, definition }), true);
  assert.equal(npc.transformed, 2131);
  assert.equal(Pets.__internals.handlePetClick({ player, npc, npcId: 2130, clickType: 1, definition }), true);
  assert.deepEqual(player.inventory, []);
});

test("a normal logout and login rebuilds exactly one follower from the item", () => {
  const player = createPlayer();
  player.setAttribute("pets:current", undefined);
  player.setAttribute("pets:last", SNAKELING_ITEM);
  player.inventory.push(SNAKELING_ITEM);
  const loggedIn = loginHooks[0]({ player });
  assert.equal(loggedIn, undefined);
  assert.deepEqual(player.inventory, []);
  assert.equal(player.getAttribute("pets:last"), SNAKELING_ITEM);
});

test("pickup keeps the follower when the backpack is full", () => {
  const player = createPlayer();
  const npc = createPetNpc(player, 2130);
  player.setAttribute("pets:current", npc);
  for (let i = 0; i < 28; i++) player.inventory.push(995);
  assert.equal(Pets.__internals.pickup(player, npc), true);
  assert.equal(player.getAttribute("pets:current"), npc);
  assert.equal(player.messages.at(-1), "You don't have enough inventory space.");
});
