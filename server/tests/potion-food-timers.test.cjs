// Run after `yarn build`: node --test tests/potion-food-timers.test.cjs
// Wiki (Potion, Barbarian Herblore): ordinary potions and food run on separate timers (a combo
// food still starts the potion timer); a barbarian mix is drunk on the food timer and delays the next attack like food.
// rsprox recordings 1093, 3224 and 4288 (a manta ray and a super restore on one tick).
const assert = require("node:assert/strict");
const path = require("path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");
const { Item } = require("../dist/game/model/Item");
const { World } = require("../dist/game/World");
const { TimerKey } = require("../dist/util/timers/TimerKey");
const { PluginManager } = require("../dist/plugins/PluginManager");
const Potions = require("../plugins/items/Potions.plugin");
const Food = require("../plugins/items/Food.plugin");

let core, drink, eatHandler;
before(async () => {
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  const api = (hooks) => new Proxy({}, {
    get: (_, key) => key === "core" ? core : key === "emitCanEat" || key === "emitCanDrink" ? () => true
      : (...args) => hooks(key, args),
  });
  Potions.register(api((key, args) => {
    if (key === "onItemFirstAction") drink = args[0];
  }));
  Food.register(api((key, args) => {
    if (key === "onItemAction") eatHandler = args[0];
  }));
});

function player(items) {
  const { Player } = require("../dist/game/entity/impl/player/Player");
  const p = new Player(null);
  const sender = new Proxy({}, { get: () => () => sender });
  p.getPacketSender = () => sender;
  p.sendMessage = () => {};
  items.forEach((id, slot) => p.getInventory().setItem(slot, new Item(id, 1)));
  return p;
}

const sip = (p, slot) => drink({ player: p, itemId: p.getInventory().getItems()[slot].getId(), slot });
const eat = (p, slot) => eatHandler({ player: p, itemId: p.getInventory().getItems()[slot].getId(), slot, clickType: 1 });
const slotId = (p, slot) => {
  const id = p.getInventory().getItems()[slot]?.getId();
  return id === -1 ? undefined : id;
};

test("a potion and a manta ray on one tick both go through, as recorded", () => {
  const p = player([ItemIdentifiers.SUPER_RESTORE_4_, ItemIdentifiers.MANTA_RAY]);
  eat(p, 1);
  sip(p, 0);
  assert.equal(slotId(p, 0), ItemIdentifiers.SUPER_RESTORE_3_, "the dose was drunk");
  assert.equal(p.getTimers().has(TimerKey.POTION), true, "and the potion timer runs");
});

test("a potion does not block eating, nor food a potion", () => {
  const p = player([ItemIdentifiers.SARADOMIN_BREW_4_, ItemIdentifiers.SHARK, ItemIdentifiers.SUPER_RESTORE_4_]);
  sip(p, 0);
  eat(p, 1);
  assert.equal(slotId(p, 1), undefined, "the shark was eaten on the tick of the brew");
  assert.equal(p.getTimers().has(TimerKey.FOOD), true, "the shark starts the food timer");
  sip(p, 2);
  assert.equal(slotId(p, 2), ItemIdentifiers.SUPER_RESTORE_4_, "the second potion waits on the potion timer");
});

test("a potion alone leaves the food timer free", () => {
  const p = player([ItemIdentifiers.SUPER_RESTORE_4_]);
  sip(p, 0);
  assert.equal(p.getTimers().has(TimerKey.POTION), true);
  assert.equal(p.getTimers().has(TimerKey.FOOD), false);
});

test("a karambwan still blocks a potion afterwards, but follows a potion", () => {
  const p = player([ItemIdentifiers.SARADOMIN_BREW_4_, ItemIdentifiers.COOKED_KARAMBWAN]);
  sip(p, 0);
  eat(p, 1);
  assert.equal(slotId(p, 1), undefined, "the karambwan was eaten after the brew");
  const q = player([ItemIdentifiers.SHARK, ItemIdentifiers.COOKED_KARAMBWAN, ItemIdentifiers.SUPER_RESTORE_4_]);
  eat(q, 0);
  eat(q, 1);
  sip(q, 2);
  assert.equal(slotId(q, 2), ItemIdentifiers.SUPER_RESTORE_4_, "shark, karambwan, potion: the potion is refused");
});

test("a barbarian mix is drunk on the food timer and delays the next attack like food", () => {
  World.processCycle = 1000;
  const p = player([ItemIdentifiers.SUPER_RESTORE_MIX_2_, ItemIdentifiers.SHARK, ItemIdentifiers.SUPER_RESTORE_MIX_2_]);
  p.getCombat().setAttackDelay(4);
  sip(p, 0);
  assert.equal(slotId(p, 0), ItemIdentifiers.SUPER_RESTORE_MIX_1_, "the mix was drunk");
  assert.equal(p.getTimers().has(TimerKey.FOOD), true, "on the food timer");
  assert.equal(p.getCombat().getAttackDelay(), 7, "adding 3 ticks like food");
  eat(p, 1);
  assert.equal(slotId(p, 1), ItemIdentifiers.SHARK, "food waits on a mix");
  sip(p, 2);
  assert.equal(slotId(p, 2), ItemIdentifiers.SUPER_RESTORE_MIX_2_, "a mix waits on the food timer");
});

test("food blocks a barbarian mix, but not an ordinary potion", () => {
  const p = player([ItemIdentifiers.SHARK, ItemIdentifiers.SUPER_RESTORE_MIX_2_, ItemIdentifiers.SUPER_RESTORE_4_]);
  eat(p, 0);
  sip(p, 1);
  assert.equal(slotId(p, 1), ItemIdentifiers.SUPER_RESTORE_MIX_2_, "the mix waits");
  sip(p, 2);
  assert.equal(slotId(p, 2), ItemIdentifiers.SUPER_RESTORE_3_, "the potion does not");
});
