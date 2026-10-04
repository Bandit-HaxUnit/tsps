import assert from "node:assert/strict";
import { LocModelType } from "../rs/config/loctype/LocModelType";
import { embeddedWallDecorationShift } from "../rs/scene/WallDecorationOffset";

assert.deepEqual(
    embeddedWallDecorationShift(
        LocModelType.WALL_DECORATION_DIAGONAL_DOUBLE,
        1,
        LocModelType.WALL_DIAGONAL,
        3,
        16,
    ),
    { x: 8, y: 8 },
);

assert.deepEqual(
    embeddedWallDecorationShift(
        LocModelType.WALL_DECORATION_DIAGONAL_DOUBLE,
        3,
        LocModelType.WALL_DIAGONAL,
        1,
        16,
    ),
    { x: -8, y: -8 },
);

assert.deepEqual(
    embeddedWallDecorationShift(
        LocModelType.WALL_DECORATION_DIAGONAL_OUTSIDE,
        1,
        LocModelType.WALL_DIAGONAL,
        3,
        24,
    ),
    { x: 12, y: 12 },
);

assert.deepEqual(
    embeddedWallDecorationShift(
        LocModelType.WALL_DECORATION_DIAGONAL_DOUBLE,
        1,
        LocModelType.WALL_DIAGONAL,
        1,
        16,
    ),
    { x: 0, y: 0 },
);

assert.deepEqual(
    embeddedWallDecorationShift(
        LocModelType.WALL_DECORATION_DIAGONAL_DOUBLE,
        1,
        LocModelType.WALL,
        3,
        16,
    ),
    { x: 0, y: 0 },
);

console.log("embedded diagonal wall-decoration offset check passed");
