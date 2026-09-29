// Run after `yarn build`: node --test tests/sailing.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Boat, BoatMoveMode } = require("../dist/game/content/sailing/Boat");
const { canOccupy, hullTiles } = require("../dist/game/content/sailing/BoatCollision");
const { tickBoat } = require("../dist/game/content/sailing/BoatMovement");
const {
  angleFromCoordDelta,
  angleToFineDelta,
  packedHeadingToAngle,
  reverseAngle,
  turnAngleDelta,
} = require("../dist/game/content/sailing/HeadingUtils");
const { BoatManager } = require("../dist/game/content/sailing/BoatManager");
const { RegionManager } = require("../dist/game/collision/RegionManager");
const { Location } = require("../dist/game/model/Location");

const SOUTH = 0;
const WEST = 512;
const NORTH = 1024;
const EAST = 1536;

function makeRaft(angle = NORTH) {
  return new Boat({
    entityIndex: 3000,
    configId: 1,
    ownerPlayerId: 1,
    deckRegionX: 1200,
    deckRegionY: 1200,
    sizeX: 8,
    sizeZ: 8,
    hull: { offsetX: 0, offsetY: 0, width: 128, length: 384 },
    deckCentreX: 448,
    deckCentreY: 448,
    fineX: 100 * 128 + 64,
    fineY: 100 * 128 + 64,
    level: 0,
    angle,
  });
}

const openSea = () => true;

// Boat maths ported from xrsps `server/tests/sailing-boat-movement.test.ts`.

test("heading math", () => {
  assert.equal(packedHeadingToAngle(0), 0);
  assert.equal(packedHeadingToAngle(4), WEST);
  assert.equal(packedHeadingToAngle(15), 1920);
  assert.equal(reverseAngle(SOUTH), NORTH);
  assert.equal(reverseAngle(EAST), WEST);

  assert.equal(angleFromCoordDelta(0, -5), SOUTH);
  assert.equal(angleFromCoordDelta(-5, 0), WEST);
  assert.equal(angleFromCoordDelta(0, 5), NORTH);
  assert.equal(angleFromCoordDelta(5, 0), EAST);

  assert.deepEqual(angleToFineDelta(SOUTH, 64), { dx: 0, dy: -64 });
  assert.deepEqual(angleToFineDelta(WEST, 64), { dx: -64, dy: 0 });
  assert.deepEqual(angleToFineDelta(NORTH, 64), { dx: 0, dy: 64 });
  assert.deepEqual(angleToFineDelta(EAST, 64), { dx: 64, dy: 0 });

  // Clockwise is preferred up to and including a half turn.
  assert.equal(turnAngleDelta(SOUTH, WEST), 512);
  assert.equal(turnAngleDelta(SOUTH, NORTH), 1024);
  assert.equal(turnAngleDelta(SOUTH, EAST), -512);
  assert.equal(turnAngleDelta(100, 100), 0);
});

test("a stopped boat stays put", () => {
  const boat = makeRaft(NORTH);
  assert.deepEqual(tickBoat(boat, openSea), { moved: false, turned: false, blocked: false });
});

test("full sail moves 1.5 tiles a tick, half sail 0.75", () => {
  const boat = makeRaft(NORTH);
  boat.moveMode = BoatMoveMode.Full;
  const startY = boat.fineY;
  tickBoat(boat, openSea);
  assert.equal(boat.fineY - startY, 192);
  boat.moveMode = BoatMoveMode.Half;
  tickBoat(boat, openSea);
  assert.equal(boat.fineY - startY, 288);
});

test("a fast boat stops at a one-tile strip of land instead of hopping it", () => {
  const strip = (_x, y) => y !== 102;
  const boat = makeRaft(NORTH);
  boat.fineY = 100 * 128 + 64 - 128; // hull covers rows 98..100
  boat.moveMode = BoatMoveMode.Full;
  for (let i = 0; i < 10; i++) tickBoat(boat, strip);
  for (const tile of hullTiles(boat, boat.fineX, boat.fineY, boat.angle)) {
    assert.ok(tile % 0x8000 < 102, "hull never crosses the strip");
  }
});

test("reverse keeps the bow on the heading and backs up at half speed", () => {
  const boat = makeRaft(NORTH);
  boat.moveMode = BoatMoveMode.Reverse;
  const startY = boat.fineY;
  tickBoat(boat, openSea);
  assert.equal(boat.angle, NORTH);
  assert.equal(boat.fineY - startY, -96);
});

test("a quarter turn takes 4 ticks at 128 units a tick", () => {
  const boat = makeRaft(SOUTH);
  boat.moveMode = BoatMoveMode.Full;
  boat.heading = WEST;
  let ticks = 0;
  while (boat.angle !== WEST && ticks < 20) {
    assert.ok(tickBoat(boat, openSea).turned);
    ticks++;
  }
  assert.equal(ticks, 4);
});

test("a turning boat keeps sailing at its sail speed", () => {
  const boat = makeRaft(SOUTH);
  boat.moveMode = BoatMoveMode.Full;
  boat.heading = WEST;
  const startX = boat.fineX;
  const startY = boat.fineY;
  assert.ok(tickBoat(boat, openSea).turned);
  assert.ok(Math.abs(Math.hypot(boat.fineX - startX, boat.fineY - startY) - 192) <= 1);
});

test("the 1x3 raft hull covers 3 tiles facing north or east", () => {
  const boat = makeRaft(NORTH);
  assert.equal(hullTiles(boat, boat.fineX, boat.fineY, NORTH).size, 3);
  assert.equal(hullTiles(boat, boat.fineX, boat.fineY, EAST).size, 3);
});

test("the boat stops at the coast and can back off", () => {
  // Land starts at y = 102; the bow reaches it after sailing north.
  const coast = (_x, y) => y < 102;
  const boat = makeRaft(NORTH);
  boat.fineY = 100 * 128 + 64 - 128; // hull covers rows 98..100
  boat.moveMode = BoatMoveMode.Full;
  let blocked = false;
  for (let i = 0; i < 10 && !blocked; i++) {
    blocked = tickBoat(boat, coast).blocked;
  }
  assert.ok(blocked);
  for (const tile of hullTiles(boat, boat.fineX, boat.fineY, boat.angle)) {
    assert.ok(tile % 0x8000 < 102, "hull never overlaps land");
  }
  assert.ok(canOccupy(boat, boat.fineX, boat.fineY - 64, boat.angle, coast));
});

test("deck tiles project onto the world tile under the boat", () => {
  // Facing south (template orientation) the deck lane tile (3, 3) sits on the boat centre.
  const boat = makeRaft(SOUTH);
  assert.deepEqual(boat.deckTileToWorld(boat.deckBaseX + 3, boat.deckBaseY + 3), { x: 100, y: 100 });
  assert.deepEqual(boat.deckTileToWorld(boat.deckBaseX + 3, boat.deckBaseY + 4), { x: 100, y: 101 });
  // Turned north (half a turn), the tile ahead of the centre ends up behind it.
  const turned = makeRaft(NORTH);
  assert.deepEqual(turned.deckTileToWorld(turned.deckBaseX + 3, turned.deckBaseY + 4), { x: 100, y: 99 });
});

test("helm headings snap to the 16 directions", () => {
  const boat = makeRaft(NORTH);
  assert.equal(boat.helmHeadingToward(104, 100), EAST);
  assert.equal(boat.helmHeadingToward(100, 106), NORTH);
  assert.equal(boat.helmHeadingToward(94, 100), WEST);
  assert.equal(boat.helmHeadingToward(100, 100), undefined, "clicking the boat's own tile");
  // 18.4 degrees north of east rounds to the next 22.5-degree step (east-north-east).
  assert.equal(boat.helmHeadingToward(103, 101), 1408);
  // Measured from the exact centre: a boat 0.9 tiles into its tile heading for a tile due
  // north of that point stays north instead of drifting a step.
  boat.fineX = 100 * 128 + 115;
  assert.equal(boat.helmHeadingToward(100, 103), NORTH);
});

// A raft spec with the values ported from xrsps `boats.ts`.
const RAFT = {
  type: "raft",
  configId: 1,
  templateChunkX: 480,
  templateChunkY: 807,
  sizeX: 8,
  sizeZ: 8,
  hull: { offsetX: 0, offsetY: 0, width: 128, length: 384 },
  deckCentreX: 448,
  deckCentreY: 448,
  deckLevel: 1,
  walkableDeck: [{ x: 3, y: 2 }, { x: 3, y: 3 }, { x: 3, y: 4 }],
  boardingTile: { x: 3, y: 4 },
  locs: [],
};

const AT_SEA = { fineX: 100 * 128 + 64, fineY: 100 * 128 + 64, level: 0, angle: NORTH };

function aboard(boat, dx, dy) {
  const deck = BoatManager.getDeck(boat);
  return { getArea: () => deck, getLocation: () => new Location(boat.deckBaseX + dx, boat.deckBaseY + dy, 0) };
}

test("only the boat type's walkable tiles are open on the deck", () => {
  const boat = BoatManager.spawn(1, RAFT, AT_SEA);
  try {
    const deck = BoatManager.getDeck(boat);
    const clip = (dx, dy, z = 0) => RegionManager.getClipping(boat.deckBaseX + dx, boat.deckBaseY + dy, z, deck);
    assert.equal(clip(3, 2), 0);
    assert.equal(clip(3, 4), 0);
    assert.equal(clip(2, 3), RegionManager.BLOCKED_TILE);
    assert.equal(clip(3, 5), RegionManager.BLOCKED_TILE);
    assert.equal(clip(3, 3, 1), RegionManager.BLOCKED_TILE, "everyone aboard stands on level 0");
    assert.ok(BoatManager.isDeckTile(boat.deckBaseX, boat.deckBaseY));
  } finally {
    BoatManager.dispose(boat);
  }
});

test("each boat gets its own deck scene and entity index, freed on dispose", () => {
  const first = BoatManager.spawn(1, RAFT, AT_SEA);
  const second = BoatManager.spawn(2, RAFT, AT_SEA);
  assert.notEqual(first.entityIndex, second.entityIndex);
  assert.notEqual(first.deckBaseX, second.deckBaseX);
  BoatManager.dispose(first);
  assert.equal(BoatManager.getBoat(first.entityIndex), undefined);
  const third = BoatManager.spawn(3, RAFT, AT_SEA);
  assert.equal(third.entityIndex, first.entityIndex, "the freed slot is reused");
  BoatManager.dispose(second);
  BoatManager.dispose(third);
});

test("an actor on a deck is aboard that boat, and their root tile is the world tile under them", () => {
  const boat = BoatManager.spawn(1, RAFT, { ...AT_SEA, angle: SOUTH });
  try {
    const sailor = aboard(boat, 3, 4);
    assert.equal(BoatManager.getBoatAboard(sailor), boat);
    const root = BoatManager.rootLocation(sailor);
    assert.deepEqual([root.getX(), root.getY(), root.getZ()], [100, 101, 0]);

    const onLand = { getArea: () => null, getLocation: () => new Location(3200, 3200, 0) };
    assert.equal(BoatManager.getBoatAboard(onLand), undefined);
    assert.equal(BoatManager.rootLocation(onLand).getX(), 3200);
  } finally {
    BoatManager.dispose(boat);
  }
  assert.equal(BoatManager.getBoatAboard(aboard(boat, 3, 4)), undefined, "a disposed boat has no one aboard");
});

// --- World-entity packets, read the way client/network/packet/ServerBinaryDecoder.ts reads them.

const {
  encodeRebuildWorldEntity,
  encodeWorldEntityInfo,
} = require("../dist/net/protocol/ClientProtocol");
const { WorldEntitySync } = require("../dist/game/content/sailing/WorldEntitySync");

function reader(buffer, offset) {
  let at = offset;
  return {
    u8: () => buffer[at++],
    i8: () => buffer.readInt8(at++),
    u16: () => { const v = buffer.readUInt16BE(at); at += 2; return v; },
    i16: () => { const v = buffer.readInt16BE(at); at += 2; return v; },
    i32: () => { const v = buffer.readInt32BE(at); at += 4; return v; },
    done: () => at >= buffer.length,
    at: () => at,
  };
}

function readPosition(r) {
  const flags = r.u8();
  const typed = (shift) => {
    const width = (flags >> shift) & 3;
    return width === 3 ? r.i32() : width === 2 ? r.i16() : width === 1 ? r.i8() : 0;
  };
  return { x: typed(0), y: typed(2), z: typed(4), orientation: typed(6) };
}

/** Decodes WORLDENTITY_INFO (opcode, u8 length, payload). */
function decodeWorldEntityInfo(packet) {
  assert.equal(packet[0], 143);
  const r = reader(packet, 2);
  const count = r.u8();
  const updates = [];
  for (let i = 0; i < count; i++) {
    const updateType = r.u8();
    const update = { updateType };
    if (updateType >= 2) update.delta = readPosition(r);
    if (updateType !== 0) assert.equal(r.u8(), 0, "no mask");
    updates.push(update);
  }
  const spawns = [];
  while (!r.done()) {
    const spawn = { entityIndex: r.u16(), sizeX: r.u8(), sizeZ: r.u8(), configId: r.u16() };
    spawn.position = readPosition(r);
    spawn.drawMode = r.u8();
    assert.equal(r.u8(), 0, "no mask");
    spawns.push(spawn);
  }
  return { updates, spawns };
}

test("WORLDENTITY_INFO packs updates and spawns the way the client reads them", () => {
  const packet = encodeWorldEntityInfo(
    [{ updateType: 2, delta: { x: 64, y: 0, z: -300, orientation: 128 } }, { updateType: 1 }, { updateType: 0 }],
    [{ entityIndex: 3000, sizeX: 8, sizeZ: 8, configId: 1, drawMode: 0, position: { x: 393472, y: 0, z: 382400, orientation: 1024 } }],
  );
  assert.equal(packet[1], packet.length - 2, "u8 length");
  assert.deepEqual(decodeWorldEntityInfo(packet), {
    updates: [
      { updateType: 2, delta: { x: 64, y: 0, z: -300, orientation: 128 } },
      { updateType: 1 },
      { updateType: 0 },
    ],
    spawns: [{ entityIndex: 3000, sizeX: 8, sizeZ: 8, configId: 1, drawMode: 0, position: { x: 393472, y: 0, z: 382400, orientation: 1024 } }],
  });
});

test("REBUILD_WORLDENTITY carries the deck scene the way the client reads it", () => {
  const chunks = Array.from({ length: 4 }, () => Array.from({ length: 13 }, () => new Array(13).fill(-1)));
  chunks[1][6][6] = 0x1234567;
  const packet = encodeRebuildWorldEntity(3000, 1, 8, 8, 1200, 1216, chunks, [[1, 2, 3, 4]]);
  assert.equal(packet[0], 142);
  assert.equal(packet.readUInt16BE(1), packet.length - 3, "u16 length");
  const r = reader(packet, 3);
  assert.deepEqual(
    [r.u16(), r.u16(), r.u8(), r.u8(), r.u16(), r.u16(), r.u16(), r.u8(), r.u16(), r.u16(), r.u8()],
    [3000, 1, 8, 8, 1200, 1216, 1216, 0, 1200, 1, 0],
    "entity, config, size, zone, regionY, force reload, regionX, xtea count, build areas",
  );
  // 4 x 13 x 13 presence bits, plus 26 bits for the one chunk, MSB first.
  let bit = r.at() * 8;
  const readBits = (count) => {
    let value = 0;
    for (let i = 0; i < count; i++, bit++) value = (value << 1) | ((packet[bit >> 3] >> (7 - (bit & 7))) & 1);
    return value;
  };
  const found = [];
  for (let plane = 0; plane < 4; plane++) {
    for (let x = 0; x < 13; x++) {
      for (let y = 0; y < 13; y++) {
        if (readBits(1)) found.push([plane, x, y, readBits(26)]);
      }
    }
  }
  assert.deepEqual(found, [[1, 6, 6, 0x1234567]]);
  const keys = reader(packet, Math.ceil(bit / 8));
  assert.deepEqual([keys.i32(), keys.i32(), keys.i32(), keys.i32()], [1, 2, 3, 4]);
  assert.ok(keys.done());
});

function viewer(x, y) {
  const player = { location: new Location(x, y, 0) };
  player.getLocation = () => player.location;
  player.getArea = () => player.area ?? null;
  return player;
}

test("a viewer is sent a boat in range, its moves, and its removal once out of range", () => {
  const boat = BoatManager.spawn(1, { ...RAFT, locs: [{ id: 59554, x: 3, y: 4, level: 1, shape: 10, rotation: 0 }] }, AT_SEA);
  try {
    const watcher = viewer(boat.tileX + 10, boat.tileY);

    const first = WorldEntitySync.flush(watcher);
    assert.deepEqual(first.map((packet) => packet[0]), [142, 143, 134], "deck scene, spawn, then the deck loc (LOC_ADD_CHANGE)");
    const spawned = decodeWorldEntityInfo(first[1]);
    assert.deepEqual(spawned.updates, []);
    assert.equal(spawned.spawns[0].entityIndex, boat.entityIndex);
    assert.deepEqual(spawned.spawns[0].position, { x: boat.fineX, y: 0, z: boat.fineY, orientation: boat.angle });

    assert.deepEqual(WorldEntitySync.flush(watcher), [], "nothing to send while the boat is still");

    boat.fineY += 64;
    assert.deepEqual(decodeWorldEntityInfo(WorldEntitySync.flush(watcher)[0]).updates,
      [{ updateType: 2, delta: { x: 0, y: 0, z: 64, orientation: 0 } }]);

    watcher.location = new Location(boat.tileX + 40, boat.tileY, 0);
    assert.deepEqual(decodeWorldEntityInfo(WorldEntitySync.flush(watcher)[0]).updates, [{ updateType: 0 }]);
    assert.deepEqual(WorldEntitySync.flush(watcher), []);
  } finally {
    BoatManager.dispose(boat);
  }
});

test("the boat a player is on is always sent, and a disposed boat is removed", () => {
  const boat = BoatManager.spawn(1, RAFT, AT_SEA);
  const sailor = viewer(0, 0);
  sailor.area = BoatManager.getDeck(boat);
  sailor.location = new Location(boat.deckBaseX + 3, boat.deckBaseY + 4, 0);
  assert.equal(decodeWorldEntityInfo(WorldEntitySync.flush(sailor)[1]).spawns[0].entityIndex, boat.entityIndex);
  BoatManager.dispose(boat);
  sailor.area = null;
  assert.deepEqual(decodeWorldEntityInfo(WorldEntitySync.flush(sailor)[0]).updates, [{ updateType: 0 }]);
});

// --- Player sync and visibility across the deck boundary.

const { encodePlayerSync, createPlayerSyncState } = require("../dist/net/protocol/ClientProtocol");

function bitsOf(buffer) {
  return [...buffer].map((byte) => byte.toString(2).padStart(8, "0")).join("");
}

test("adding a player on a deck writes their boat as the world view", () => {
  const syncBits = (worldView) => {
    const self = { index: 1, x: 3200, y: 3200, level: 0, appearance: Buffer.alloc(1) };
    const sailor = { index: 2, x: 9624, y: 9636, level: 0, appearance: Buffer.alloc(1), worldView };
    const packet = encodePlayerSync(1, 3152, 3152, 1, [self, sailor], createPlayerSyncState(1, self));
    return bitsOf(packet.subarray(3 + 12)); // opcode + length, then the 12-byte header
  };
  const ashore = syncBits(undefined);
  const aboard = syncBits(3000);
  let at = 0;
  while (ashore[at] === aboard[at]) at++;
  assert.equal(ashore[at], "0", "the no-world-view bit");
  assert.equal(aboard.slice(at, at + 17), "1" + (3000).toString(2).padStart(16, "0"));
  assert.equal(aboard.slice(at + 17), ashore.slice(at + 1), "nothing else changes");
});

test("people aboard count as being in the main world, where the boat is", () => {
  const boat = BoatManager.spawn(1, RAFT, { ...AT_SEA, angle: SOUTH });
  try {
    const sailor = aboard(boat, 3, 4);
    sailor.getPrivateArea = () => BoatManager.getDeck(boat);
    assert.equal(BoatManager.syncArea(sailor), null);
    const { PrivateArea } = require("../dist/game/model/areas/impl/PrivateArea");
    const house = new (class House extends PrivateArea {})();
    assert.equal(BoatManager.syncArea({ getPrivateArea: () => house }), house, "other private areas are unchanged");
    // A viewer 10 tiles from the boat sees the sailor; one 20 tiles away does not.
    const root = BoatManager.rootLocation(sailor);
    assert.ok(root.isViewableFromWithin(new Location(110, 101, 0), 15));
    assert.ok(!root.isViewableFromWithin(new Location(121, 101, 0), 15));
  } finally {
    BoatManager.dispose(boat);
  }
});

test("NPC_INFO carries the tile new NPCs are placed from (the root tile when aboard)", () => {
  const { encodeNpcSync, createNpcSyncState } = require("../dist/net/protocol/ClientProtocol");
  const packet = encodeNpcSync(7, { x: 3074, y: 2987, level: 0 }, [], createNpcSyncState());
  assert.equal(packet[0], 21);
  // opcode, u16 length, then loop cycle (4), large (1), root tile x and y, sync length.
  assert.equal(packet.readInt32BE(3), 7);
  assert.equal(packet.readUInt16BE(8), 3074);
  assert.equal(packet.readUInt16BE(10), 2987);
  assert.equal(packet.readUInt16BE(12), packet.length - 14);
});

test("a boat deck counts as the main world; other private areas don't", () => {
  const { PrivateArea } = require("../dist/game/model/areas/impl/PrivateArea");
  class House extends PrivateArea {}
  assert.equal(new House().countsAsMainWorld(), false);
  const boat = BoatManager.spawn(1, RAFT, AT_SEA);
  try {
    assert.equal(BoatManager.getDeck(boat).countsAsMainWorld(), true);
  } finally {
    BoatManager.dispose(boat);
  }
});

test("SET_HEADING decodes to one of the 16 helm headings", () => {
  const { decodeClientPackets } = require("../dist/net/protocol/ClientProtocol");
  assert.deepEqual(decodeClientPackets(Buffer.from([214, 9])), [{ type: "set_heading", heading: 9 }]);
  assert.deepEqual(decodeClientPackets(Buffer.from([214, 0xff])), [{ type: "set_heading", heading: 15 }]);
});

test("only the player at the helm steers, by heading or by clicking", () => {
  const boat = BoatManager.spawn(1, RAFT, AT_SEA);
  try {
    const sailor = { ...aboard(boat, 3, 4), getIndex: () => 7 };
    BoatManager.setHelmHeading(sailor, 4);
    assert.equal(boat.heading, NORTH, "not at the helm");
    assert.equal(BoatManager.steerToward(sailor, 110, 100), false);

    boat.helmPlayerId = 7;
    BoatManager.setHelmHeading(sailor, 4);
    assert.equal(boat.heading, WEST);
    assert.equal(BoatManager.steerToward(sailor, boat.tileX + 10, boat.tileY), true);
    assert.equal(boat.heading, EAST, "a click east of the boat");
  } finally {
    BoatManager.dispose(boat);
  }
});

// --- Lifecycle: every way on and off a boat.

const { Sailing } = require("../dist/game/content/sailing/Sailing");
const { Mobile } = require("../dist/game/entity/impl/Mobile");
const { Inventory } = require("../dist/game/model/container/impl/Inventory");
const { Item } = require("../dist/game/model/Item");
const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
const { emptySailingState, normalizeSailingState } = require("../dist/game/content/sailing/SailingState");

ItemDefinition.forId = (id) => ({ getId: () => id, getName: () => "Coins", isStackable: () => id === 995, isNoted: () => false });

const DOCK = { id: "port_sarim", mooring: { fineX: 3074 * 128 + 64, fineY: 2987 * 128 + 64, level: 0, angle: NORTH }, landing: { x: 3069, y: 2987, z: 0 } };
Sailing.initialize();
Sailing.registerBoatType(RAFT);
Sailing.registerDock(DOCK);

let nextIndex = 100;
/** A player built on the real Mobile prototype, so teleports run through moveTo's listeners. */
function sailor(sailing = emptySailingState()) {
  const player = Object.create(Mobile.prototype);
  const index = nextIndex++;
  const messages = [];
  let location = new Location(3069, 2987, 0);
  Object.assign(player, {
    messages,
    getIndex: () => index,
    isPlayer: () => true,
    isNpc: () => false,
    getAsPlayer: () => player,
    getUsername: () => "alice",
    sendMessage: (message) => messages.push(message),
    getLocation: () => location,
    setLocation: (next) => { location = next; return player; },
    getMovementQueue: () => ({ reset() {}, handleRegionChange() {} }),
    setNeedsPlacement() {},
    setResetMovementQueue() {},
    setMobileInteraction() {},
    getSailing: () => sailing,
    setSailing: (next) => { sailing = next; },
    getPacketSender: () => new Proxy({}, { get: (_t, _k, proxy) => () => proxy }),
  });
  player.inventory = new Inventory(player);
  player.inventory.resetItems();
  player.getInventory = () => player.inventory;
  return player;
}

function tileOf(player) {
  const location = player.getLocation();
  return [location.getX(), location.getY(), location.getZ()];
}

test("boarding at the dock puts the player on the deck of their boat, at sea", () => {
  const player = sailor();
  Sailing.giveBoat(player, "raft", DOCK.id, "Lady Luck");
  assert.equal(Sailing.board(player, DOCK.id), null);
  const boat = BoatManager.getBoatAboard(player);
  assert.ok(boat);
  assert.deepEqual(tileOf(player), [boat.deckBaseX + 3, boat.deckBaseY + 4, 0]);
  assert.equal(Sailing.activeBoat(player).location.kind, "at_sea");
  assert.deepEqual(player.getSailing().returnPoint, DOCK.landing);
  assert.equal(Sailing.board(player, DOCK.id), "You're already on a boat.");
  Sailing.disembark(player, DOCK.id);
});

test("boarding is refused with no boat here", () => {
  assert.equal(Sailing.board(sailor(), DOCK.id), "You don't have a boat moored here.");
});

test("disembarking moors the boat at the dock and removes it from the sea", () => {
  const player = sailor();
  Sailing.giveBoat(player, "raft", DOCK.id);
  Sailing.board(player, DOCK.id);
  const boat = BoatManager.getBoatAboard(player);

  assert.equal(Sailing.disembark(player, DOCK.id), null);

  assert.deepEqual(Sailing.activeBoat(player).location, { kind: "docked", dock: DOCK.id });
  assert.deepEqual(tileOf(player), [3069, 2987, 0]);
  assert.equal(BoatManager.getBoatAboard(player), undefined);
  assert.equal(BoatManager.getBoat(boat.entityIndex), undefined);
  assert.equal(player.getArea(), null);
});

test("teleporting off the boat sinks it; a shipwright recovers it for 250 coins", () => {
  const player = sailor();
  Sailing.giveBoat(player, "raft", DOCK.id);
  Sailing.board(player, DOCK.id);
  const boat = BoatManager.getBoatAboard(player);

  player.moveTo(new Location(3222, 3218, 0)); // any teleport: spell, tablet, command, death

  assert.deepEqual(Sailing.activeBoat(player).location, { kind: "sunk" });
  assert.equal(BoatManager.getBoat(boat.entityIndex), undefined);
  assert.deepEqual(tileOf(player), [3222, 3218, 0], "the teleport itself still happens");
  assert.equal(Sailing.board(player, DOCK.id), "Your boat has sunk. A shipwright can recover it for you.");

  assert.equal(Sailing.recover(player, DOCK.id, () => 250), "You need 250 coins to recover your boat.");
  player.getInventory().add(new Item(995, 300), false);
  assert.equal(Sailing.recover(player, DOCK.id, () => 250), "Your boat has been recovered and is moored here.");
  assert.equal(player.getInventory().getAmount(995), 50);
  assert.deepEqual(Sailing.activeBoat(player).location, { kind: "docked", dock: DOCK.id });
  assert.equal(Sailing.board(player, DOCK.id), null);
  Sailing.disembark(player, DOCK.id);
});

test("moving about on the deck is not a teleport off the boat", () => {
  const player = sailor();
  Sailing.giveBoat(player, "raft", DOCK.id);
  Sailing.board(player, DOCK.id);
  const boat = BoatManager.getBoatAboard(player);
  player.moveTo(new Location(boat.deckBaseX + 3, boat.deckBaseY + 2, 0));
  assert.equal(Sailing.activeBoat(player).location.kind, "at_sea");
  assert.equal(BoatManager.getBoatAboard(player), boat);
  Sailing.disembark(player, DOCK.id);
});

test("Escape sinks the boat and returns the player to their last dock", () => {
  const player = sailor();
  Sailing.giveBoat(player, "raft", DOCK.id);
  Sailing.board(player, DOCK.id);

  Sailing.escape(player);

  assert.deepEqual(Sailing.activeBoat(player).location, { kind: "sunk" });
  assert.deepEqual(tileOf(player), [3069, 2987, 0]);
  assert.equal(BoatManager.getBoatAboard(player), undefined);
});

test("the boat's position is recorded every tick, so a save at sea restores it", () => {
  const player = sailor();
  Sailing.giveBoat(player, "raft", DOCK.id);
  Sailing.board(player, DOCK.id);
  const boat = BoatManager.getBoatAboard(player);
  boat.moveMode = BoatMoveMode.Full;
  const sailable = BoatManager.isSailable;
  BoatManager.isSailable = () => true;
  try {
    BoatManager.tick();
  } finally {
    BoatManager.isSailable = sailable;
  }
  assert.deepEqual(Sailing.activeBoat(player).location,
    { kind: "at_sea", fineX: boat.fineX, fineY: boat.fineY, level: 0, angle: boat.angle });
  assert.equal(boat.fineY, DOCK.mooring.fineY + 192);
  Sailing.disembark(player, DOCK.id);
});

test("logging out at sea keeps the boat at sea, and logging in puts the player back aboard", () => {
  const player = sailor();
  Sailing.giveBoat(player, "raft", DOCK.id);
  Sailing.board(player, DOCK.id);
  const boat = BoatManager.getBoatAboard(player);
  boat.fineX += 640;
  boat.angle = EAST;

  Sailing.onLogout(player);

  const saved = normalizeSailingState(JSON.parse(JSON.stringify(player.getSailing())));
  assert.deepEqual(saved.boats[0].location, { kind: "at_sea", fineX: boat.fineX, fineY: boat.fineY, level: 0, angle: EAST });
  assert.deepEqual(tileOf(player), [3069, 2987, 0], "saved ashore in case the boat can't be restored");
  assert.equal(BoatManager.getBoat(boat.entityIndex), undefined, "disposed after the state is recorded");

  const returning = sailor(saved);
  Sailing.onLogin(returning);
  const restored = BoatManager.getBoatAboard(returning);
  assert.ok(restored);
  assert.deepEqual([restored.fineX, restored.fineY, restored.angle], [boat.fineX, boat.fineY, EAST]);
  assert.deepEqual(tileOf(returning), [restored.deckBaseX + 3, restored.deckBaseY + 4, 0]);
  Sailing.disembark(returning, DOCK.id);
});

test("a save on a deck with no boat to return to lands the player ashore", () => {
  const player = sailor({ boats: [], activeBoatSlot: null, returnPoint: { x: 3069, y: 2987, z: 0 } });
  player.setLocation(new Location(9627, 9636, 0));
  Sailing.onLogin(player);
  assert.deepEqual(tileOf(player), [3069, 2987, 0]);
});

test("saved sailing state drops anything malformed", () => {
  assert.deepEqual(normalizeSailingState(undefined), emptySailingState());
  assert.deepEqual(normalizeSailingState({
    boats: [
      { slot: 0, type: "raft", name: "A", location: { kind: "docked", dock: "port_sarim" } },
      { slot: 0, type: "raft", location: { kind: "docked", dock: "x" } },
      { slot: 1, type: "raft", location: { kind: "at_sea", fineX: "no" } },
      { type: "raft" },
    ],
    activeBoatSlot: 9,
    returnPoint: { x: 1 },
  }), {
    boats: [
      { slot: 0, type: "raft", name: "A", hitpoints: 0, facilities: [], location: { kind: "docked", dock: "port_sarim" } },
      { slot: 1, type: "raft", name: "", hitpoints: 0, facilities: [], location: { kind: "sunk" } },
    ],
    activeBoatSlot: null,
    returnPoint: null,
  });
});

// --- Content plugins.

test("the sail buttons follow their labels for each move mode", () => {
  const { sailButtonTransition } = require("../plugins/skills/sailing/Helm.plugin");
  // mode: 0 stopped, 1 slow, 2 fast, 3 reversing, 4 moored
  const table = [0, 1, 2, 3, 4].map((mode) => [0, 1, 2].map((slot) => sailButtonTransition(slot, mode) ?? "-"));
  assert.deepEqual(table, [
    ["full", "reverse", "half"],
    ["stop", "stop", "full"],
    ["stop", "half", "-"],
    ["stop", "-", "stop"],
    ["full", "reverse", "half"],
  ]);
  assert.equal(sailButtonTransition(3, 0), undefined);
});

function registerPlugin(file) {
  const hooks = { objects: {}, npcs: {}, events: {}, interfaceClicks: [] };
  require(`../plugins/skills/sailing/${file}`).register({
    onObjectInteraction: (name, actions) => { hooks.objects[name] = actions; },
    onNpcInteraction: (name, actions) => { hooks.npcs[name] = actions; },
    onCustomEvent: (name, handler) => { hooks.events[name] = handler; },
    onInterfaceActionClick: (handler) => hooks.interfaceClicks.push(handler),
    sendMultiChatboxPrompt: (_player, title, ...pairs) => { hooks.prompt = { title, pairs }; },
  });
  return hooks;
}

test("the sailing plugins register their hooks and load the boat and dock data", () => {
  assert.deepEqual(Object.keys(registerPlugin("Gangplank.plugin").objects.Gangplank), ["Board", "Disembark"]);
  const helm = registerPlugin("Helm.plugin");
  assert.deepEqual(Object.keys(helm.objects.Helm), ["Navigate", "Stop-navigating", "Escape"]);
  assert.equal(helm.interfaceClicks.length, 1);
  assert.deepEqual(Object.keys(registerPlugin("Sailing.plugin").events).sort(), ["sailing:boarded", "sailing:left"]);
  assert.deepEqual(Object.keys(registerPlugin("Shipwright.plugin").npcs), ["Junior Jim"]);
  assert.ok(Sailing.getDock("the_pandemonium"));
});

test("the helm's Escape asks first and only sinks the boat on yes", () => {
  const helm = registerPlugin("Helm.plugin");
  const player = sailor();
  Sailing.giveBoat(player, "raft", DOCK.id);
  Sailing.board(player, DOCK.id);

  helm.objects.Helm.Escape({ player });
  const [yes, onYes, no, onNo] = helm.prompt.pairs;
  assert.deepEqual([yes, no], ["Yes, abandon ship.", "No."]);
  onNo();
  assert.ok(Sailing.instanceAboard(player));
  onYes();
  assert.equal(Sailing.instanceAboard(player), undefined);
  assert.equal(Sailing.activeBoat(player).location.kind, "sunk");
});

test("Junior Jim recovers a sunk raft at The Pandemonium for 250 coins", () => {
  const shipwright = registerPlugin("Shipwright.plugin").npcs["Junior Jim"]["Recover-boat"];
  const player = sailor();
  Sailing.giveBoat(player, "raft", "the_pandemonium");
  Sailing.activeBoat(player).location = { kind: "sunk" };
  player.getInventory().add(new Item(995, 1000), false);

  shipwright({ player, npc: { getDefinition: () => ({ getName: () => "Junior Jim" }) } });

  assert.deepEqual(Sailing.activeBoat(player).location, { kind: "docked", dock: "the_pandemonium" });
  assert.equal(player.getInventory().getAmount(995), 750);
  assert.deepEqual(player.messages, ["Your boat has been recovered and is moored here."]);
});

test("a boat's deck locs exist on the deck level people stand on, so clicks resolve", () => {
  const boat = BoatManager.spawn(1, { ...RAFT, locs: [{ id: 59554, x: 3, y: 4, level: 1, shape: 10, rotation: 0 }] }, AT_SEA);
  try {
    const [helm] = BoatManager.getDeck(boat).getObjects();
    assert.equal(helm.getId(), 59554);
    assert.deepEqual([helm.getLocation().getX(), helm.getLocation().getY(), helm.getLocation().getZ()],
      [boat.deckBaseX + 3, boat.deckBaseY + 4, 0]);
    assert.equal(helm.getPrivateArea(), BoatManager.getDeck(boat));
  } finally {
    BoatManager.dispose(boat);
  }
});

test("::raft gives a raft moored at The Pandemonium; ::boatinfo lists boats", () => {
  const commands = {};
  require("../plugins/skills/sailing/SailingCommands.plugin").register({
    registerCommand: (name, handler) => { commands[name] = handler; },
  });
  const player = sailor();
  commands.raft({ player, parts: ["raft"] });
  assert.deepEqual(Sailing.activeBoat(player).location, { kind: "docked", dock: "the_pandemonium" });
  commands.boatinfo({ player, parts: ["boatinfo"] });
  assert.deepEqual(player.messages, [
    "A raft is moored for you at The Pandemonium (slot 0).",
    'Slot 0: raft "Raft", docked at the_pandemonium (active)',
  ]);
});

test("leaving the boat by logging out sends nothing to the (closed) client", () => {
  const { events } = registerPlugin("Sailing.plugin");
  let sent = 0;
  const player = { getPacketSender: () => { sent++; throw new Error("the socket is closed"); } };
  assert.doesNotThrow(() => events["sailing:left"]({ player, reason: "logout" }));
  assert.equal(sent, 0);
});

test("the combat tab's View button shows the sailing sidepanel aboard, and Combat Options switches back", () => {
  const { WeaponInterfaceManager } = require("../dist/game/content/combat/WeaponInterfaceManager");
  const [switchTab] = registerPlugin("Sailing.plugin").interfaceClicks;
  const player = sailor();
  const mounted = [];
  const events = [];
  const sender = new Proxy({}, {
    get: (_t, key) => key === "sendSubInterface"
      ? (uid, group) => { mounted.push([uid >>> 16, uid & 0xffff, group]); return sender; }
      : key === "sendInterfaceFlagsRange"
        ? (uid, from, to, flags) => { events.push([uid >>> 16, uid & 0xffff, from, to, flags]); return sender; }
        : () => sender,
  });
  player.getPacketSender = () => sender;

  const click = (groupId, childId) => {
    const event = { player, groupId, childId, handled: false };
    switchTab(event);
    return event.handled;
  };
  assert.equal(click(593, 46), true);
  assert.deepEqual(mounted, [], "not aboard: nothing to show");

  Sailing.giveBoat(player, "raft", "the_pandemonium");
  Sailing.board(player, "the_pandemonium");
  click(593, 46);
  assert.deepEqual(mounted, [[161, 76, 937]]);
  assert.deepEqual(events, [[937, 1, 0, 31, 2]], "the runtime-built View Combat Options button can be clicked");

  const assign = WeaponInterfaceManager.assign;
  let restored = 0;
  WeaponInterfaceManager.assign = () => { restored++; };
  try {
    assert.equal(click(937, 1), true);
  } finally {
    WeaponInterfaceManager.assign = assign;
  }
  assert.equal(restored, 1);
  assert.equal(click(593, 12), false, "other combat buttons are left alone");
  Sailing.disembark(player, "the_pandemonium");
});
