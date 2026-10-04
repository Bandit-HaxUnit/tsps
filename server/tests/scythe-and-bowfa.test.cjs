// Run after `yarn build`: node --test tests/scythe-and-bowfa.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { ItemDefinition } = require('../dist/game/definition/ItemDefinition');
const { Equipment } = require('../dist/game/model/container/impl/Equipment');
const { ItemIdentifiers } = require('../dist/util/ItemIdentifiers');
const { RangedWeapon } = require('../dist/game/content/combat/ranged/RangedData');
const { BOW_OF_FAERDHINEN_IDS } = require('../dist/game/content/combat/ranged/CrystalBow');
const Scythe = require('../plugins/items/ScytheOfVitur.plugin');
const CrystalArmour = require('../plugins/combat/effects/CrystalArmour');

const NAMES = new Map();
let nextId = 90000;
function item(name) {
    const id = nextId++;
    NAMES.set(id, name);
    return id;
}
ItemDefinition.forId = (id) => ({ getName: () => NAMES.get(id) ?? '' });

function player(worn) {
    const items = new Array(14).fill(null).map(() => ({ getId: () => -1 }));
    for (const [slot, id] of Object.entries(worn)) items[slot] = { getId: () => id };
    const entity = {
        isPlayer: () => true,
        getAsPlayer: () => entity,
        getEquipment: () => ({ getItems: () => items, get: (slot) => items[slot] }),
    };
    return entity;
}

const npcOfSize = (size) => ({ isNpc: () => true, getAsNpc: () => ({ getSize: () => size }) });

// One registration against a fake core; each swing resets what it records.
let rerolled = [];
let maxHit = 0;
let resolver;
class MeleeCombatMethod {}
class PendingHit {}
Scythe.register({
    core: {
        Equipment,
        ItemDefinition,
        MeleeCombatMethod,
        PendingHit,
        CombatFactory: { applyStyleDamage: (hit, max) => rerolled.push(max) },
        DamageFormulas: { calculateMaxMeleeHit: () => maxHit },
    },
    registerCombatMethodResolver: (r) => { resolver = r; },
});

function swing(target, max) {
    rerolled = [];
    maxHit = max;
    const attacker = player({ [Equipment.WEAPON_SLOT]: SCYTHE });
    const method = resolver.resolve(attacker);
    assert.ok(method, 'a scythe resolves to the scythe method');
    return { hits: method.hits(attacker, target), rerolled };
}

const SCYTHE = item('Scythe of vitur');

test('the scythe hits once per tile of target width, up to three', () => {
    assert.equal(swing(npcOfSize(1), 47).hits.length, 1);
    assert.equal(swing(npcOfSize(2), 47).hits.length, 2);
    assert.equal(swing(npcOfSize(5), 47).hits.length, 3);
});

test('each scythe hit has half the max of the one before, rounded down', () => {
    assert.deepEqual(swing(npcOfSize(3), 47).rerolled, [23, 11], '47 -> 23 -> 11');
    assert.deepEqual(swing(npcOfSize(3), 48).rerolled, [24, 12]);
});

test('every bow of Faerdhinen fires its own arrows, not the ammo slot', () => {
    assert.ok(BOW_OF_FAERDHINEN_IDS.includes(ItemIdentifiers.BOW_OF_FAERDHINEN));
    for (const id of BOW_OF_FAERDHINEN_IDS) {
        const ammo = RangedWeapon.getSelfAmmo(id);
        assert.ok(ammo, `bow ${id} has self ammo`);
        assert.equal(ammo.getItemId(), id);
    }
    assert.equal(RangedWeapon.getSelfAmmo(ItemIdentifiers.BOW_OF_FAERDHINEN_C_).getProjectileId(), 1922);
});

test('crystal armour boosts a crystal bow or bow of Faerdhinen by its pieces', () => {
    const bowfa = item('Bow of faerdhinen (c)');
    const helm = item('Crystal helm');
    const body = item('Crystal body');
    const legs = item('Crystal legs');
    const full = player({
        [Equipment.WEAPON_SLOT]: bowfa,
        [Equipment.HEAD_SLOT]: helm,
        [Equipment.BODY_SLOT]: body,
        [Equipment.LEG_SLOT]: legs,
    });
    assert.equal(CrystalArmour._test.pieces(full), 6);
    assert.equal(CrystalArmour._test.accuracy(full, 20000), 26000, '+30%');
    assert.equal(CrystalArmour._test.damage(full, 40), 46, '+15%');

    const helmOnly = player({ [Equipment.WEAPON_SLOT]: bowfa, [Equipment.HEAD_SLOT]: helm });
    assert.equal(CrystalArmour._test.damage(helmOnly, 40), 41, '+2.5%');

    const gauntletBow = player({ [Equipment.WEAPON_SLOT]: item('Crystal bow (perfected)'), [Equipment.HEAD_SLOT]: helm });
    assert.equal(CrystalArmour._test.pieces(gauntletBow), 0);
});
