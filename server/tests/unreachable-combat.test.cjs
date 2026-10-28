// A fighter must never stay "in combat" with a target it cannot reach.
//
// Both give-up paths in Combat.postMovementProcess are skipped by an actor that cannot move
// (a stun, a placement, a teleport in transit) and by a route whose step the mover rejects -
// the checkpoint is kept, so the queue never empties. Without the deadline in
// Combat.giveUpUnreachableTarget, such an actor held its target (and so
// CombatFactory.inCombat, the teleport and busy gates) indefinitely.
//
// Run after `yarn build`: node --test tests/unreachable-combat.test.cjs
const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const core = PluginManager.getCoreApi();

const MUGGER = core.NpcIdentifiers.MUGGER_2;
/** Matches Combat.UNREACHABLE_GIVE_UP_CYCLES. */
const GIVE_UP_CYCLES = 20;
/** Open ground, so nothing but the actors themselves decides the fight. */
const FIELD = { x: 3220, y: 3220 };

before(async () => {
  await CachePipeline.initialize(require("node:path").resolve(__dirname, ".."));
  new NpcDefinitionLoader().load();
});

/**
 * A real player and NPC on the live map, ticked in World order (NPCs first, then players) with
 * a cycle counter, so Combat's own reach, routing and give-up code is what runs. Neither actor
 * is in World, so nothing wanders or respawns; the fight is driven only through Combat.
 */
function scene(t, { gap = 18, playerImmobile = false, npcImmobile = false } = {}) {
  let cycle = 1000;
  t.mock.method(core.World, "getProcessCycle", () => cycle);
  const tasks = [];
  t.mock.method(core.TaskManager, "submit", (task) => { task.setRunning(true); tasks.push(task); });

  const player = new Player(null);
  player.setUsername("unreachable-combat");
  const sender = new Proxy({}, { get: () => () => sender });
  player.getPacketSender = () => sender;
  player.getSession = () => ({ sendClientPacket: () => true, processPackets: () => {} });
  const messages = [];
  t.mock.method(player, "sendMessage", (m) => messages.push(m));
  player.setLocation(new core.Location(FIELD.x, FIELD.y, 0));
  player.setRegistered(true);
  player.setNeedsPlacement(false);
  for (const skill of core.Skill.values()) {
    player.getSkillManager().setCurrentLevel(skill, 99);
    player.getSkillManager().setMaxLevel(skill, 99);
  }
  if (playerImmobile) player.getMovementQueue().setBlockMovement(true);

  const npc = core.NPC.create(MUGGER, new core.Location(FIELD.x, FIELD.y + gap, 0));
  npc.isRegistered = () => true;
  npc.setNeedsPlacement(false);
  npc.setHitpoints(500);
  if (npcImmobile) npc.getMovementQueue().setBlockMovement(true);

  function tick() {
    cycle++;
    for (let i = tasks.length - 1; i >= 0; i--) {
      const task = tasks[i];
      if (!(task.isRunning() && task.execute() !== false)) tasks.splice(i, 1);
    }
    npc.process();
    const combat = player.getCombat(), movement = player.getMovementQueue();
    combat.getHitQueue().process(cycle);
    player.getTimers().process();
    movement.beginCycle();
    if (combat.hasPendingWork()) combat.preMovementProcess();
    if (movement.hasPendingWork()) movement.process();
    if (combat.hasPendingWork()) combat.postMovementProcess();
  }
  const ticks = (count) => { for (let i = 0; i < count; i++) tick(); };
  const moveNpcTo = (x, y) => npc.setLocation(new core.Location(x, y, 0));
  return { player, npc, messages, tick, ticks, moveNpcTo };
}

test("a player that cannot move, chasing a target that never comes, gives up", (t) => {
  const s = scene(t, { playerImmobile: true, npcImmobile: true });
  s.player.getCombat().attack(s.npc);
  s.ticks(GIVE_UP_CYCLES - 1);
  assert.ok(s.player.getCombat().getTarget(), "still patient one cycle short of the deadline");
  assert.deepEqual(s.messages, []);
  s.tick();
  assert.equal(s.player.getCombat().getTarget(), null);
  assert.equal(core.CombatFactory.inCombat(s.player), false, "not held in combat by an unreachable target");
  assert.deepEqual(s.messages, ["I can't reach that!"]);
});

test("an immobile npc gives up a player that never comes", (t) => {
  const s = scene(t, { playerImmobile: true, npcImmobile: true });
  s.npc.getCombat().attack(s.player);
  s.ticks(GIVE_UP_CYCLES - 1);
  assert.ok(s.npc.getCombat().getTarget(), "still patient one cycle short of the deadline");
  s.tick();
  assert.equal(s.npc.getCombat().getTarget(), null);
  assert.equal(s.npc.getCombat().hasPendingWork(), false);
});

test("a fighter still walking toward its target keeps it", (t) => {
  const s = scene(t);
  const from = s.npc.getLocation().getDistance(s.player.getLocation());
  s.npc.getCombat().attack(s.player);
  s.ticks(GIVE_UP_CYCLES * 3);
  const to = s.npc.getLocation().getDistance(s.player.getLocation());
  assert.ok(to < from, `the npc closed the gap: ${from} -> ${to}`);
  assert.equal(s.npc.getCombat().getTarget(), s.player, "progress is not a give-up");
});

test("an immobile actor keeps a target that is closing on it", (t) => {
  // The other half of the deadline: patience is only spent when the gap stops closing.
  const s = scene(t, { playerImmobile: true, gap: 10 });
  s.player.getCombat().attack(s.npc);
  for (let i = 0; i < GIVE_UP_CYCLES * 2; i++) {
    s.tick();
    if (i % 2 === 0) s.moveNpcTo(FIELD.x, Math.max(FIELD.y + 1, FIELD.y + 10 - i / 2));
  }
  assert.equal(s.player.getCombat().getTarget(), s.npc);
  assert.deepEqual(s.messages, []);
});

test("an npc walking into an obstacle gives up instead of hunting forever", (t) => {
  // The player's own report: the npc takes a step every cycle and never gets any nearer.
  const s = scene(t, { gap: 8 });
  s.npc.getCombat().attack(s.player);
  for (let i = 0; i < GIVE_UP_CYCLES - 1; i++) {
    s.tick();
    s.moveNpcTo(FIELD.x, FIELD.y + 8); // pinned back: its step is rejected by the obstacle
  }
  assert.ok(s.npc.getCombat().getTarget(), "still patient one cycle short of the deadline");
  s.tick();
  assert.equal(s.npc.getCombat().getTarget(), null);
});

test("a fight in reach is never given up", (t) => {
  const s = scene(t, { gap: 1 });
  s.player.getCombat().attack(s.npc);
  s.npc.getCombat().attack(s.player);
  s.ticks(GIVE_UP_CYCLES * 3);
  assert.equal(s.npc.getHitpoints() < 500, true, "the player is landing hits");
  assert.equal(s.player.getCombat().getTarget(), s.npc);
  assert.deepEqual(s.messages, []);
});

test("a player with no route to its target is refused on the spot", (t) => {
  // The pre-existing fast path: an empty queue that the route finder cannot fill.
  const s = scene(t, { gap: 6 });
  t.mock.method(core.CombatRange, "route", () => false);
  s.player.getCombat().attack(s.npc);
  s.tick();
  assert.equal(s.player.getCombat().getTarget(), null);
  assert.deepEqual(s.messages, ["I can't reach that!"]);
});
