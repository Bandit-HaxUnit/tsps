// The varbits that describe each of a player's boats to the client (the boat selection
// interface and the sidepanel read them). Live OSRS sends them at login; ids and values from a
// live login capture and cache scripts 9013/9088 (docs/sailing-osrs-reference.md).
const { boatType, dockById, setVarbit } = require("./sailingContent");

const MAX_BOATS = 5;
/** Boat slot 0's block starts at 19258 (`sailing_boat_1_owned`); each slot is 38 ids on. */
const FIRST_BLOCK = 19258;
const BLOCK_SIZE = 38;
const OFFSET = {
  owned: 0,
  type: 1,
  port: 2,
  bottlePreviousPort: 3,
  facilitiesUnaltered: 4,
  name: 5, // three words: +5, +6, +7
  keel: 8,
  hull: 9,
  sail: 10,
  steering: 11,
  hotspot: 15, // hotspot n: +15 + n
  trim: 26,
};
const STORED_HP = 19458; // + slot
const STORED_MAX_HP = 19463; // + slot
const NO_PREVIOUS_PORT = 255;
const HOTSPOTS = 11;
/**
 * Special `port` values (cache script 8997): 255 bottled, 254 capsized, 253 lost at sea. Port 0
 * is a real dock (Port Sarim), so a boat sunk by a teleport, Escape or death is "lost at sea".
 */
const LOST_AT_SEA = 253;

function blockVarbit(slot, offset) {
  return FIRST_BLOCK + BLOCK_SIZE * slot + offset;
}

/** The port a boat is at, for its `port` varbit: the dock's id, "lost at sea" when sunk. */
function portOf(boat) {
  if (boat.location.kind === "sunk") return LOST_AT_SEA;
  return boat.location.kind === "docked" ? dockById(boat.location.dock)?.portId ?? 0 : 0;
}

/** The varbit values describing one boat slot (every value 0 for an empty slot). */
function slotVarbits(slot, boat) {
  const values = new Map();
  const set = (offset, value) => values.set(blockVarbit(slot, offset), value);
  const type = boat ? boatType(boat.type) : undefined;
  set(OFFSET.owned, boat ? 1 : 0);
  set(OFFSET.type, type?.typeId ?? 0);
  set(OFFSET.port, boat ? portOf(boat) : 0);
  set(OFFSET.bottlePreviousPort, boat ? NO_PREVIOUS_PORT : 0);
  set(OFFSET.facilitiesUnaltered, boat ? 1 : 0);
  for (let word = 0; word < 3; word++) set(OFFSET.name + word, boat?.name?.[word] ?? 0);
  for (const part of ["keel", "hull", "sail", "steering", "trim"]) set(OFFSET[part], type?.parts?.[part] ?? 0);
  for (let hotspot = 0; hotspot < HOTSPOTS; hotspot++) set(OFFSET.hotspot + hotspot, type?.hotspots?.[hotspot] ?? 0);
  values.set(STORED_HP + slot, boat ? type?.hitpoints ?? 0 : 0);
  values.set(STORED_MAX_HP + slot, boat ? type?.hitpoints ?? 0 : 0);
  return values;
}

/** Sends every boat slot's varbits, as at login and after a boat changes. */
function sendBoatVarbits(player) {
  const boats = player.getSailing().boats;
  for (let slot = 0; slot < MAX_BOATS; slot++) {
    const boat = boats.find((candidate) => candidate.slot === slot);
    for (const [id, value] of slotVarbits(slot, boat)) setVarbit(player, id, value);
  }
}

module.exports = { blockVarbit, slotVarbits, sendBoatVarbits };
