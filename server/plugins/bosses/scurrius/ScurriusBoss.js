"use strict";

const { applyStyleDamage } = require("../StyleDamage");

// Wiki: solo (7222) 13 melee / 8 magic / 7 ranged / 22 rockfall,
// public (7221) 13 melee / 14 magic / 13 ranged / 24 rockfall.
const SOLO_MAX_HITS = { melee: 13, magic: 8, ranged: 7, rockfall: 22 };
const PUBLIC_MAX_HITS = { melee: 13, magic: 14, ranged: 13, rockfall: 24 };

const FEED_THRESHOLD = 0.8;
const ENRAGE_THRESHOLD = 0.3;
const FEED_HEAL = 5;
const FEED_HEAL_COUNT = 5;
const HEAL_INTERVAL_TICKS = 8;
const ENRAGED_ATTACK_SPEED = 3;
const RANGED_PHASE_DISTANCE = 8;
const ROCKFALL_MIN_HIT = 15;
const ROCKFALL_WINDUP_TICKS = 3;
const ROCKFALL_SCATTER_RADIUS = 2;
const ROCKFALL_SEARCH_RADIUS = 12;
const RAT_WAVE_LIMIT = 12;
const RATS_PER_WAVE = 6;
const RAT_SPAWN_RADIUS = 5;
const RAT_LIFETIME_TICKS = 100;

// Cache: npc_rat_boss_attack_* sequences and vfx_rat_boss_* spotanims.
const MELEE_ANIMATION = 10692;
const RANGED_ANIMATION = 10694;
const MAGIC_ANIMATION = 10696;
const FEEDING_RANGED_ANIMATION = 10695;
const FEEDING_MAGIC_ANIMATION = 10697;
const ROCKFALL_ANIMATION = 10698;
const SUMMON_ANIMATION = 10700;
const FEEDING_SUMMON_ANIMATION = 10702;
const RANGED_PROJECTILE = 2642;
const MAGIC_PROJECTILE = 2640;
const RANGED_IMPACT = 2643;
const MAGIC_IMPACT = 2641;
const ROCKFALL_TELEGRAPH = 2644;

module.exports = function registerScurrius(api) {
  const {
    Animation,
    CombatFactory,
    CombatMethod,
    CombatType,
    Graphic,
    HitDamage,
    HitMask,
    Misc,
    NPC,
    NpcIdentifiers,
    PendingHit,
    Projectile,
    Task,
    TaskManager,
    World,
  } = api.core;

  const PUBLIC_ID = NpcIdentifiers.SCURRIUS;
  const NPC_IDS = [NpcIdentifiers.SCURRIUS, NpcIdentifiers.SCURRIUS_2];
  const GIANT_RAT = NpcIdentifiers.GIANT_RAT_16;
  const states = new WeakMap();

  function stateOf(npc) {
    let state = states.get(npc);
    if (!state) {
      state = { phase: "combat", fed: false, feeding: false, ratWaves: 0 };
      states.set(npc, state);
    }
    return state;
  }

  function maxHitsFor(npc) {
    const publicScurrius = npc.getId?.() === PUBLIC_ID || npc.getRealId?.() === PUBLIC_ID;
    return publicScurrius ? PUBLIC_MAX_HITS : SOLO_MAX_HITS;
  }

  function pickAction(state) {
    // Phase 1: tail swipe, with the occasional stomp.
    if (state.phase === "combat") {
      return Misc.randomInclusive(0, 5) === 0 ? "rockfall" : "melee";
    }
    // Feeding/enraged: magic and ranged with the occasional stomp or summon.
    const feeding = state.phase === "feeding";
    const magicWeight = feeding ? 4 : 5;
    const rangedWeight = feeding ? 4 : 5;
    const options = [];
    for (let i = 0; i < magicWeight; i++) options.push("magic");
    for (let i = 0; i < rangedWeight; i++) options.push("ranged");
    options.push("rockfall", "summon");
    return options[Misc.randomInclusive(0, options.length - 1)];
  }

  function maybeAdvancePhase(npc) {
    const state = stateOf(npc);
    const maxHitpoints = npc.getDefinition()?.getHitpoints?.() ?? 0;
    if (maxHitpoints <= 0) {
      return;
    }
    const ratio = npc.getHitpoints() / maxHitpoints;
    if (ratio <= ENRAGE_THRESHOLD) {
      if (state.phase !== "enraged") {
        state.phase = "enraged";
        state.feeding = false;
        TaskManager.cancelTasks(state);
      }
      return;
    }
    if (ratio <= FEED_THRESHOLD && !state.fed) {
      state.fed = true;
      state.feeding = true;
      state.phase = "feeding";
      TaskManager.submit(new FeedingTask(npc, state));
    }
  }

  function fireProjectile(character, target, projectileId) {
    Projectile.createProjectile(
      character,
      target,
      projectileId,
      40,
      Projectile.arrivalCycles(character, target),
      43,
      31
    ).sendProjectile();
  }

  function scheduleRockfall(npc, target) {
    const centre = target.getLocation().clone();
    const tiles = [centre];
    for (let i = 1; i < 3; i++) {
      tiles.push(
        centre.transform(
          Misc.randomInclusive(-ROCKFALL_SCATTER_RADIUS, ROCKFALL_SCATTER_RADIUS),
          Misc.randomInclusive(-ROCKFALL_SCATTER_RADIUS, ROCKFALL_SCATTER_RADIUS)
        )
      );
    }
    for (const tile of tiles) {
      target.getPacketSender().sendGlobalGraphic(new Graphic(ROCKFALL_TELEGRAPH), tile);
    }
    TaskManager.submit(new RockfallTask(npc, tiles, maxHitsFor(npc).rockfall));
  }

  function summonRats(npc, state) {
    if (state.ratWaves >= RAT_WAVE_LIMIT) {
      return;
    }
    state.ratWaves++;
    for (let i = 0; i < RATS_PER_WAVE; i++) {
      const rat = NPC.create(
        GIANT_RAT,
        npc
          .getLocation()
          .transform(
            Misc.randomInclusive(-RAT_SPAWN_RADIUS, RAT_SPAWN_RADIUS),
            Misc.randomInclusive(-RAT_SPAWN_RADIUS, RAT_SPAWN_RADIUS)
          )
      );
      rat.__skipDefaultRespawn = true;
      World.getAddNPCQueue().push(rat);
      TaskManager.submit(new RatLifetimeTask(rat));
    }
  }

  class FeedingTask extends Task {
    constructor(npc, state) {
      super(HEAL_INTERVAL_TICKS, state);
      this.npc = npc;
      this.heals = 0;
    }

    execute() {
      const state = this.key;
      const alive = this.npc.isRegistered?.() === true && this.npc.getHitpoints() > 0;
      if (!alive || !state.feeding) {
        state.feeding = false;
        if (state.phase === "feeding") {
          state.phase = "combat";
        }
        this.stop();
        return;
      }
      this.npc.heal(FEED_HEAL);
      this.heals++;
      if (this.heals >= FEED_HEAL_COUNT) {
        state.feeding = false;
        state.phase = "combat";
        this.stop();
      }
    }
  }

  class RockfallTask extends Task {
    constructor(npc, tiles, maxHit) {
      super(ROCKFALL_WINDUP_TICKS, npc);
      this.npc = npc;
      this.tiles = tiles;
      this.maxHit = maxHit;
    }

    execute() {
      if (this.npc.getHitpoints() > 0) {
        for (const player of this.npc.getPlayersWithinDistance(ROCKFALL_SEARCH_RADIUS)) {
          if (!this.tiles.some((tile) => tile.equals(player.getLocation()))) {
            continue;
          }
          player
            .getCombat()
            .getHitQueue()
            .addPendingDamage([
              new HitDamage(Misc.randomInclusive(ROCKFALL_MIN_HIT, this.maxHit), HitMask.RED),
            ]);
        }
      }
      this.stop();
    }
  }

  class RatLifetimeTask extends Task {
    constructor(rat) {
      super(RAT_LIFETIME_TICKS, rat);
    }

    execute() {
      const rat = this.key;
      if (rat.isRegistered?.() && rat.getHitpoints() > 0) {
        World.getRemoveNPCQueue().push(rat);
      }
      this.stop();
    }
  }

  class ScurriusCombatMethod extends CombatMethod {
    constructor() {
      super();
      this.stance = CombatType.RANGED;
      this.action = "melee";
    }

    type() {
      return this.stance;
    }

    // Chases into melee in phase 1; holds its ground at range while feeding or enraged.
    attackDistance(character) {
      return stateOf(character).phase === "combat" ? 1 : RANGED_PHASE_DISTANCE;
    }

    attackSpeed(character) {
      return stateOf(character).phase === "enraged"
        ? ENRAGED_ATTACK_SPEED
        : super.attackSpeed(character);
    }

    start(character, target) {
      const state = stateOf(character);
      this.action = pickAction(state);
      this.stance = CombatType.MELEE;
      if (this.action === "melee") {
        character.performAnimation(new Animation(MELEE_ANIMATION));
        return;
      }
      if (this.action === "rockfall") {
        character.performAnimation(new Animation(ROCKFALL_ANIMATION));
        scheduleRockfall(character, target);
        return;
      }
      if (this.action === "summon") {
        character.performAnimation(
          new Animation(state.phase === "feeding" ? FEEDING_SUMMON_ANIMATION : SUMMON_ANIMATION)
        );
        summonRats(character, state);
        return;
      }
      if (this.action === "ranged") {
        this.stance = CombatType.RANGED;
        character.performAnimation(
          new Animation(state.phase === "feeding" ? FEEDING_RANGED_ANIMATION : RANGED_ANIMATION)
        );
        fireProjectile(character, target, RANGED_PROJECTILE);
        return;
      }
      this.stance = CombatType.MAGIC;
      character.performAnimation(
        new Animation(state.phase === "feeding" ? FEEDING_MAGIC_ANIMATION : MAGIC_ANIMATION)
      );
      fireProjectile(character, target, MAGIC_PROJECTILE);
    }

    hits(character, target) {
      if (this.action === "rockfall" || this.action === "summon") {
        return [];
      }
      const maxHits = maxHitsFor(character);
      const delay =
        this.stance === CombatType.MELEE ? 1 : Projectile.arrivalTicks(character, target);
      const hit = new PendingHit(character, target, this, delay);
      const maxHit =
        this.stance === CombatType.RANGED
          ? maxHits.ranged
          : this.stance === CombatType.MAGIC
            ? maxHits.magic
            : maxHits.melee;
      applyStyleDamage(CombatFactory, character, target, hit, maxHit);
      return [hit];
    }

    handleAfterHitEffects(hit) {
      const target = hit.getTarget();
      if (target.isPlayer()) {
        if (hit.getCombatType() === CombatType.RANGED) {
          target.performGraphic(new Graphic(RANGED_IMPACT));
        } else if (hit.getCombatType() === CombatType.MAGIC) {
          target.performGraphic(new Graphic(MAGIC_IMPACT));
        }
      }
      const attacker = hit.getAttacker();
      if (attacker.isNpc()) {
        maybeAdvancePhase(attacker);
      }
    }
  }

  api.registerNpcCombatMethodProvider(NPC_IDS, ScurriusCombatMethod, { singleton: false });
};
