// Run after `yarn build`: node --test tests/hit-queue.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { HitQueue } = require('../dist/game/content/combat/hit/HitQueue');
const { HitDamage } = require('../dist/game/content/combat/hit/HitDamage');
const { HitMask } = require('../dist/game/content/combat/hit/HitMask');

function buildTarget(hp) {
    const shown = [];
    const target = {
        hp,
        shown,
        isRegistered: () => true,
        isPlayer: () => false,
        getHitpoints: () => target.hp,
        decrementHealth: (hit) => {
            if (target.hp <= 0) hit.setDamage(0);
            hit.setDamage(Math.min(hit.getDamage(), target.hp));
            target.hp -= hit.getDamage();
            return hit;
        },
        addTickHit: (hit) => shown.push(hit.getDamage()),
    };
    return target;
}

const hits = (...damage) => damage.map((value) => new HitDamage(value, HitMask.RED));

test('every hit due on a tick lands on that tick', () => {
    const target = buildTarget(120);
    const queue = new HitQueue(target);
    queue.addPendingDamage(hits(10, 10, 10, 10, 10, 10, 10, 10, 10, 10));
    queue.process(1);
    assert.equal(target.hp, 20, 'ten 10s on one tick');
    assert.equal(target.shown.length, 10, 'all ten are sent; the client keeps four on screen');
    assert.equal(queue.hasPendingWork(), false, 'nothing carries over to the next tick');
});

test('hits after a lethal one take nothing more off', () => {
    const target = buildTarget(15);
    const queue = new HitQueue(target);
    queue.addPendingDamage(hits(10, 10, 10));
    queue.process(1);
    assert.equal(target.hp, 0);
    assert.deepEqual(target.shown, [10, 5, 0]);
});

// Wiki: Animation stall. "A full stall does not allow the player to move independently or
// perform actions. Hits are usually queued up on the player, and received only after the
// action is complete."
test('hits due during a full animation stall are kept until it releases', () => {
    const { CombatFactory } = require('../dist/game/content/combat/CombatFactory');
    const target = buildTarget(100);
    target.isPlayer = () => true;
    target.isUntargetable = () => false;
    const RELEASE = 7; // the cycle the stalled player is free again
    target.getCombat = () => ({ getIncomingHitCycle: () => RELEASE });

    const attacker = { isRegistered: () => true, getHitpoints: () => 50 };
    const swing = (damage) => ({
        getTarget: () => target,
        getAttacker: () => attacker,
        getTotalDamage: () => damage,
    });

    const landed = [];
    const executeHit = CombatFactory.executeHit;
    CombatFactory.executeHit = (hit) => landed.push(hit);
    try {
        const queue = new HitQueue(target);
        queue.addPendingHit(swing(9), 5); // due inside the window: waits for cycle 7
        queue.addPendingHit(swing(4), 6); // also inside it
        queue.addPendingHit(swing(3), 9); // already past it: keeps its own tick

        queue.process(5);
        queue.process(6);
        assert.deepEqual(landed, [], 'nothing lands while the animation still holds them');
        queue.process(7);
        assert.deepEqual(landed.map((hit) => hit.getTotalDamage()), [9, 4], 'the burst lands together');
        queue.process(9);
        assert.deepEqual(landed.map((hit) => hit.getTotalDamage()), [9, 4, 3]);
    } finally {
        CombatFactory.executeHit = executeHit;
    }
});

test('an unmoving target is not stalled, so an NPC takes its hits on the dot', () => {
    const { CombatFactory } = require('../dist/game/content/combat/CombatFactory');
    const target = buildTarget(100);
    target.isUntargetable = () => false;
    const attacker = { isRegistered: () => true, getHitpoints: () => 50 };
    const hit = { getTarget: () => target, getAttacker: () => attacker, getTotalDamage: () => 5 };

    const landed = [];
    const executeHit = CombatFactory.executeHit;
    CombatFactory.executeHit = (pending) => landed.push(pending);
    try {
        const queue = new HitQueue(target);
        queue.addPendingHit(hit, 5);
        queue.process(5);
        assert.equal(landed.length, 1, 'the monster is hit on the scheduled tick');
    } finally {
        CombatFactory.executeHit = executeHit;
    }
});
