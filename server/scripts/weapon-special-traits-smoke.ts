// Side-effect import first: primes the same module load order the other combat
// smoke scripts get for free, avoiding an Autocasting <-> CombatSpells cycle.
import "../src/main/typescript/elvarg/game/content/combat/CombatFactory";
import * as assert from "node:assert/strict";
import { AccuracyFormulasDpsCalc } from "../src/main/typescript/elvarg/game/content/combat/formula/AccuracyFormulasDpsCalc";
import { DamageFormulas } from "../src/main/typescript/elvarg/game/content/combat/formula/DamageFormulas";
import { CombatEquipment } from "../src/main/typescript/elvarg/game/content/combat/CombatEquipment";
import { CombatType } from "../src/main/typescript/elvarg/game/content/combat/CombatType";
import { FightStyle } from "../src/main/typescript/elvarg/game/content/combat/FightStyle";
import { BonusManager } from "../src/main/typescript/elvarg/game/model/equipment/BonusManager";
import { PrayerHandler } from "../src/main/typescript/elvarg/game/content/PrayerHandler";
import { Skill } from "../src/main/typescript/elvarg/game/model/Skill";

/**
 * OSRS accuracy / max-hit reference values.
 *
 * Effective attack/strength:
 *   floor(level * prayerPercent/100) + styleBonus + 8   (styleBonus: accurate/aggressive +3,
 *                                                         controlled +1, otherwise 0)
 * Melee attack roll:   effectiveAttack * (attackBonus + 64)
 * Melee max hit:       floor((effectiveStrength * (strengthBonus + 64) + 320) / 640)
 * Ranged max hit:      floor((effectiveRanged * (rangedStrengthBonus + 64) + 320) / 640)
 * Hit chance (wiki):   att > def  -> 1 - (def + 2) / (2 * (att + 1))
 *                      att <= def -> att / (2 * (def + 1))
 */

const item = (id: number) => ({ getId: () => id });

const emptyEquipment = () => ({ getItems: () => new Array(14).fill(null).map(() => item(0)) });

/** Void pieces: helm + top/robe/gloves, no deflector (3 correct pieces is enough). */
const voidEquipment = (helmet: number) => {
    const items: { getId: () => number }[] = new Array(14).fill(null).map(() => item(0));
    items[0] = item(helmet);
    items[4] = item(8839);
    items[7] = item(8840);
    items[9] = item(8842);
    return { getItems: () => items };
};

const prayers = (...ids: number[]) => {
    const active = new Array(30).fill(false);
    for (const id of ids) active[id] = true;
    return active;
};

interface FakePlayerOptions {
    attack?: number;
    strength?: number;
    ranged?: number;
    magic?: number;
    style?: any;
    bonusType?: number;
    attackBonus?: number[];
    defenceBonus?: number[];
    otherBonus?: number[];
    prayerActive?: boolean[];
    equipment?: any;
    special?: any | null;
    specialActivated?: boolean;
}

/** Shell with just the surface the combat formulas touch. */
const fakePlayer = (opts: FakePlayerOptions = {}): any => {
    const levels: Record<number, number> = {
        [Skill.ATTACK.getIndex()]: opts.attack ?? 1,
        [Skill.STRENGTH.getIndex()]: opts.strength ?? 1,
        [Skill.RANGED.getIndex()]: opts.ranged ?? 1,
        [Skill.MAGIC.getIndex()]: opts.magic ?? 1,
        [Skill.DEFENCE.getIndex()]: 1,
    };
    const player: any = {
        isPlayer: () => true,
        isNpc: () => false,
        getAsPlayer: () => player,
        getAsNpc: () => undefined,
        getSkillManager: () => ({ getCurrentLevel: (skill: any) => levels[skill.getIndex()] ?? 1 }),
        getFightType: () => ({
            getStyle: () => opts.style ?? FightStyle.AGGRESSIVE,
            getBonusType: () => opts.bonusType ?? BonusManager.ATTACK_STAB,
        }),
        getBonusManager: () => ({
            getAttackBonus: () => opts.attackBonus ?? [0, 0, 0, 0, 0],
            getDefenceBonus: () => opts.defenceBonus ?? [0, 0, 0, 0, 0],
            getOtherBonus: () => opts.otherBonus ?? [0, 0, 0, 0],
        }),
        getPrayerActive: () => opts.prayerActive ?? prayers(),
        getEquipment: () => opts.equipment ?? emptyEquipment(),
        isSpecialActivated: () => opts.specialActivated ?? false,
        getCombatSpecial: () => opts.special ?? null,
    };
    return player;
};

const special = (traits: any): any => ({
    getTraits: () => traits,
    getAccuracyMultiplier: () => 1,
    getStrengthMultiplier: () => 1,
});

// 1) Melee attack roll = effectiveAttack * (attackBonus + 64).
// Attack 99, no prayer, aggressive: floor(99*1.00) + 0 + 8 = 107.
assert.equal(
    AccuracyFormulasDpsCalc.attackMeleeRoll(
        fakePlayer({ attack: 99, style: FightStyle.AGGRESSIVE, bonusType: 0, attackBonus: [100, 0, 0, 0, 0] })
    ),
    107 * 164, // 17548
    "melee attack roll, +100 stab"
);

// Piety (+20% attack) + accurate style: floor(99*1.20)=118, +3, +8 = 129.
assert.equal(
    AccuracyFormulasDpsCalc.attackMeleeRoll(
        fakePlayer({
            attack: 99,
            style: FightStyle.ACCURATE,
            bonusType: 0,
            attackBonus: [100, 0, 0, 0, 0],
            prayerActive: prayers(PrayerHandler.PIETY),
        })
    ),
    129 * 164, // 21156
    "melee attack roll, Piety + accurate"
);

// Melee void (+10% accuracy): floor(107 * 1.10) = 117.
assert.equal(
    AccuracyFormulasDpsCalc.attackMeleeRoll(
        fakePlayer({
            attack: 99,
            style: FightStyle.AGGRESSIVE,
            bonusType: 0,
            attackBonus: [100, 0, 0, 0, 0],
            equipment: voidEquipment(CombatEquipment.MELEE_VOID_HELM),
        })
    ),
    117 * 164, // 19188
    "melee attack roll, void"
);

// 2) Hit chance matches the OSRS wiki formula for both branches.
{
    const wiki = (att: number, def: number) =>
        att > def ? 1 - (def + 2) / (2 * (att + 1)) : att / (2 * (def + 1));

    assert.equal(AccuracyFormulasDpsCalc.hitChance(20000, 10000), wiki(20000, 10000));
    assert.equal(AccuracyFormulasDpsCalc.hitChance(5000, 10000), wiki(5000, 10000));
    assert.equal(AccuracyFormulasDpsCalc.hitChance(10000, 10000), wiki(10000, 10000));

    // Independent anchors: 1 - 10002/40002 and 5000/20002.
    assert.ok(Math.abs(AccuracyFormulasDpsCalc.hitChance(20000, 10000) - 30000 / 40002) < 1e-12);
    assert.ok(Math.abs(AccuracyFormulasDpsCalc.hitChance(5000, 10000) - 5000 / 20002) < 1e-12);
}

// 3) Ranged max hit = floor((effectiveRanged * (bonus + 64) + 320) / 640).
// Ranged 99, accurate: floor(99) + 3 + 8 = 110; bonus 0.
assert.equal(DamageFormulas.calculateMaxRangedHit(fakePlayer({ ranged: 99, style: FightStyle.ACCURATE })), 11);

// Rigour: ranged strength prayer 123%; floor(99*1.23)=121, +3, +8 = 132.
assert.equal(
    DamageFormulas.calculateMaxRangedHit(
        fakePlayer({
            ranged: 99,
            style: FightStyle.ACCURATE,
            prayerActive: prayers(PrayerHandler.RIGOUR),
        })
    ),
    13, // floor((132*64 + 320) / 640)
    "ranged max hit, Rigour"
);

// Ranged void (+10% strength): floor(110 * 1.10) = 121.
assert.equal(
    DamageFormulas.calculateMaxRangedHit(
        fakePlayer({
            ranged: 99,
            style: FightStyle.ACCURATE,
            equipment: voidEquipment(CombatEquipment.RANGED_VOID_HELM),
        })
    ),
    12, // floor((121*64 + 320) / 640)
    "ranged max hit, void"
);

// 4) Melee max hit uses the same formula.
// Strength 99, aggressive: floor(99) + 3 + 8 = 110; bonus +100.
assert.equal(
    DamageFormulas.calculateMaxMeleeHit(
        fakePlayer({ strength: 99, style: FightStyle.AGGRESSIVE, otherBonus: [100, 0, 0, 0] })
    ),
    28, // floor((110*164 + 320) / 640)
    "melee max hit, +100 strength"
);

// Piety (+23% strength): floor(99*1.23)=121, +3, +8 = 132.
assert.equal(
    DamageFormulas.calculateMaxMeleeHit(
        fakePlayer({
            strength: 99,
            style: FightStyle.AGGRESSIVE,
            otherBonus: [100, 0, 0, 0],
            prayerActive: prayers(PrayerHandler.PIETY),
        })
    ),
    34, // floor((132*164 + 320) / 640)
    "melee max hit, Piety"
);

// 5) Special accuracy stages floor after every stage.
// Base roll: Attack 99 aggressive, +1 stab -> 107 * 65 = 6955.
const baseAttack = { attack: 99, style: FightStyle.AGGRESSIVE, bonusType: 0, attackBonus: [1, 0, 0, 0, 0] };
assert.equal(
    AccuracyFormulasDpsCalc.attackMeleeRoll(
        fakePlayer({ ...baseAttack, special: special({ accuracyMultiplierStages: [1.25, 1.1] }), specialActivated: true })
    ),
    9562, // floor(floor(6955*1.25)*1.1) = floor(floor(8693.75)*1.1) = floor(9562.3)
    "staged special accuracy"
);
assert.equal(
    AccuracyFormulasDpsCalc.attackMeleeRoll(
        fakePlayer({ ...baseAttack, special: special({ accuracyMultiplier: 1.375 }), specialActivated: true })
    ),
    9563, // floor(6955 * 1.375) = floor(9563.125)
    "one-shot special accuracy differs from staged"
);

// 6) Special damage stages round per stage; maxHitOverride replaces the base max hit.
// Base: Strength 99 aggressive, +91 strength -> floor((110*155 + 320)/640) = 27 at base.
const baseDamage = { strength: 99, style: FightStyle.AGGRESSIVE, otherBonus: [91, 0, 0, 0] };
assert.equal(
    DamageFormulas.calculateMaxMeleeHit(
        fakePlayer({
            ...baseDamage,
            special: special({
                damageMultiplierStages: [1.25, 1.1],
                damageMultiplierStageRounding: ["ceil", "floor"],
            }),
            specialActivated: true,
        })
    ),
    37, // ceil(27*1.25)=34, floor(34*1.1)=37
    "staged special damage with per-stage rounding"
);
assert.equal(
    DamageFormulas.calculateMaxMeleeHit(
        fakePlayer({
            ...baseDamage,
            special: special({ damageMultiplierStages: [1.25, 1.1] }),
            specialActivated: true,
        })
    ),
    36, // floor(27*1.25)=33, floor(33*1.1)=36
    "staged special damage defaults to floor"
);
assert.equal(
    DamageFormulas.calculateMaxMeleeHit(
        fakePlayer({
            strength: 99,
            style: FightStyle.AGGRESSIVE,
            otherBonus: [100, 0, 0, 0],
            special: special({ maxHitOverride: 77 }),
            specialActivated: true,
        })
    ),
    77,
    "special maxHitOverride replaces the base max hit"
);

// 7) specialRolls returns the same attack/defence rolls the individual helpers do.
{
    const npc: any = {
        isPlayer: () => false,
        isNpc: () => true,
        getHitpoints: () => 100,
        getAsNpc: () => npc,
        getCurrentDefinition: () => ({ getStats: () => [0, 0, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }),
    };
    const attacks = fakePlayer({ attack: 99, style: FightStyle.AGGRESSIVE, bonusType: 0, attackBonus: [100, 0, 0, 0, 0] });
    const rolls = AccuracyFormulasDpsCalc.specialRolls(attacks, npc, CombatType.MELEE);
    assert.ok(rolls);
    assert.equal(rolls.attack, AccuracyFormulasDpsCalc.attackMeleeRoll(attacks));
    assert.equal(rolls.defence, AccuracyFormulasDpsCalc.defenseMeleeRoll(npc, 0));
}

// 8) rollAttackType / meleeAttackBonusIndex change which attack bonus is used.
{
    const base = fakePlayer({ attack: 99, style: FightStyle.AGGRESSIVE, bonusType: 0, attackBonus: [100, 50, 0, 0, 0] });
    const crush = fakePlayer({
        attack: 99,
        style: FightStyle.AGGRESSIVE,
        bonusType: 0,
        attackBonus: [100, 50, 0, 0, 0],
        special: special({ meleeAttackBonusIndex: 2 }),
        specialActivated: true,
    });
    assert.equal(AccuracyFormulasDpsCalc.attackMeleeRoll(base), 107 * 164);
    // crush bonus is 0, so the roll is the bare effective level * 64.
    assert.equal(AccuracyFormulasDpsCalc.attackMeleeRoll(crush), 107 * 64);
}

// 9) maximumHitSource overrides the max-hit source used by getHitDamage.
{
    const ranged = fakePlayer({
        strength: 99,
        ranged: 1,
        style: FightStyle.AGGRESSIVE,
        otherBonus: [100, 0, 0, 0],
        special: special({ maximumHitSource: "physical_melee" }),
        specialActivated: true,
    });
    assert.equal(
        DamageFormulas.sourceMaxHit(ranged, CombatType.RANGED),
        DamageFormulas.calculateMaxMeleeHit(ranged),
        "physical_melee source uses the melee max hit"
    );
}

console.info("weapon special traits smoke passed");
