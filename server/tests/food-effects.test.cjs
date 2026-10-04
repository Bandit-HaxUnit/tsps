// Run after `yarn build`: node --test tests/food-effects.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { ItemIds } = require("../dist/util/IdEnums");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");
const Food = require("../plugins/items/Food.plugin");

test("strawberries heal 1 + 6% of max hitpoints, capped at six", () => {
  assert.equal(Food._test.getStrawberryHeal(10), 1);
  assert.equal(Food._test.getStrawberryHeal(17), 2);
  assert.equal(Food._test.getStrawberryHeal(50), 4);
  assert.equal(Food._test.getStrawberryHeal(84), 6);
  assert.equal(Food._test.getStrawberryHeal(99), 6);
});

test("gnome crunchies and battas are combo foods with their Wiki heals", () => {
  const expected = [
    [ItemIds.WORM_CRUNCHIES, 8],
    [ItemIdentifiers.CHOCCHIP_CRUNCHIES, 7],
    [ItemIdentifiers.SPICY_CRUNCHIES, 7],
    [ItemIdentifiers.TOAD_CRUNCHIES, 8],
    [ItemIdentifiers.WORM_BATTA, 11],
    [ItemIdentifiers.TOAD_BATTA, 11],
    [ItemIdentifiers.CHEESE_TOM_BATTA, 11],
    [ItemIdentifiers.FRUIT_BATTA, 11],
    [ItemIdentifiers.VEGETABLE_BATTA, 11],
  ];
  for (const [id, heal] of expected) {
    const food = Food.FOOD.get(id);
    assert.ok(food, `food ${id} registered`);
    assert.equal(food.heal, heal, `food ${id} heal`);
    assert.equal(food.karambwan, true, `food ${id} is combo food`);
  }
});
