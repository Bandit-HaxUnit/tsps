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

test("full sail moves 64 fine units a tick, half sail 32", () => {
  const boat = makeRaft(NORTH);
  boat.moveMode = BoatMoveMode.Full;
  const startY = boat.fineY;
  tickBoat(boat, openSea);
  assert.equal(boat.fineY - startY, 64);
  boat.moveMode = BoatMoveMode.Half;
  tickBoat(boat, openSea);
  assert.equal(boat.fineY - startY, 96);
});

test("reverse keeps the bow on the heading and backs up at half speed", () => {
  const boat = makeRaft(NORTH);
  boat.moveMode = BoatMoveMode.Reverse;
  const startY = boat.fineY;
  tickBoat(boat, openSea);
  assert.equal(boat.angle, NORTH);
  assert.equal(boat.fineY - startY, -32);
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
