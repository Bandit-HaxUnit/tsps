"use strict";

const { Location } = require("../../../src/main/typescript/elvarg/game/model/Location");
const { attachBrain } = require("./attachBrain");
const { Skill } = require("../../../src/main/typescript/elvarg/game/model/Skill");
const { SkillManager } = require("../../../src/main/typescript/elvarg/game/content/skill/SkillManager");

/**
 * A site's `levels` sets every skill (a number) or named skills ({ "all": 40,
 * "mining": 60 }) on a freshly spawned bot, so tiers can be tested without
 * levelling up. Hitpoints never go below 10. Gear and tools follow from the levels.
 */
function applyLevels(bot, levels) {
  if (levels == null) return;
  const manager = bot.getSkillManager?.();
  if (!manager) return;
  for (const skill of Skill.values()) {
    const name = String(skill.getName?.() ?? skill.toString?.() ?? "").toLowerCase();
    let level = typeof levels === "number" ? levels : levels[name] ?? levels.all;
    if (!Number.isFinite(level)) continue;
    level = Math.max(skill === Skill.HITPOINTS ? 10 : 1, Math.min(99, Math.floor(level)));
    manager.setCurrentLevel(skill, level, false).setMaxLevels(skill, level, false)
      .setExperience(skill, SkillManager.getExperienceForLevel(level));
  }
  bot.getUpdateFlag?.()?.flag?.(require("../../../src/main/typescript/elvarg/game/model/Flag").Flag.APPEARANCE);
}

const SPAWN_ATTEMPTS = 16;

/**
 * Spawns the data-driven sites (bot-activities.json "sites") as brain-driven
 * bots. On by default; BOT_SITES=0 disables them for a bots-free world.
 */
function startBotSites(options = {}) {
  const { api, botApi, runtime, registry, world, resetMovementState } = options;
  if ((process.env.BOT_SITES ?? "1") === "0") {
    return null;
  }
  if (!runtime || !registry || !Array.isArray(registry.sites) || registry.sites.length === 0) {
    return null;
  }
  const RegionManager = api?.getRegionManager?.() ?? null;

  function spawn(site, index) {
    const anchor = site.anchor ?? null;
    // Start on a random site activity that still has a capacity slot.
    const open = site.activities.filter((activity) => registry.hasRoom(activity.id));
    const activity = open[Math.floor(Math.random() * open.length)];
    if (!anchor || !activity) {
      return false;
    }
    RegionManager?.loadMapFiles?.(anchor.x, anchor.y);
    const radius = Math.max(0, Math.min(24, Number(site.spawnRadius ?? 6)));
    let location = null;
    for (let attempt = 0; attempt < SPAWN_ATTEMPTS && !location; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const distance = 1 + Math.floor(Math.random() * Math.max(1, radius));
      const candidate = new Location(
        anchor.x + Math.round(Math.cos(angle) * distance),
        anchor.y + Math.round(Math.sin(angle) * distance),
        anchor.z ?? 0
      );
      if (!RegionManager || !RegionManager.blocked(candidate, null)) {
        location = candidate;
      }
    }
    if (!location) {
      location = new Location(anchor.x, anchor.y, anchor.z ?? 0);
    }

    const bot = runtime.spawnPvpBot(location, { mode: activity.mode });
    if (!bot) {
      return false;
    }
    applyLevels(bot, site.levels);
    return attachBrain({
      runtime,
      registry,
      world,
      bot,
      activity,
      rotation: site.rotation,
      home: anchor,
      resetMovementState,
    });
  }

  function start() {
    let spawned = 0;
    for (const site of registry.sites) {
      const count = Math.max(0, Math.floor(Number(site.count ?? 0)));
      let siteSpawned = 0;
      for (let index = 0; index < count; index++) {
        if (spawn(site, index)) {
          siteSpawned++;
        }
      }
      spawned += siteSpawned;
      botApi?.log?.("bot_site_spawned", {
        site: site.id,
        activities: site.rotation.activityIds,
        requested: count,
        spawned: siteSpawned,
      });
    }
    if (spawned > 0) {
      botApi?.log?.("bot_sites_started", { spawned });
    }
  }

  if (typeof api?.onServerStartup === "function") {
    api.onServerStartup(() => setTimeout(start, 1000));
  }
  return { start };
}

module.exports = {
  applyLevels,
  startBotSites,
};
