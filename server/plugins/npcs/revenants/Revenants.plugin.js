/**
 * Revenants (https://oldschool.runescape.wiki/w/Revenants): their combat, the shared drop table
 * and the bracelet of ethereum. The caves themselves are areas/RevenantCaves.plugin.js; the
 * captured facts are in docs/revenants.md.
 */
const { REVENANT_IDS, ITEMS, inCaves } = require("./RevenantData");
const { createRevenantCombat, resetHeals } = require("./RevenantCombat");
const { rollDrops } = require("./RevenantDrops");
const Bracelet = require("./BraceletOfEthereum");
const Avarice = require("./Avarice");
const { createMaledictus, ID: MALEDICTUS } = require("./Maledictus");

const AMULET_SLOT = 2;

let api = null;
let core = null;
let maledictus = null;

function isRevenant(npcId) {
  return REVENANT_IDS.includes(npcId);
}

function onTask(player, npc) {
  const request = { player, npc, onTask: false };
  api.emitCustomEvent("slayer:on-task", request);
  return request.onTask === true;
}

/** Drops land under the revenant for the killer; an amulet of avarice notes them (Wiki). */
function dropLoot({ killer, npc, npcId }) {
  if (!killer?.isPlayer?.() || !isRevenant(npcId)) return;
  resetHeals(npc);
  if (inCaves(npc.getLocation())) maledictus?.onRevenantKilled(npc.getDefinition().getCombatLevel());
  const player = killer.getAsPlayer();
  const drops = rollDrops({
    npcId,
    combat: npc.getDefinition().getCombatLevel(),
    skulled: player.isSkulled(),
    onTask: onTask(player, npc),
  });
  const avarice = player.getEquipment().getItems()[AMULET_SLOT]?.getId?.() === ITEMS.AMULET_OF_AVARICE;
  const where = npc.getLocation().clone();
  for (const drop of drops) {
    let amount = drop.amount;
    if (drop.itemId === ITEMS.ETHER) amount = Bracelet.absorbEther(player, amount);
    if (amount <= 0) continue;
    const definition = core.ItemDefinition.forId(drop.itemId);
    const noteId = definition.getNoteId();
    const noted = (drop.noted || avarice) && noteId >= 0 && core.ItemDefinition.forId(noteId).isNoted();
    const itemId = noted ? noteId : drop.itemId;
    if (noted || core.ItemDefinition.forId(itemId).isStackable()) {
      core.ItemOnGroundManager.registerLocation(player, new core.Item(itemId, amount), where);
    } else {
      for (let i = 0; i < amount; i++) core.ItemOnGroundManager.registerLocation(player, new core.Item(itemId, 1), where);
    }
  }
}

/** A charged bracelet drops uncharged, with its ether beside it (Wiki: always lost on death). */
function braceletDeathDrop(event) {
  const id = event.item?.getId?.();
  if (id !== ITEMS.BRACELET_CHARGED || !event.shouldDropItems) return;
  const ether = Bracelet.emptyForDeathDrop(event.item);
  const owner = event.killer?.isPlayer?.() ? event.killer.getAsPlayer() : event.player;
  core.ItemOnGroundManager.registerLocation(owner, new core.Item(ITEMS.BRACELET_UNCHARGED, 1), event.location);
  if (ether > 0) core.ItemOnGroundManager.registerLocation(owner, new core.Item(ITEMS.ETHER, ether), event.location);
  event.handled = true;
}

function onNpcDeath(event) {
  if (event.npcId === MALEDICTUS) maledictus.dropLoot(event);
  else dropLoot(event);
}

/** ::maledictus - spawns the Revenant maledictus here (testing; the natural spawn is rare). */
function spawnMaledictusHere({ player }) {
  const at = player.getLocation();
  maledictus.spawn({ x: at.getX(), y: at.getY(), hint: "middle" });
}

function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  maledictus = createMaledictus(pluginApi, core, { inCaves, surge: Avarice });
}

module.exports = {
  name: "Revenants",
  members: true,
  _test: { dropLoot, braceletDeathDrop, onNpcDeath, attach, maledictus: () => maledictus },
  register(pluginApi) {
    attach(pluginApi);
    pluginApi.persistAttribute(Bracelet.ABSORB_ATTRIBUTE);
    pluginApi.registerNpcCombatMethodProvider(REVENANT_IDS, createRevenantCombat(core), { singleton: false });
    pluginApi.registerNpcCombatMethodProvider([MALEDICTUS], maledictus.MaledictusCombat, { singleton: false });
    pluginApi.onNpcBeforeDeath(maledictus.rememberDamagers);
    pluginApi.onNpcDeath(onNpcDeath);
    pluginApi.registerCommand("maledictus", spawnMaledictusHere, core.PlayerRights.DEVELOPER, "Spawn the Revenant maledictus here");
    Avarice.register(pluginApi);
    pluginApi.onItemOnItem("Revenant ether", "Bracelet of ethereum", Bracelet.chargeWithEther);
    pluginApi.onItemOnItem("Revenant ether", "Bracelet of ethereum (uncharged)", Bracelet.chargeWithEther);
    pluginApi.onItemAction("Bracelet of ethereum", {
      Check: Bracelet.check, "Toggle-absorption": Bracelet.toggleAbsorption, Uncharge: Bracelet.uncharge,
    });
    pluginApi.onItemAction("Bracelet of ethereum (uncharged)", {
      "Toggle-absorption": Bracelet.toggleAbsorption, Dismantle: Bracelet.dismantle,
    });
    pluginApi.onShouldKeepItemOnDeath(Bracelet.neverKept);
    pluginApi.onPlayerDeathItemDrop(braceletDeathDrop);
  },
};
