// Run after `yarn build`: node --test tests/giantsoul-amulet.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { PluginManager } = require('../dist/plugins/PluginManager');
const Giantsoul = require('../plugins/items/GiantsoulAmulet.plugin');

const core = PluginManager.getCoreApi();
const { Item, ItemIdentifiers: I } = core;
const prompts = [];
Giantsoul.register(new Proxy({
  core,
  sendMultiChatboxPrompt: (player, title, ...pairs) => prompts.push({ title, pairs }),
}, { get: (object, key) => object[key] ?? (() => {}) }));

function fakePlayer(carried = {}) {
  const items = new Map(Object.entries(carried).map(([id, amount]) => [Number(id), amount]));
  const messages = [];
  const player = {
    messages,
    sendMessage: (message) => messages.push(message),
    getInventory: () => ({
      getAmount: (id) => items.get(id) ?? 0,
      deleteNumber: (id, amount) => items.set(id, (items.get(id) ?? 0) - amount),
      refreshItems() {},
    }),
    getEquipment: () => ({ refreshItems() {} }),
    setEnteredAmountAction: (action) => { player.amountAction = action; },
    getPacketSender: () => ({ sendEnterAmountPrompt: (title) => { player.amountPrompt = title; }, sendInterfaceRemoval() {} }),
    carried: (id) => items.get(id) ?? 0,
  };
  return player;
}

const amulet = (charges) => {
  const item = new Item(charges ? I.GIANTSOUL_AMULET : I.GIANTSOUL_AMULET_UNCHARGED_, 1);
  if (charges) item.setMetaValue(Giantsoul.CHARGES_META_KEY, charges);
  return item;
};
const use = (player, item, otherId) => {
  const event = { player, usedItem: new Item(otherId, 1), usedItemId: otherId, usedWithItem: item, usedWithItemId: item.getId(), handled: false };
  Giantsoul._test.chargeWithItems(event);
  return event.handled;
};

test('one big bone and one law rune charge the uncharged amulet (transcript)', () => {
  const player = fakePlayer({ [I.BIG_BONES]: 1, [I.LAW_RUNE]: 5 });
  const item = amulet(0);
  assert.equal(use(player, item, I.LAW_RUNE), true);
  assert.equal(item.getId(), I.GIANTSOUL_AMULET);
  assert.equal(Giantsoul._test.charges(item), 1);
  assert.deepEqual([player.carried(I.BIG_BONES), player.carried(I.LAW_RUNE)], [0, 4]);
  assert.equal(player.messages.at(-1), 'You add 1 charge to your Giantsoul amulet, giving it a total of 1 charge.');
});

test('several sets ask how many, noted bones count, and the room caps it', () => {
  const player = fakePlayer({ [I.BIG_BONES]: 2, [I.BIG_BONES_2]: 10, [I.LAW_RUNE]: 8 });
  const item = amulet(Giantsoul.MAX_CHARGES - 5);
  assert.equal(use(player, item, I.BIG_BONES_2), true);
  assert.equal(player.amountPrompt, 'How many charges would you like to add? (0 - 5)');
  player.amountAction.execute(9);
  assert.equal(Giantsoul._test.charges(item), Giantsoul.MAX_CHARGES);
  assert.deepEqual([player.carried(I.BIG_BONES), player.carried(I.BIG_BONES_2), player.carried(I.LAW_RUNE)], [0, 7, 3]);
  assert.equal(player.messages.at(-1), 'You add 5 charges to your Giantsoul amulet, giving it a total of 16,000 charges.');
});

test('charging without both items says what it needs', () => {
  const player = fakePlayer({ [I.BIG_BONES]: 3 });
  const item = amulet(0);
  assert.equal(use(player, item, I.BIG_BONES), true);
  assert.equal(item.getId(), I.GIANTSOUL_AMULET_UNCHARGED_);
  assert.equal(player.messages.at(-1), 'You need 1 law rune and 1 big bone to charge the Giantsoul amulet.');
  assert.equal(use(player, item, I.SHARK), false, 'other items are left alone');
});

test("Rub offers the three lairs and Nowhere; worn options go straight there", (t) => {
  const arrivals = [];
  t.mock.method(core.TeleportHandler, 'checkReqs', () => true);
  t.mock.method(core.TeleportHandler, 'teleport', (player, target, type, warn, onArrival) => { arrivals.push([target.getX(), target.getY()]); onArrival(); });
  const player = fakePlayer();
  const item = amulet(2);
  const event = (option) => ({ player, item, itemId: item.getId(), option, handled: false });
  const rub = event('Rub');
  Giantsoul._test.itemAction(rub);
  assert.equal(rub.handled, true);
  const prompt = prompts.at(-1);
  assert.equal(prompt.title, 'Where would you like to teleport to?');
  assert.deepEqual(prompt.pairs.filter((entry) => typeof entry === 'string'), ["Bryophyta's lair", "Obor's lair", "Branda and Eldric's lair", 'Nowhere']);
  prompt.pairs[5]();
  assert.deepEqual(arrivals.at(-1), [2950, 9574], "the titans' entrance tunnel");
  assert.equal(Giantsoul._test.charges(item), 1);
  Giantsoul._test.itemAction(event('Obor'));
  assert.deepEqual(arrivals.at(-1), [3095, 9833]);
  assert.equal(item.getId(), I.GIANTSOUL_AMULET_UNCHARGED_, 'the last charge leaves it uncharged');
  assert.equal(player.messages.at(-1), 'You have no remaining charges in your Giantsoul amulet.');
});

test('Check reads the charges left', () => {
  const player = fakePlayer();
  const item = amulet(1234);
  Giantsoul._test.itemAction({ player, item, itemId: item.getId(), option: 'Check', handled: false });
  assert.equal(player.messages.at(-1), 'Your Giantsoul amulet has 1,234 charges left powering it.');
});

test('the amulet is kept beyond the kept items on a death in the titans fight (Wiki)', () => {
  const Area = require('../plugins/bosses/royaltitans/Area.RoyalTitans');
  Area.attach(new Proxy({ core: { ...core, Area: class {} } }, { get: (object, key) => object[key] ?? (() => {}) }));
  const fighter = {}, outside = {};
  Area.sessions.set('test', { players: [fighter] });
  const keep = (player, id) => {
    const event = { player, item: new Item(id, 1), keep: null };
    Area._test.keepGiantsoul(event);
    return event.keep;
  };
  assert.equal(keep(fighter, I.GIANTSOUL_AMULET), true);
  assert.equal(keep(fighter, I.GIANTSOUL_AMULET_UNCHARGED_), true);
  assert.equal(keep(fighter, I.SHARK), null);
  assert.equal(keep(outside, I.GIANTSOUL_AMULET), null);
  Area.sessions.delete('test');
});
