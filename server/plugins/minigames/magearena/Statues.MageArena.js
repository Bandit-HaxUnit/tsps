"use strict";

/**
 * Praying at the god statues (https://oldschool.runescape.wiki/w/Mage_Arena): each prayer spawns
 * one matching god cape on the ground by the statue for the player to pick up; praying again
 * hands out another, and it does not restore prayer points. Cape ids: 2412 Saradomin, 2413
 * Guthix, 2414 Zamorak (items on the ground, owner seen by the player). The statue tile itself
 * is blocked, so the cape lands on the open tile in front of it (the placement tile one south).
 */

const STATUES = Object.freeze({
  2873: Object.freeze({ name: "Saradomin", capeId: 2412, x: 2500, y: 4720 }),
  2874: Object.freeze({ name: "Zamorak", capeId: 2414, x: 2516, y: 4720 }),
  2875: Object.freeze({ name: "Guthix", capeId: 2413, x: 2507, y: 4723 }),
});

let core;

function statueFor(objectId) {
  return STATUES[objectId] ?? null;
}

function capeTile(statue) {
  return new core.Location(statue.x, statue.y - 1, 0);
}

function spawnCape(player, statue) {
  core.ItemOnGroundManager.registerLocation(
    player,
    new core.Item(statue.capeId, 1),
    capeTile(statue)
  );
}

function prayAt(event) {
  const statue = statueFor(event.objectId);
  if (!statue) return;
  spawnCape(event.player, statue);
}

module.exports = function registerStatues(api) {
  core = api.core;
  api.onObjectInteraction("Statue of Saradomin", { "Pray-at": prayAt });
  api.onObjectInteraction("Statue of Zamorak", { "Pray-at": prayAt });
  api.onObjectInteraction("Statue of Guthix", { "Pray-at": prayAt });
};

Object.assign(module.exports, {
  _test: {
    STATUES,
    statueFor,
    capeTile,
    spawnCape,
    prayAt,
    setCore(value) { core = value; },
  },
});
