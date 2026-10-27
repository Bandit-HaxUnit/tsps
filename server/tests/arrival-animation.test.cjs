// Run after `yarn build`: node --test tests/arrival-animation.test.cjs
// OSRS p_arrivedelay: the client drops a priority-1 seq sent with a step.
const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { getSequencePriority, getSequenceStall } = require('../dist/game/cache/NpcAnimationScanner');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { Animation } = require('../dist/game/model/Animation');
const { Combat } = require('../dist/game/content/combat/Combat');
const { World } = require('../dist/game/World');
const { Location } = require('../dist/game/model/Location');

test('a skilling seq started on a step is held a tick; combat seqs are not', async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  assert.equal(getSequencePriority(621), 1, 'net fishing is dropped by movement');
  assert.equal(getSequencePriority(422), -1, 'punch is not');

  const played = [];
  let stepped = true;
  const player = Object.create(Player.prototype);
  Object.assign(player, {
    animation: null,
    getMovementQueue: () => ({ steppedThisWorldCycle: () => stepped }),
    getUpdateFlag: () => ({ flag: () => played.push(player.animation.getId()) }),
    getCombat: () => ({ onAnimationStarted: () => {} }),
  });

  player.performAnimation(new Animation(621));
  assert.deepEqual(played, [], 'held on the arrival step');
  assert.equal(player.arrivalAnimation.getId(), 621);
  player.performAnimation(new Animation(422));
  assert.deepEqual(played, [422], 'combat plays at once');
  assert.equal(player.arrivalAnimation, null, 'a newer animation replaces the held one');

  stepped = false;
  player.performAnimation(new Animation(621));
  assert.deepEqual(played, [422, 621], 'standing still plays at once');
});

test('a sequence priority lookup reads the decoded archive, not a fresh decompress each time', async () => {
  const { preloadSequences } = require('../dist/game/cache/NpcAnimationScanner');
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  preloadSequences();
  const start = performance.now();
  for (let id = 8000; id < 8200; id++) getSequencePriority(id);
  // Each fresh decompress took ~100 ms; 200 first-time lookups now take well under one.
  assert.ok(performance.now() - start < 50, `${(performance.now() - start).toFixed(1)} ms for 200 lookups`);
  assert.equal(getSequencePriority(733), 1, 'cooking is still dropped by movement');
});

// Wiki: Animation stall. The client decides both halves of a stall from the seq config, and the
// server reads the same fields so it never locks someone the client would let step out.
test('the cache says which attack animations hold the player and for how long', async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  // Crossbows carry no masks and run 81 client cycles: the hunters' crossbow stall the Wiki names.
  assert.deepEqual(getSequenceStall(4230), { ticks: 3, blocks: true, cancelsOnStep: false });
  // A battleaxe swing is masked, so the client lets the player step out of it.
  assert.equal(getSequenceStall(401).blocks, false, 'battleaxe swing holds nobody');
  assert.equal(getSequenceStall(401).ticks, 2);
  // Net fishing is dropped by a step, so it holds nothing at all.
  assert.equal(getSequenceStall(621).cancelsOnStep, true);
});

/** A player with a real Combat, and only the packet and movement plumbing stubbed out. */
function buildFighter(stepped) {
  const sent = [];
  const player = Object.create(Player.prototype);
  const combat = new Combat(player);
  Object.assign(player, {
    animation: null,
    getCombat: () => combat,
    getIndex: () => 7,
    getLocation: () => new Location(3200, 3200, 0),
    getMovementQueue: () => ({
      steppedThisWorldCycle: () => stepped,
      reset: () => {},
    }),
    getUpdateFlag: () => ({ flag: () => sent.push(player.animation.getId()) }),
    getPacketSender: () => ({
      sendConfig: () => {},
      sendDestination: () => {},
      sendAttackTimer: () => {},
      sendRunStatus: () => {},
    }),
    setMobileInteraction: () => {},
    setPositionToFace: () => {},
    setFollowing: () => {},
    getTimers: () => ({ has: () => false }),
    isNeedsPlacement: () => false,
    getDueling: () => ({ getButtonDelay: () => ({ finished: () => true }), inDuel: () => false }),
    getTrading: () => ({ getButtonDelay: () => ({ finished: () => true }) }),
    getForceMovement: () => null,
    hasFlag: () => false,
    isRegistered: () => true,
    getHitpoints: () => 50,
  });
  combat.attack(swingTarget());
  return { player, combat, sent };
}

function swingTarget() {
  return {
    isPlayer: () => true,
    isNpc: () => false,
    getIndex: () => 8,
    getLocation: () => new Location(3201, 3200, 0),
    getCombat: () => ({ getAttacker: () => ({ isNpc: () => false }) }),
    getBlockAnim: () => 424,
    performAnimation: () => {},
  };
}

/** The swing itself, with the real attack pipeline in front of it. */
test('a swing through Combat arms the measurement and holds the player where they stand', async (t) => {
  const { CombatFactory, CanAttackResponse } = require('../dist/game/content/combat/CombatFactory');
  const { CombatRange } = require('../dist/game/content/combat/CombatRange');
  const { MovementQueue } = require('../dist/game/model/movement/MovementQueue');
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  World.processCycle = 200;
  const { player, combat, sent } = buildFighter(false);
  const queue = new MovementQueue(player);
  player.getMovementQueue = () => queue;

  const method = {
    attackSpeed: () => 4,
    onCombatBegan: () => {},
    onCombatEnded: () => {},
    finished: () => {},
    requireProjectiles: () => false,
    hits: () => [],
    start: (character) => character.performAnimation(new Animation(4230)),
  };
  t.mock.method(CombatFactory, 'validTarget', () => true);
  t.mock.method(CombatFactory, 'canAttackPermission', () => CanAttackResponse.CAN_ATTACK);
  t.mock.method(CombatFactory, 'canAttack', () => CanAttackResponse.CAN_ATTACK);
  t.mock.method(CombatFactory, 'getMethod', () => method);
  t.mock.method(CombatRange, 'canReach', () => true);

  assert.equal(queue.getMobility().canMove(), true, 'free before the swing');
  combat.attack(swingTarget());
  assert.equal(combat.performNewAttack(false), true, 'the swing went off');

  assert.deepEqual(sent, [4230], 'the swing played its animation');
  assert.equal(combat.getAnimationStallTicks(), 3, 'and measured its stall');
  assert.equal(queue.getMobility().canMove(), false, 'the animation holds their feet');

  World.processCycle = 203;
  assert.equal(queue.getMobility().canMove(), true, 'released once the animation has played out');
});

test('a swing is measured from its own animation, and a click does not cut it away', async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  World.processCycle = 100;
  const { player, combat, sent } = buildFighter(false);

  combat.expectAttackAnimation();
  player.performAnimation(new Animation(4230));
  assert.deepEqual(sent, [4230], 'the swing plays out');
  assert.equal(combat.getAnimationStallTicks(), 3, 'its 81 cycles hold the player 3 ticks');

  // Only the armed swing is measured: a flinch or an overhead effect stalls nobody.
  player.performAnimation(new Animation(424));
  assert.equal(combat.getAnimationStallTicks(), 3, 'the block anim that followed is not a stall');

  combat.clearInteraction();
  assert.deepEqual(sent, [4230, 424], 'the click that dropped the target left the animation playing');

  World.processCycle = 103;
  assert.equal(combat.getAnimationStallTicks(), 0, 'the stall releases with the animation');
  combat.attack(swingTarget());
  combat.clearInteraction();
  assert.equal(sent.at(-1), 65535, 'an ordinary reset still stops the animation');
});

test('a swing started on the tick the player stepped holds their actions but not their feet', async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  World.processCycle = 100;
  const { player, combat, sent } = buildFighter(true);

  combat.expectAttackAnimation();
  player.performAnimation(new Animation(4230));
  // The rubber band: their true tile keeps moving under the animation, so no click is held and
  // no hit waits - but the animation itself still plays to its end.
  assert.equal(combat.isAnimationStalled(), false, 'a moving start is not a full stall');
  combat.clearInteraction();
  assert.deepEqual(sent, [4230], 'and the click still cannot cut the animation away');
});

test('content that stops the animation on purpose ends the stall with it', async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  World.processCycle = 100;
  const { player, combat } = buildFighter(false);

  combat.expectAttackAnimation();
  player.performAnimation(new Animation(4230));
  assert.equal(combat.getAnimationStallTicks(), 3);
  player.performAnimation(Animation.DEFAULT_RESET_ANIMATION);
  assert.equal(combat.getAnimationStallTicks(), 0, 'teleports and deaths are not held by a swing');
});

test('the definition file states the stalls the cache cannot see', () => {
  const { Equipment } = require('../dist/game/model/container/impl/Equipment');
  const { ItemIdentifiers } = require('../dist/util/ItemIdentifiers');
  let applyStall = null;
  require('../plugins/combat/AnimationStalls.plugin').register({
    core: { Equipment },
    onAnimationStall: (handler) => { applyStall = handler; },
  });

  const swing = (weaponId) => ({
    player: {
      getEquipment: () => ({
        get: (slot) => slot === Equipment.WEAPON_SLOT ? { getId: () => weaponId } : null,
      }),
    },
    animationId: 401,
    ticks: 2,
    kind: 'partial',
    holdsHits: true,
  });

  // Wiki: Animation stall names the leaf-bladed battleaxe, but its swing reuses the masked
  // battleaxe seqs, which the cache therefore rates as free.
  const named = swing(ItemIdentifiers.LEAF_BLADED_BATTLEAXE);
  applyStall(named);
  assert.equal(named.kind, 'full', 'the row promotes the swing to a full stall');
  assert.equal(named.ticks, 2, 'its length still comes from the cache');

  const other = swing(ItemIdentifiers.GRANITE_MAUL);
  applyStall(other);
  assert.equal(other.kind, 'partial', 'a weapon the Wiki does not name keeps the cache answer');
});
