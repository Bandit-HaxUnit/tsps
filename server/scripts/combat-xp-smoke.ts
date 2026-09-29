import * as assert from "node:assert/strict";
import { CombatFactory } from "../src/main/typescript/elvarg/game/content/combat/CombatFactory";
import { CombatType } from "../src/main/typescript/elvarg/game/content/combat/CombatType";
import { Skill } from "../src/main/typescript/elvarg/game/model/Skill";

type Grant = { skill: any; xp: number };

/** Runs rewardExp with fake player/hit shells and returns the skill XP grants. */
function run(combatType: CombatType, skillIndices: number[], damage: number, previousCast: unknown = null): Grant[] {
    const grants: Grant[] = [];
    const player = {
        getSkillManager: () => ({
            addExperience: (skill: any, xp: number) => {
                if (xp > 0) grants.push({ skill, xp });
            },
        }),
        getCombat: () => ({ getPreviousCast: () => previousCast }),
    };
    const hit = {
        getTotalDamage: () => damage,
        getSkills: () => skillIndices,
        getCombatType: () => combatType,
        isAccurate: () => true,
    };
    CombatFactory.rewardExp(player as any, hit as any);
    return grants;
}

const xp = (grants: Grant[], skill: any) => grants.find((grant) => grant.skill === skill)?.xp;
const index = (skill: any) => skill.getIndex();

// OSRS pays 4 XP per damage to the trained melee/ranged style.
assert.equal(xp(run(CombatType.MELEE, [index(Skill.ATTACK)], 1), Skill.ATTACK), 4);
assert.equal(xp(run(CombatType.MELEE, [index(Skill.STRENGTH)], 3), Skill.STRENGTH), 12);
assert.equal(xp(run(CombatType.MELEE, [index(Skill.DEFENCE)], 2), Skill.DEFENCE), 8);
assert.equal(xp(run(CombatType.RANGED, [index(Skill.RANGED)], 5), Skill.RANGED), 20);

// Controlled splits 4/damage across attack/strength/defence (1.33 each).
{
    const grants = run(CombatType.MELEE, [index(Skill.ATTACK), index(Skill.STRENGTH), index(Skill.DEFENCE)], 3);
    assert.equal(xp(grants, Skill.ATTACK), 4);
    assert.equal(xp(grants, Skill.STRENGTH), 4);
    assert.equal(xp(grants, Skill.DEFENCE), 4);
}

// Longrange: 2 ranged + 2 defence per damage.
{
    const grants = run(CombatType.RANGED, [index(Skill.RANGED), index(Skill.DEFENCE)], 5);
    assert.equal(xp(grants, Skill.RANGED), 10);
    assert.equal(xp(grants, Skill.DEFENCE), 10);
}

// Hitpoints: 1.33 per damage (floor 4/3), on every combat style.
assert.equal(xp(run(CombatType.MELEE, [index(Skill.ATTACK)], 3), Skill.HITPOINTS), 4);
assert.equal(xp(run(CombatType.MELEE, [index(Skill.ATTACK)], 1), Skill.HITPOINTS), 1);

// Magic: 2 per damage.
{
    const grants = run(CombatType.MAGIC, [index(Skill.MAGIC)], 3, {});
    assert.equal(xp(grants, Skill.MAGIC), 6);
    assert.equal(xp(grants, Skill.HITPOINTS), 4);
}

// Defensive autocast: 1.33 magic + 1 defence per damage.
{
    const grants = run(CombatType.MAGIC, [index(Skill.MAGIC), index(Skill.DEFENCE)], 3, {});
    assert.equal(xp(grants, Skill.MAGIC), 4);
    assert.equal(xp(grants, Skill.DEFENCE), 3);
    assert.equal(xp(grants, Skill.HITPOINTS), 4);
}

// A 0-damage melee hit grants nothing.
assert.equal(run(CombatType.MELEE, [index(Skill.ATTACK)], 0).length, 0);

console.info("combat xp smoke passed");
