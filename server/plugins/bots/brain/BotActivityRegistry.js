"use strict";

const fs = require("fs");
const path = require("path");
const { Skill } = require("../../../src/main/typescript/elvarg/game/model/Skill");
const { ItemIds } = require("../../../src/main/typescript/elvarg/util/IdEnums");
const { createInteractObjectAction } = require("./actions/InteractObject");
const { createDropItemsAction } = require("./actions/DropItems");
const { createEquipToolAction } = require("./actions/EquipTool");

const DEFAULT_DEFINITIONS_PATH = path.join(
  process.cwd(),
  "data",
  "definitions",
  "bot-activities.json"
);

function applyFields(value, fields) {
  if (typeof value === "string") {
    if (value.startsWith("$") && Object.prototype.hasOwnProperty.call(fields, value.slice(1))) {
      return fields[value.slice(1)];
    }
    return value.replace(/\$([A-Za-z0-9_]+)/g, (match, key) =>
      Object.prototype.hasOwnProperty.call(fields, key) ? String(fields[key]) : match
    );
  }
  if (Array.isArray(value)) {
    return value.map((entry) => applyFields(entry, fields));
  }
  if (value && typeof value === "object") {
    const next = {};
    for (const [key, entry] of Object.entries(value)) {
      next[key] = applyFields(entry, fields);
    }
    return next;
  }
  return value;
}

function resolveItemId(name) {
  if (Number.isInteger(name)) {
    return name;
  }
  const key = String(name).trim().toUpperCase().replace(/[\s-]+/g, "_");
  return ItemIds[key] ?? null;
}

function resolveSkill(name) {
  const key = String(name).trim().toUpperCase().replace(/[\s-]+/g, "_");
  return Skill[key] ?? null;
}

function createCondition(spec) {
  if (spec.skill) {
    const skill = resolveSkill(spec.skill.id);
    const min = Number(spec.skill.min ?? 1);
    const max = Number(spec.skill.max ?? 99);
    return {
      id: `skill:${spec.skill.id}`,
      check(ctx) {
        const level = ctx.player?.getSkillManager?.().getCurrentLevel?.(skill) ?? 0;
        return level >= min && level <= max;
      },
    };
  }
  if (spec.hasItem) {
    const ids = (Array.isArray(spec.hasItem.id) ? spec.hasItem.id : [spec.hasItem.id])
      .map(resolveItemId)
      .filter((id) => Number.isInteger(id));
    const min = Number(spec.hasItem.min ?? 1);
    return {
      id: `item:${spec.hasItem.id}`,
      check(ctx) {
        const inventory = ctx.player?.getInventory?.();
        if (!inventory) {
          return false;
        }
        return ids.some((id) => inventory.getAmount(id) >= min);
      },
    };
  }
  if (spec.inArea) {
    const area = spec.inArea;
    return {
      id: `area:${area.minX},${area.minY}`,
      check(ctx) {
        const loc = ctx.player?.getLocation?.();
        if (!loc) {
          return false;
        }
        return (
          loc.getX() >= area.minX &&
          loc.getX() <= area.maxX &&
          loc.getY() >= area.minY &&
          loc.getY() <= area.maxY &&
          loc.getZ() === (area.z ?? loc.getZ())
        );
      },
    };
  }
  throw new Error(`[bot activities] unknown condition ${JSON.stringify(spec)}`);
}

function createAction(spec, world) {
  if (spec.type === "interactObject") {
    return createInteractObjectAction(spec, world);
  }
  if (spec.type === "dropItems") {
    return createDropItemsAction({
      ...spec,
      itemIds: (spec.itemIds ?? []).map(resolveItemId).filter((id) => Number.isInteger(id)),
    });
  }
  if (spec.type === "equipTool") {
    return createEquipToolAction(spec);
  }
  throw new Error(`[bot activities] unknown action type '${spec.type}'`);
}

function compileActivity(definition, templates, world) {
  const template = definition.template ? templates[definition.template] : null;
  if (definition.template && !template) {
    throw new Error(`[bot activities] unknown template '${definition.template}'`);
  }
  const merged = applyFields(
    template ? { ...template, ...definition } : definition,
    definition.fields ?? {}
  );
  return {
    id: merged.id,
    mode: merged.mode ?? null,
    capacity: Number.isFinite(merged.capacity) ? Math.max(1, Math.floor(merged.capacity)) : 1,
    repeat: merged.repeat === true,
    requires: (merged.requires ?? []).map(createCondition),
    setup: (merged.setup ?? []).map(createCondition),
    actions: (merged.actions ?? []).map((action) => createAction(action, world)),
    produces: merged.produces ?? [],
    site: merged.site ?? null,
  };
}

/**
 * Loads data-driven activities, their resolver links and sites. Capacity slots
 * cap how many bots may run an activity at once; assignment happens only when a
 * brain goes idle, never per tick.
 */
function createBotActivityRegistry(options = {}) {
  const api = options.api ?? null;
  const world = options.world ?? {};
  const definitionsPath = options.definitionsPath ?? DEFAULT_DEFINITIONS_PATH;
  const raw = JSON.parse(fs.readFileSync(definitionsPath, "utf8"));
  if (!raw || typeof raw !== "object") {
    throw new Error("[bot activities] definitions must be an object");
  }
  const templates = raw.templates ?? {};
  const activities = [];
  const byId = new Map();
  for (const definition of raw.activities ?? []) {
    if (!definition?.id || byId.has(definition.id)) {
      throw new Error("[bot activities] activity ids must be unique");
    }
    const activity = compileActivity(definition, templates, world);
    activities.push(activity);
    byId.set(activity.id, activity);
  }
  const sites = (raw.sites ?? []).map((site) => {
    const activity = byId.get(site.activity);
    if (!activity) {
      throw new Error(`[bot activities] site '${site.id}' references unknown activity '${site.activity}'`);
    }
    return { ...site, activity };
  });
  const slots = new Map();
  const lastActivityByPlayer = new WeakMap();

  function available(player) {
    return activities.filter(
      (activity) =>
        (slots.get(activity.id) ?? 0) < activity.capacity &&
        activity.requires.every((condition) => condition.check({ player }))
    );
  }

  return {
    activities,
    byId,
    sites,
    occupy(activity) {
      slots.set(activity.id, (slots.get(activity.id) ?? 0) + 1);
    },
    release(activity) {
      const next = Math.max(0, (slots.get(activity.id) ?? 0) - 1);
      slots.set(activity.id, next);
    },
    pickActivity(player) {
      const previousId = lastActivityByPlayer.get(player);
      const candidates = available(player);
      const previous = candidates.find((activity) => activity.id === previousId);
      const picked = previous ?? candidates[Math.floor(Math.random() * candidates.length)] ?? null;
      if (picked) {
        lastActivityByPlayer.set(player, picked.id);
      }
      return picked;
    },
    resolversFor() {
      return [];
    },
    getSite(siteId) {
      return sites.find((site) => site.id === siteId) ?? null;
    },
  };
}

module.exports = {
  createBotActivityRegistry,
};
