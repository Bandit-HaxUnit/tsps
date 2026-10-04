"use strict";

const { playerState } = require("../ActionState");
const { requestMovement, clearMovementRequest, peekMovementRequest, randomInRange } =
  require("../../behaviours/navigation/BotNavigation");

const TARGET_RETRY_MS = 1800;
const TARGET_SPREAD = 4;
const ATTACK_DISTANCE = 20;
const RESERVATION_MS = 10000;
const TARGET_STALL_MS = 45000;
const SITE_STALL_MS = 120000;
// Shared across action instances: two trainers must not claim the same idle NPC.
const CLAIMS = new WeakMap();

function inArea(location, area) {
  return location.getZ() === (area.z ?? 0) && location.getX() >= area.minX &&
    location.getX() <= area.maxX && location.getY() >= area.minY && location.getY() <= area.maxY;
}

function createTrainCombatAction(spec, world) {
  const core = world?.core;
  if (!core) throw new Error("[bot activities] trainCombat requires api.core");
  const { Skill, Equipment, Item, ItemIdentifiers, Flag, FightStyle,
    WeaponInterfaceManager, CombatFactory, CanAttackResponse, WorldDefinition } = core;
  const skills = [Skill.ATTACK, Skill.STRENGTH, Skill.DEFENCE];
  const styles = [FightStyle.ACCURATE, FightStyle.AGGRESSIVE, FightStyle.DEFENSIVE];
  const skillByIndex = new Map(Skill.values().map((skill) => [skill.getIndex(), skill]));
  const stages = [...(spec.stages ?? [])].sort((a, b) => a.minLevel - b.minLevel);
  if (!stages.length || stages[0].minLevel !== 1 || stages.some((stage) =>
    !stage.id || !stage.sites?.length || stage.sites.some((site) => !site.id ||
      !site.names?.length || !site.anchor || !site.area))) {
    throw new Error("[bot activities] trainCombat requires stages starting at level 1 and named sites");
  }
  const resolveItem = (key) => {
    const id = ItemIdentifiers[key];
    if (!Number.isInteger(id)) throw new Error(`[bot activities] unknown training item '${key}'`);
    return id;
  };
  const gear = (spec.gearTiers ?? []).map((tier) => ({
    ...tier, weapon: resolveItem(tier.weapon),
    armour: Object.entries(tier.armour ?? {}).map(([slot, key]) => {
      if (!Number.isInteger(Equipment[slot])) throw new Error(`[bot activities] unknown equipment slot '${slot}'`);
      return [Equipment[slot], resolveItem(key)];
    }),
  })).sort((a, b) => a.minLevel - b.minLevel);
  const foodId = resolveItem(spec.food ?? "TROUT");
  const foodAmount = Math.max(1, Math.min(28, Number(spec.foodAmount ?? 16)));
  const minSeconds = Math.max(1, Number(spec.durationSeconds?.min ?? 300));
  const maxSeconds = Math.max(minSeconds, Number(spec.durationSeconds?.max ?? 720));
  const stateFor = (player) => playerState(action, player, () => ({
    target: null, site: null, stageId: null, previousSiteId: null,
    endsAt: 0, retryAt: 0, lastProgressAt: 0, position: null, targetHp: null, avoided: new WeakMap(),
  }));
  const levelFor = (player) => Math.min(...skills.map((skill) => player.getSkillManager().getMaxLevel(skill)));
  const stageFor = (player) => stages.filter((stage) => levelFor(player) >= stage.minLevel).pop();
  const live = (npc) => !!npc && npc.isNpc?.() === true && npc.isRegistered?.() === true &&
    npc.getHitpoints() > 0 && npc.isDyingFunction?.() !== true;

  function release(player, bot) {
    if (bot.target && CLAIMS.get(bot.target)?.player === player) CLAIMS.delete(bot.target);
    bot.target = null;
    bot.targetHp = null;
  }

  function prepare(player, state) {
    let changed = false;
    const equipment = player.getEquipment();
    const manager = player.getSkillManager();
    const weapon = gear.filter((tier) => manager.getCurrentLevel(Skill.ATTACK) >= tier.minLevel).pop();
    const armour = gear.filter((tier) => manager.getCurrentLevel(Skill.DEFENCE) >= tier.minLevel).pop();
    const items = [...(weapon ? [[Equipment.WEAPON_SLOT, weapon.weapon]] : []), ...(armour?.armour ?? [])];
    for (const [slot, id] of items) {
      if (equipment.getItems()[slot]?.getId() === id) continue;
      const item = new Item(id, 1);
      const requirements = item.getDefinition().getRequirements() ?? [];
      if (requirements.some((required, index) => required > manager.getCurrentLevel(skillByIndex.get(index)))) continue;
      equipment.set(slot, item);
      changed = true;
    }
    if (changed) {
      equipment.refreshItems();
      WeaponInterfaceManager.assign(player);
      world.refreshEquipment(player);
      player.getUpdateFlag().flag(Flag.APPEARANCE);
    }
    const levels = skills.map((skill) => manager.getMaxLevel(skill));
    const style = styles[levels.indexOf(Math.min(...levels))];
    const fightType = Object.values(player.getWeapon()?.getFightType?.() ?? {})
      .find((type) => type?.getStyle?.() === style);
    if (fightType) WeaponInterfaceManager.changeCombatStyle(player, fightType.getChildId());
    // Match equipTool/ensureItem: simulated bots are provisioned, but earn XP
    // exclusively through the normal combat engine. Refill only between fights.
    const inventory = player.getInventory();
    const missing = foodAmount - inventory.getAmount(foodId);
    if (missing > 0) inventory.adds(foodId, missing);
    state.virtualFoodChargesRemaining = inventory.getAmount(foodId);
  }

  function selectSite(player, bot, stage, nowMs) {
    const allowed = stage.sites.filter((site) => !WorldDefinition.isMembersArea(site.anchor.x, site.anchor.y));
    const alternatives = allowed.filter((site) => site.id !== bot.previousSiteId);
    const pool = alternatives.length ? alternatives : allowed;
    const site = pool[Math.floor(Math.random() * pool.length)];
    if (!site) return false;
    bot.site = site;
    bot.previousSiteId = site.id;
    bot.stageId = stage.id;
    bot.endsAt = nowMs + randomInRange(minSeconds, maxSeconds) * 1000;
    bot.lastProgressAt = nowMs;
    world.regionManager.loadMapFiles?.(site.anchor.x, site.anchor.y);
    world.log?.("bot_combat_training_site", { username: player.getUsername(), stage: stage.id, site: site.id });
    return true;
  }

  function available(player, npc, bot, nowMs) {
    if (!live(npc) || npc.getPrivateArea?.() !== player.getPrivateArea?.()) return false;
    if (!inArea(npc.getLocation(), bot.site.area)) return false;
    const definition = npc.getCurrentDefinition(player);
    if (!definition?.isAttackable() || !bot.site.names.some((name) =>
      name.toLowerCase() === definition.getName().toLowerCase())) return false;
    if ((bot.avoided.get(npc) ?? 0) > nowMs) return false;
    const combat = npc.getCombat();
    if ((combat.getTarget() && combat.getTarget() !== player) ||
        (combat.getAttacker() && combat.getAttacker() !== player)) return false;
    const claim = CLAIMS.get(npc);
    return !claim || claim.player === player || claim.until <= nowMs || claim.player.isRegistered?.() === false;
  }

  const action = {
    id: spec.id ?? "trainCombat",
    update(ctx) {
      const { player, state, nowMs } = ctx;
      if (!player || !state) return "failed";
      const bot = stateFor(player);
      if (player.getHitpoints() <= 0 || player.isDyingReturn?.()) {
        release(player, bot);
        bot.site = null;
        return "running";
      }
      if (player.isTeleportingReturn?.() || player.getForceMovement?.() || player.busy?.()) return "running";
      const location = player.getLocation();
      const position = `${location.getX()},${location.getY()},${location.getZ()}`;
      const hp = bot.target?.getHitpoints();
      if (position !== bot.position || hp !== bot.targetHp) {
        bot.lastProgressAt = nowMs;
        bot.position = position;
        bot.targetHp = hp;
      }
      const combat = player.getCombat();
      // Reactive player-combat overlays own PvP; this activity only attacks NPCs.
      if (combat.getTarget()?.isPlayer?.() || combat.getAttacker()?.isPlayer?.()) return "running";
      if (bot.target && !live(bot.target)) {
        if (combat.getTarget() === bot.target) combat.reset();
        player.setCombatFollowing?.(null);
        release(player, bot);
        bot.retryAt = nowMs + randomInRange(600, TARGET_RETRY_MS);
      }
      if (bot.target) {
        if (nowMs - bot.lastProgressAt >= TARGET_STALL_MS ||
            !available(player, bot.target, bot, nowMs)) {
          bot.avoided.set(bot.target, nowMs + SITE_STALL_MS);
          if (combat.getTarget() === bot.target) combat.reset();
          player.setCombatFollowing?.(null);
          clearMovementRequest(player);
          release(player, bot);
        } else {
          CLAIMS.set(bot.target, { player, until: nowMs + RESERVATION_MS });
          if (combat.getTarget() === bot.target) return "running";
        }
      }
      if (!bot.target) {
        const stage = stageFor(player);
        if (bot.site && (bot.stageId !== stage.id || nowMs >= bot.endsAt)) return "success";
        if (!bot.site && !selectSite(player, bot, stage, nowMs)) return "failed";
        if (nowMs - bot.lastProgressAt >= SITE_STALL_MS) return "failed";
        if (nowMs < bot.retryAt) return "running";
        bot.retryAt = nowMs + TARGET_RETRY_MS;
        prepare(player, state);
        const candidates = world.core.World.getNearbyNpcsForUpdate(player)
          .filter((npc) => available(player, npc, bot, nowMs))
          .sort((a, b) => location.getDistance(a.getLocation()) - location.getDistance(b.getLocation()))
          .slice(0, TARGET_SPREAD);
        const offset = randomInRange(0, Math.max(0, candidates.length - 1));
        for (let index = 0; index < candidates.length; index += 1) {
          const npc = candidates[(index + offset) % candidates.length];
          if (CombatFactory.canAttackPermission(player, npc, false, CombatFactory.getMethod(player)) !==
              CanAttackResponse.CAN_ATTACK) continue;
          bot.target = npc;
          bot.targetHp = npc.getHitpoints();
          bot.lastProgressAt = nowMs;
          CLAIMS.set(npc, { player, until: nowMs + RESERVATION_MS });
          break;
        }
      }
      if (bot.target && location.getDistance(bot.target.getLocation()) <= ATTACK_DISTANCE) {
        clearMovementRequest(player);
        combat.setAutocastSpell?.(null);
        combat.setCastSpell?.(null);
        combat.attack(bot.target);
        return "running";
      }
      if (player.getMovementQueue().size() > 0 || peekMovementRequest(player)) return "running";
      const destination = bot.target?.getLocation() ?? bot.site.anchor;
      requestMovement(player, destination.getX?.() ?? destination.x, destination.getY?.() ?? destination.y,
        { state, nowMs, z: destination.getZ?.() ?? destination.z ?? 0, reason: "brain_combat_training" });
      return "running";
    },
    stop(ctx) {
      const bot = stateFor(ctx.player);
      if (bot.target && ctx.player.getCombat().getTarget() === bot.target) ctx.player.getCombat().reset();
      ctx.player.setCombatFollowing?.(null);
      clearMovementRequest(ctx.player);
      release(ctx.player, bot);
      bot.site = null;
      bot.position = null;
      bot.retryAt = 0;
    },
  };
  return action;
}

module.exports = { createTrainCombatAction };
