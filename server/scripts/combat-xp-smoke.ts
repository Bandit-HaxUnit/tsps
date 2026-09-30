import * as assert from "node:assert/strict";
import { CombatFactory } from "../src/main/typescript/elvarg/game/content/combat/CombatFactory";
import { CombatType } from "../src/main/typescript/elvarg/game/content/combat/CombatType";
import { FightStyle } from "../src/main/typescript/elvarg/game/content/combat/FightStyle";
import { FightType } from "../src/main/typescript/elvarg/game/content/combat/FightType";
import { WeaponInterfaceManager } from "../src/main/typescript/elvarg/game/content/combat/WeaponInterfaceManager";
import { WeaponInterfaces } from "../src/main/typescript/elvarg/game/content/combat/WeaponInterfaces";
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

// The combat style buttons send their cache slot (varp 43). The weapon's
// FightType child ids must match those slots, or the click trains nothing.
const styleAt = (weapon: WeaponInterfaces, slot: number): FightStyle | undefined =>
    Object.values(weapon.getFightType())
        .filter((type): type is FightType => type instanceof FightType)
        .find((type) => type.getChildId() === slot)?.getStyle();

const ACC = FightStyle.ACCURATE;
const AGG = FightStyle.AGGRESSIVE;
const DEF = FightStyle.DEFENSIVE;
const CTRL = FightStyle.CONTROLLED;
const CACHE_SLOTS: Array<[string, WeaponInterfaces, Array<[number, FightStyle]>]> = [
    ["unarmed", WeaponInterfaces.UNARMED, [[0, ACC], [1, AGG], [3, DEF]]],
    ["staff", WeaponInterfaces.STAFF, [[0, ACC], [1, AGG], [3, DEF]]],
    ["ancient staff", WeaponInterfaces.ANCIENT_STAFF, [[0, ACC], [1, AGG], [3, DEF]]],
    ["warhammer", WeaponInterfaces.WARHAMMER, [[0, ACC], [1, AGG], [3, DEF]]],
    ["granite maul", WeaponInterfaces.GRANITE_MAUL, [[0, ACC], [1, AGG], [3, DEF]]],
    ["maul", WeaponInterfaces.MAUL, [[0, AGG], [1, AGG], [3, AGG]]],
    ["elder maul", WeaponInterfaces.ELDER_MAUL, [[0, ACC], [1, AGG], [3, DEF]]],
    ["abyssal bludgeon", WeaponInterfaces.ABYSSAL_BLUDGEON, [[0, AGG], [1, AGG], [3, AGG]]],
    ["scythe", WeaponInterfaces.SCYTHE, [[0, ACC], [1, AGG], [2, AGG], [3, DEF]]],
    ["halberd", WeaponInterfaces.HALBERD, [[0, CTRL], [1, AGG], [3, DEF]]],
    ["scimitar", WeaponInterfaces.SCIMITAR, [[0, ACC], [1, AGG], [2, CTRL], [3, DEF]]],
    ["longsword", WeaponInterfaces.LONGSWORD, [[0, ACC], [1, AGG], [2, CTRL], [3, DEF]]],
    ["claws", WeaponInterfaces.CLAWS, [[0, ACC], [1, AGG], [2, CTRL], [3, DEF]]],
    ["mace", WeaponInterfaces.MACE, [[0, ACC], [1, AGG], [2, CTRL], [3, DEF]]],
    ["spear", WeaponInterfaces.SPEAR, [[0, CTRL], [1, CTRL], [2, CTRL], [3, DEF]]],
    ["whip", WeaponInterfaces.WHIP, [[0, ACC], [1, CTRL], [3, DEF]]],
    ["shortbow", WeaponInterfaces.SHORTBOW, [[0, ACC], [1, AGG], [3, DEF]]],
    ["longbow", WeaponInterfaces.LONGBOW, [[0, ACC], [1, AGG], [3, DEF]]],
    ["crossbow", WeaponInterfaces.CROSSBOW, [[0, ACC], [1, AGG], [3, DEF]]],
    ["knife", WeaponInterfaces.KNIFE, [[0, ACC], [1, AGG], [3, DEF]]],
    ["javelin", WeaponInterfaces.JAVELIN, [[0, ACC], [1, AGG], [3, DEF]]],
    ["blowpipe", WeaponInterfaces.BLOWPIPE, [[0, ACC], [1, AGG], [3, DEF]]],
];
for (const [name, weapon, slots] of CACHE_SLOTS) {
    for (const [slot, style] of slots) {
        assert.equal(styleAt(weapon, slot), style, `${name}: slot ${slot}`);
    }
}

const clickStyle = (weapon: WeaponInterfaces, slot: number, combatType: CombatType = CombatType.MELEE): number[] => {
    const player: any = {
        fightType: FightType.UNARMED_KICK,
        getWeapon: () => weapon,
        getFightType(): FightType {
            return this.fightType;
        },
        setFightType(type: FightType): void {
            this.fightType = type;
        },
        getPacketSender: () => ({ sendConfig: () => undefined }),
    };
    assert.equal(WeaponInterfaceManager.changeCombatStyle(player, slot), true);
    return player.getFightType().getStyle().skill(combatType);
};

// Regression: unarmed Block sits on cache slot 3 and must train Defence.
assert.deepEqual(clickStyle(WeaponInterfaces.UNARMED, 3), [index(Skill.DEFENCE)]);
// Shared styles train Attack, Strength and Defence.
assert.deepEqual(clickStyle(WeaponInterfaces.SCIMITAR, 2), [index(Skill.ATTACK), index(Skill.STRENGTH), index(Skill.DEFENCE)]);
assert.deepEqual(clickStyle(WeaponInterfaces.WHIP, 1), [index(Skill.ATTACK), index(Skill.STRENGTH), index(Skill.DEFENCE)]);
// Longrange splits Ranged and Defence.
assert.deepEqual(clickStyle(WeaponInterfaces.SHORTBOW, 3, CombatType.RANGED), [index(Skill.RANGED), index(Skill.DEFENCE)]);

console.info("combat xp smoke passed");
