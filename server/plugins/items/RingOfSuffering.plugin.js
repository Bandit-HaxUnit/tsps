/**
 * Ring of suffering (https://oldschool.runescape.wiki/w/Ring_of_suffering).
 *
 * Charged with rings of recoil (40 charges each, 100,000 max), becoming the
 * ring of suffering (r); the imbued variant becomes (ri). While worn and not
 * toggled off, it recoils 10% + 1 of incoming damage with the same 1-in-3
 * fizzle as a ring of recoil, spending one charge per proc. Discharging the
 * ring loses the stored rings.
 */
const Equipment = require("../../src/main/typescript/elvarg/game/model/container/impl/Equipment").Equipment;
const { Item } = require("../../src/main/typescript/elvarg/game/model/Item");
const { HitDamage } = require("../../src/main/typescript/elvarg/game/content/combat/hit/HitDamage");
const { HitMask } = require("../../src/main/typescript/elvarg/game/content/combat/hit/HitMask");

const MAX_CHARGES = 100000;
const CHARGES_PER_RECOIL = 40;
const CHARGES_META_KEY = "ring-of-suffering";
const DISABLED_ATTRIBUTE = "ring-of-suffering:recoil-disabled";

let core = null;
let recoilIds = new Set();
let baseByRecoil = new Map();
let recoilByBase = new Map();

function charges(item) {
  const saved = Number(item.getMetaValue?.(CHARGES_META_KEY));
  return Number.isFinite(saved) ? Math.max(0, Math.min(MAX_CHARGES, Math.floor(saved))) : 0;
}

function wornRing(player) {
  const item = player?.getEquipment?.()?.get?.(Equipment.RING_SLOT);
  return item && recoilIds.has(Number(item.getId?.() ?? -1)) ? item : null;
}

function refresh(player) {
  player.getInventory().refreshItems();
  player.getEquipment().refreshItems();
}

function useCharge(player, item) {
  const left = charges(item) - 1;
  if (left > 0) {
    item.setMetaValue(CHARGES_META_KEY, left);
    return;
  }
  item.setId(baseByRecoil.get(item.getId()));
  item.setMetaValue(CHARGES_META_KEY, undefined);
  refresh(player);
  player.sendMessage("Your ring of suffering has run out of charges.");
}

/** Same recoil formula as the core ring of recoil. */
function onIncomingDamage(entity, hitDamage, context = {}) {
  if (!entity?.isPlayer?.() || !(hitDamage?.getDamage?.() > 0) || !context.attacker) {
    return;
  }
  const player = entity.getAsPlayer();
  const ring = wornRing(player);
  if (!ring || player.getAttribute?.(DISABLED_ATTRIBUTE) === true) {
    return;
  }
  if (Math.floor(Math.random() * 3) + 1 === 2) {
    return;
  }
  const returnDamage = Math.floor(hitDamage.getDamage() * 0.1) + 1;
  if (returnDamage > 0) {
    context.attacker.getCombat?.().getHitQueue().addPendingDamage([new HitDamage(returnDamage, HitMask.RED)]);
  }
  useCharge(player, ring);
}

function checkCharges({ player, item }) {
  player.sendMessage(`Your ring of suffering has ${charges(item).toLocaleString("en-US")} charges left.`);
}

function chargeRing(event) {
  const { player, usedItem, usedWithItem, usedItemId, usedWithItemId } = event;
  const otherIsRecoil = Number(usedItemId) === core.ItemIdentifiers.RING_OF_RECOIL ||
    Number(usedWithItemId) === core.ItemIdentifiers.RING_OF_RECOIL;
  if (!otherIsRecoil) {
    return;
  }
  const ring = Number(usedItemId) === core.ItemIdentifiers.RING_OF_RECOIL ? usedWithItem : usedItem;
  const ringId = Number(ring?.getId?.() ?? -1);
  if (!baseByRecoil.has(ringId) && !recoilByBase.has(ringId)) {
    return;
  }
  const room = MAX_CHARGES - charges(ring);
  if (room < CHARGES_PER_RECOIL) {
    player.sendMessage("Your ring of suffering cannot hold any more charges.");
    event.handled = true;
    return;
  }
  player.getInventory().deleteNumber(core.ItemIdentifiers.RING_OF_RECOIL, 1);
  if (recoilByBase.has(ringId)) {
    ring.setId(recoilByBase.get(ringId));
  }
  ring.setMetaValue(CHARGES_META_KEY, charges(ring) + CHARGES_PER_RECOIL);
  refresh(player);
  player.sendMessage("You add the ring of recoil to your ring of suffering.");
  event.handled = true;
}

function toggleRecoil({ player, item }) {
  const disabled = player.getAttribute?.(DISABLED_ATTRIBUTE) === true;
  player.setAttribute?.(DISABLED_ATTRIBUTE, !disabled);
  player.sendMessage(`The recoil effect is now ${disabled ? "enabled" : "disabled"}.`);
  void item;
}

function discharge({ player, item }) {
  item.setId(baseByRecoil.get(item.getId()) ?? item.getId());
  item.setMetaValue(CHARGES_META_KEY, undefined);
  refresh(player);
  player.sendMessage("You discharge the ring of suffering; the stored rings are lost.");
  return true;
}

module.exports = {
  name: "RingOfSuffering",
  members: true,
  _test: { charges, wornRing, useCharge, onIncomingDamage, chargeRing, discharge, MAX_CHARGES },
  register(api) {
    core = api.core;
    const I = core.ItemIdentifiers;
    baseByRecoil = new Map([
      [I.RING_OF_SUFFERING_R_, I.RING_OF_SUFFERING],
      [I.RING_OF_SUFFERING_RI_, I.RING_OF_SUFFERING_I_],
    ]);
    recoilByBase = new Map([
      [I.RING_OF_SUFFERING, I.RING_OF_SUFFERING_R_],
      [I.RING_OF_SUFFERING_I_, I.RING_OF_SUFFERING_RI_],
    ]);
    recoilIds = new Set(baseByRecoil.keys());
    api.persistAttribute(DISABLED_ATTRIBUTE);
    api.registerIncomingDamageModifier(onIncomingDamage);
    api.onItemAction((event) => {
      const isRecoil = recoilIds.has(event.itemId);
      const isBase = recoilByBase.has(event.itemId);
      if (!isRecoil && !isBase) {
        return;
      }
      const option = String(event.option ?? "").toLowerCase();
      if (option === "check") {
        event.handled = true;
        checkCharges(event);
      } else if (option.includes("recoil")) {
        event.handled = true;
        toggleRecoil(event);
      } else if (option === "discharge" && isRecoil) {
        event.handled = discharge(event);
      }
    });
    api.onItemOnItem(chargeRing, { noted: false });
  },
};
