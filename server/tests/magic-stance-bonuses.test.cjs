// Run after `yarn build`: node --test tests/magic-stance-bonuses.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { World } = require('../dist/game/World');
const { AccuracyFormulasDpsCalc } = require('../dist/game/content/combat/formula/AccuracyFormulasDpsCalc');
const { FightType } = require('../dist/game/content/combat/FightType');
const { BonusManager } = require('../dist/game/model/equipment/BonusManager');

let cycle = 1;

/** A 99 Magic, 99 Defence player with no gear and no prayers. */
function caster(fightType, { autocasting = false } = {}) {
    World.processCycle = cycle++; // a fresh roll cache per case
    const player = {
        isPlayer: () => true,
        isNpc: () => false,
        getAsPlayer: () => player,
        isSpecialActivated: () => false,
        getPrayerActive: () => new Array(40).fill(false),
        getSkillManager: () => ({ getCurrentLevel: () => 99 }),
        getFightType: () => fightType,
        getCombat: () => ({ getAutocastSpell: () => (autocasting ? {} : null), getSelectedSpell: () => null }),
        getEquipment: () => ({ getItems: () => new Array(14).fill({ getId: () => -1 }) }),
        getBonusManager: () => ({
            getAttackBonus: () => [0, 0, 0, 0, 0],
            getDefenceBonus: () => [0, 0, 0, 0, 0],
        }),
    };
    return player;
}

const magicLevel = (player) => AccuracyFormulasDpsCalc.attackMagicRoll(player) / 64;
const magicDefenceLevel = (player) => AccuracyFormulasDpsCalc.defenseMagicRoll(player) / 64;

test('a powered staff on Accurate casts 2 levels more accurately', () => {
    assert.equal(FightType.POWERED_STAFF_ACCURATE.getBonusType(), BonusManager.ATTACK_MAGIC);
    assert.equal(magicLevel(caster(FightType.POWERED_STAFF_LONGRANGE)), 99 + 9);
    assert.equal(magicLevel(caster(FightType.POWERED_STAFF_ACCURATE)), 99 + 11);
    assert.equal(magicLevel(caster(FightType.STAFF_BASH, { autocasting: true })), 99 + 9,
        'a staff left on Bash gets nothing for spells');
});

test('autocasting gives no invisible Defence; Longrange gives 3', () => {
    assert.equal(AccuracyFormulasDpsCalc.effectiveDefenseLevel(caster(FightType.STAFF_FOCUS)), 99 + 3 + 8);
    assert.equal(
        AccuracyFormulasDpsCalc.effectiveDefenseLevel(caster(FightType.STAFF_FOCUS, { autocasting: true })),
        99 + 8,
    );
    assert.equal(AccuracyFormulasDpsCalc.effectiveDefenseLevel(caster(FightType.POWERED_STAFF_LONGRANGE)), 99 + 3 + 8);
});

test('magic defence takes 70% Magic and 30% Defence, each rounded down, plus the stance', () => {
    // floor(99 * 0.7) + floor(99 * 0.3) + 8 = 69 + 29 + 8
    assert.equal(magicDefenceLevel(caster(FightType.STAFF_BASH, { autocasting: true })), 106);
    assert.equal(magicDefenceLevel(caster(FightType.POWERED_STAFF_LONGRANGE)), 109);
});

test('the autocast selector gets the spellbook\'s list: the Slayer\'s staff\'s own on standard, Arceuus on Arceuus', () => {
    const { Autocasting } = require('../dist/game/content/combat/magic/Autocasting');
    const { MagicSpellbook } = require('../dist/game/model/MagicSpellbook');
    const { CombatSpells } = require('../dist/game/content/combat/magic/CombatSpells');
    const { ItemIdentifiers: Items } = require('../dist/util/ItemIdentifiers');
    // Varp 664 (cache scripts 2098/243): -1 standard, 4170 the Slayer's staff, 9013 Arceuus.
    assert.equal(Autocasting.selectorList(MagicSpellbook.NORMAL, Items.STAFF_OF_FIRE), -1);
    assert.equal(Autocasting.selectorList(MagicSpellbook.NORMAL, Items.SLAYERS_STAFF), 4170);
    assert.equal(Autocasting.selectorList(MagicSpellbook.NORMAL, Items.SLAYERS_STAFF_E_), 4170, 'the (e) has no entry of its own');
    assert.equal(Autocasting.selectorList(MagicSpellbook.ARCEUUS, Items.SLAYERS_STAFF), 9013);
    assert.equal(Autocasting.selectorList(MagicSpellbook.ARCEUUS, Items.SLAYERS_STAFF_E_), 9013);
    assert.equal(Autocasting.selectorList(MagicSpellbook.ANCIENT, Items.ANCIENT_STAFF), Items.ANCIENT_STAFF);
    // Wiki (Autocast): who may autocast Arceuus spells.
    for (const name of ["Slayer's staff", "Slayer's staff (e)", "Skull sceptre (i)", "Ahrim's staff 75", "Kodai wand", "Toxic staff of the dead"]) {
        assert.ok(Autocasting.canAutocastArceuus(name), name);
    }
    for (const name of ['Staff of fire', 'Ancient staff', 'Trident of the seas']) assert.ok(!Autocasting.canAutocastArceuus(name), name);
    // The selector's Arceuus slots: 53-55 the top row (demonbanes), 56-58 the bottom (grasps),
    // as cache script 4133 lays them out, enum 1986's icons and the Wiki's picture show.
    assert.deepEqual([53, 54, 55, 56, 57, 58].map((slot) => Autocasting.autocastSpell(slot)), [
        CombatSpells.INFERIOR_DEMONBANE, CombatSpells.SUPERIOR_DEMONBANE, CombatSpells.DARK_DEMONBANE,
        CombatSpells.GHOSTLY_GRASP, CombatSpells.SKELETAL_GRASP, CombatSpells.UNDEAD_GRASP,
    ]);
    // Each slot's icon in cache enum 1986 is that spell's own id.
    assert.deepEqual([53, 54, 55, 56, 57, 58].map((slot) => Autocasting.autocastSpell(slot).spellId()),
        [20398, 20399, 20400, 21826, 21829, 21832]);
});

test('the Slayer\'s staff (e) is a staff, as the plain one is', () => {
    const { CachePipeline } = require('../dist/game/cache/CachePipeline');
    const { ItemDefinition } = require('../dist/game/definition/ItemDefinition');
    const { WeaponInterfaces } = require('../dist/game/content/combat/WeaponInterfaces');
    const { ItemIdentifiers: Items } = require('../dist/util/ItemIdentifiers');
    CachePipeline.initialize();
    require('../plugins/items/ItemDefinitionLoader.plugin').register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });
    assert.equal(ItemDefinition.forId(Items.SLAYERS_STAFF_E_).getWeaponInterface(), WeaponInterfaces.STAFF);
    assert.equal(ItemDefinition.forId(Items.SLAYERS_STAFF).getWeaponInterface(), WeaponInterfaces.STAFF);
});
