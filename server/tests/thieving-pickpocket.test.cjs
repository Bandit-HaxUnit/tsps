// Run after `yarn build`: node --test tests/thieving-pickpocket.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { Sounds } = require('../dist/game/Sounds');
const { ItemDefinition } = require('../dist/game/definition/ItemDefinition');
const Thieving = require('../plugins/skills/Thieving.plugin');

const log = [];
const submitted = [];
const combat = { inCombat: () => false, stunTicks: (_player, ticks) => log.push(`stun ${ticks} ticks`) };
Thieving.register({
    getTaskManager: () => ({ submit: (task) => submitted.push(task) }),
    getCombatFactory: () => combat,
    onNpcInteraction: () => {},
    onObjectInteraction: () => {},
    emitCustomEvent: (name) => log.push(name),
    log: () => {},
});
Sounds.sendSound = () => {};
ItemDefinition.forId = () => ({ getName: () => 'Coins' });

function player(stunLeft = 0) {
    return {
        getClickDelay: () => ({ elapsedTime: () => true, reset: () => {} }),
        getSkillManager: () => ({
            getCurrentLevel: () => 1,
            addExperiences: (_skill, xp) => log.push(`xp ${xp}`),
        }),
        getTimers: () => ({ getTicks: () => stunLeft }),
        getInventory: () => ({ isFull: () => false, addItem: (item) => log.push(`loot ${item.getAmount()}`) }),
        getMovementQueue: () => ({ reset: () => {} }),
        setPositionToFace: () => {},
        performAnimation: (animation) => log.push(`anim ${animation.getId()}`),
        sendMessage: (message) => log.push(message),
        getAttribute: () => undefined,
        getIndex: () => 1,
        isRegistered: () => true,
        getHitpoints: () => 10,
        getLocation: () => ({}),
        getCombat: () => ({ getHitQueue: () => ({ addPendingDamage: ([hit]) => log.push(`hit ${hit.getDamage()}`) }) }),
    };
}

function npc() {
    return {
        getTimers: () => ({ registers: () => {} }),
        isRegistered: () => true,
        getLocation: () => ({}),
        setPositionToFace: () => {},
        forceChat: (line) => log.push(`npc: ${line}`),
        performAnimation: () => {},
        getAttackAnim: () => 422,
    };
}

function pickpocketMan(roll, t, stunLeft = 0) {
    const random = Math.random;
    Math.random = () => roll;
    t.after(() => { Math.random = random; });
    log.length = 0;
    const event = { player: player(stunLeft), npc: npc(), definition: { getName: () => 'Man' } };
    submitted.length = 0;
    Thieving._test.pickpocket(event);
    assert.equal(event.handled, true);
    // The click's tick, then the next one.
    const click = [...log];
    log.length = 0;
    for (const task of submitted) task.execute();
    return { click, next: [...log] };
}

test('a successful pickpocket: the attempt message, then the animation with the loot and experience a tick later', (t) => {
    const { click, next } = pickpocketMan(0.99, t);
    assert.deepEqual(click, ["You attempt to pick the man's pocket."]);
    assert.deepEqual(next, [
        'anim 881',
        'loot 3',
        "You pick the man's pocket.",
        'xp 8',
        'thieving:success',
    ]);
});

test('a failed pickpocket: the animation, stun and hit come together, a tick after the attempt message', (t) => {
    const { click, next } = pickpocketMan(0, t);
    assert.deepEqual(click, ["You attempt to pick the man's pocket."]);
    assert.deepEqual(next, [
        'anim 881',
        "npc: What do you think you're doing?",
        'You fail to pickpocket the man.',
        'stun 9 ticks',
        'hit 1',
    ]);
});

test('a stun blocks pickpocketing for 8 of its 9 ticks', (t) => {
    assert.deepEqual(pickpocketMan(0.99, t, 2), { click: [], next: [] }, 'two ticks of the stun left: no attempt');
    assert.ok(pickpocketMan(0.99, t, 1).next.includes('anim 881'), 'its last tick: the next attempt goes ahead');
});

test("stunTicks lasts exactly its ticks; stun in seconds is unchanged", () => {
    const { CombatFactory } = require('../dist/game/content/combat/CombatFactory');
    const { TimerRepository } = require('../dist/util/timers/TimerRepository');
    const { TimerKey } = require('../dist/util/timers/TimerKey');
    const stunned = (stun) => {
        const timers = new TimerRepository();
        const mobile = {
            getTimers: () => timers,
            getCombat: () => ({ reset: () => {} }),
            getMovementQueue: () => ({ reset: () => {} }),
            performGraphic: () => {},
            isPlayer: () => false,
        };
        stun(mobile);
        let ticks = 0;
        while (timers.has(TimerKey.STUN)) {
            timers.process();
            ticks++;
        }
        return ticks;
    };
    assert.equal(stunned((mobile) => CombatFactory.stunTicks(mobile, 9, true)), 9);
    assert.equal(stunned((mobile) => CombatFactory.stun(mobile, 4, true)), 7, "Callisto's 4 s, as before");
    assert.equal(stunned((mobile) => CombatFactory.stun(mobile, 5.4, true)), 10, '5.4 s overshoots: why ticks');
});
