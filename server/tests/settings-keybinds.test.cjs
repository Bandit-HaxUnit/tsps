// Run after `yarn build`: node --test tests/settings-keybinds.test.cjs
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
const Settings = require('../plugins/interface/Settings.plugin');

const CONTROLS = 3;
const COMBAT_KEY = 4675;
const INVENTORY_KEY = 4678;

function viewing(view) {
  const attributes = new Map([['settings-view', view]]);
  return { getAttribute: (key) => attributes.get(key) };
}

before(async () => {
  await CachePipeline.initialize();
});

test('All Settings > Controls: rows 27-40 are the keybinds (cache enum 1562)', () => {
  assert.equal(Settings.keybindVarbitForRow(viewing(CONTROLS), 27), COMBAT_KEY);
  assert.equal(Settings.keybindVarbitForRow(viewing(CONTROLS), 36), INVENTORY_KEY);
  assert.equal(Settings.keybindVarbitForRow(viewing(CONTROLS), 26), -1, 'the "external keyboard" note');
  assert.equal(Settings.keybindVarbitForRow(viewing(CONTROLS), 41), -1, 'Restore default keybinds');
});

test('the same row in another category is not a keybind', () => {
  assert.equal(Settings.keybindVarbitForRow(viewing(0), 27), -1);
});

test('search results number rows across every category, so the keybinds come after the first three', () => {
  const before = [0, 1, 2].reduce((rows, index) => {
    const category = CacheDefinitions.getStructParams(Number(CacheDefinitions.getEnumValues(422).get(index)));
    return rows + CacheDefinitions.getEnumValues(Number(category.get(745))).size;
  }, 0);
  assert.ok(before + 27 > 63, 'past the old 0..63 transmit range');
  assert.equal(Settings.keybindVarbitForRow(viewing(-1), before + 27), COMBAT_KEY);
  assert.equal(Settings.keybindVarbitForRow(viewing(-1), before + 36), INVENTORY_KEY);
  assert.equal(Settings.keybindVarbitForRow(viewing(-1), 27), -1, 'row 27 of search is not Controls row 27');
});
