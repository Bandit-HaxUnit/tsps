// Run after `yarn build`: node --test tests/sailing.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

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
