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
