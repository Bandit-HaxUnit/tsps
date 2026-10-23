// Pure geometry for the map-editing tools: turns a shape description into the list
// of tiles it covers. No world state, no I/O, so it is cheap to unit test and cheap
// for an agent to compose - a whole city is a handful of these calls rather than
// hundreds of place_object calls.
//
// Every function returns [{ x, y }], de-duplicated, in a stable order.

const ROUND = Math.round;

/** Tiles along a straight line, both ends included. */
function line(x1, y1, x2, y2) {
  const tiles = [];
  const dx = x2 - x1;
  const dy = y2 - y1;
  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  if (steps === 0) return [{ x: ROUND(x1), y: ROUND(y1) }];
  for (let i = 0; i <= steps; i++) {
    tiles.push({
      x: ROUND(x1 + (dx * i) / steps),
      y: ROUND(y1 + (dy * i) / steps),
    });
  }
  return unique(tiles);
}

/**
 * Ring of tiles at `radius` from a centre. `thickness` grows it outward;
 * `gapDegrees` opens an arc centred on `gapAngle` (0 = east, 90 = north).
 */
function ring(cx, cy, radius, options = {}) {
  const thickness = Math.max(1, options.thickness ?? 1);
  const gapDegrees = options.gapDegrees ?? 0;
  const gapAngle = options.gapAngle ?? 0;
  const limit = radius + 2;
  const tiles = [];
  for (let x = Math.floor(cx - limit); x <= Math.ceil(cx + limit); x++) {
    for (let y = Math.floor(cy - limit); y <= Math.ceil(cy + limit); y++) {
      const distance = Math.hypot(x - cx, y - cy);
      const outer = radius + (thickness - 1) / 2;
      const inner = radius - thickness / 2 - 0.5;
      if (distance > outer + 0.5 || distance < inner) continue;
      if (gapDegrees > 0) {
        const angle = (Math.atan2(y - cy, x - cx) * 180) / Math.PI;
        const delta = Math.abs(((angle - gapAngle + 540) % 360) - 180);
        if (delta <= gapDegrees / 2) continue;
      }
      tiles.push({ x, y });
    }
  }
  return unique(tiles);
}

/** Rectangle outline. `doorSide` opens a 1-tile doorway at the middle of that side. */
function box(x1, y1, x2, y2, options = {}) {
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);
  const doorSide = options.doorSide;
  const doorWidth = Math.max(1, options.doorWidth ?? 1);
  const midX = ROUND((minX + maxX) / 2);
  const midY = ROUND((minY + maxY) / 2);
  const halfDoor = Math.floor(doorWidth / 2);
  const inDoorway = (x, y) => {
    if (!doorSide) return false;
    if (doorSide === "north" && y === maxY) return Math.abs(x - midX) <= halfDoor;
    if (doorSide === "south" && y === minY) return Math.abs(x - midX) <= halfDoor;
    if (doorSide === "east" && x === maxX) return Math.abs(y - midY) <= halfDoor;
    if (doorSide === "west" && x === minX) return Math.abs(y - midY) <= halfDoor;
    return false;
  };
  const tiles = [];
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      const onEdge = x === minX || x === maxX || y === minY || y === maxY;
      if (!onEdge || inDoorway(x, y)) continue;
      tiles.push({ x, y });
    }
  }
  return unique(tiles);
}

/** Filled square/rectangle: a tower or keep footprint. */
function tower(x, y, size = 2, options = {}) {
  const width = Math.max(1, options.width ?? size);
  const height = Math.max(1, options.height ?? size);
  const tiles = [];
  for (let dx = 0; dx < width; dx++) {
    for (let dy = 0; dy < height; dy++) tiles.push({ x: x + dx, y: y + dy });
  }
  return unique(tiles);
}

/** Tiles spaced every `spacing` along a line: pillars, braziers, lamps. */
function repeated(x1, y1, x2, y2, spacing = 4) {
  const path = line(x1, y1, x2, y2);
  return path.filter((_, index) => index % Math.max(1, spacing) === 0);
}

/** Two parallel rows offset from a centre line: an avenue of lamps or braziers. */
function avenue(x1, y1, x2, y2, options = {}) {
  const offset = Math.max(1, options.offset ?? 3);
  const spacing = Math.max(1, options.spacing ?? 4);
  const horizontal = Math.abs(x2 - x1) >= Math.abs(y2 - y1);
  const tiles = [];
  for (const tile of repeated(x1, y1, x2, y2, spacing)) {
    if (horizontal) tiles.push({ x: tile.x, y: tile.y + offset }, { x: tile.x, y: tile.y - offset });
    else tiles.push({ x: tile.x + offset, y: tile.y }, { x: tile.x - offset, y: tile.y });
  }
  return unique(tiles);
}

/** Rotate a tile list around the origin tile (0/90/180/270 degrees). */
function rotate(tiles, degrees, originX, originY) {
  const turns = (((degrees % 360) + 360) % 360) / 90;
  let out = tiles.map((tile) => ({ x: tile.x, y: tile.y }));
  for (let turn = 0; turn < turns; turn++) {
    out = out.map((tile) => ({
      x: originX + (tile.y - originY),
      y: originY - (tile.x - originX),
    }));
  }
  return unique(out);
}

/** Wall facing: 1 on north/south runs, 0 on east/west, matching the cache's loc rotation. */
function facingFor(cx, cy, x, y) {
  return Math.abs(x - cx) > Math.abs(y - cy) ? 1 : 0;
}

/** Shapes whose footprint is the loc's own size: scenery (10, 11) and ground decoration (22). */
const SIZED_SHAPES = new Set([10, 11, 22]);

/**
 * The tiles a loc covers at rotation `face`: its size for scenery and ground decoration
 * (swapped on a quarter turn), one tile for walls, wall decoration and roofs.
 */
function footprint(shape, face, sizeX = 1, sizeY = 1) {
  if (!SIZED_SHAPES.has(shape)) return { width: 1, height: 1 };
  return face % 2 === 1 ? { width: sizeY, height: sizeX } : { width: sizeX, height: sizeY };
}

/**
 * Turns a loc inside a width x height template a quarter turn clockwise, `turns` times,
 * keeping the template's low corner at 0,0. The cache's rotation is quarter turns clockwise
 * from west (0 west, 1 north, 2 east, 3 south), so each turn adds one to `face`; the loc's
 * position is its low corner, so a sized loc moves by its own footprint.
 */
function rotateLoc(loc, turns, width, height, sizeX = 1, sizeY = 1) {
  let out = { ...loc };
  let w = width;
  let h = height;
  for (let turn = 0; turn < (((turns % 4) + 4) % 4); turn++) {
    const { width: fw } = footprint(out.type, out.face, sizeX, sizeY);
    out = { ...out, dx: out.dy, dy: w - out.dx - fw, face: (out.face + 1) & 3 };
    [w, h] = [h, w];
  }
  return out;
}

/** A tile offset inside a width x height template, turned like rotateLoc. */
function rotateOffset(dx, dy, turns, width, height) {
  let x = dx;
  let y = dy;
  let w = width;
  let h = height;
  for (let turn = 0; turn < (((turns % 4) + 4) % 4); turn++) {
    [x, y] = [y, w - 1 - x];
    [w, h] = [h, w];
  }
  return { dx: x, dy: y };
}

function unique(tiles) {
  const seen = new Set();
  const out = [];
  for (const tile of tiles) {
    const key = `${tile.x},${tile.y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tile);
  }
  return out;
}

module.exports = {
  line, ring, box, tower, repeated, avenue, rotate, facingFor, unique, footprint, rotateLoc, rotateOffset,
};
