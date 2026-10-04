import { LocModelType } from "../config/loctype/LocModelType";

export type WallDecorationShift = {
    x: number;
    y: number;
};

const DIAGONAL_DISPLACEMENT_X = [1, -1, -1, 1] as const;
const DIAGONAL_DISPLACEMENT_Y = [-1, -1, 1, 1] as const;

function isDiagonalDecoration(type: LocModelType): boolean {
    return (
        type === LocModelType.WALL_DECORATION_DIAGONAL_OUTSIDE ||
        type === LocModelType.WALL_DECORATION_DIAGONAL_INSIDE ||
        type === LocModelType.WALL_DECORATION_DIAGONAL_DOUBLE
    );
}

/**
 * Returns the render-time correction needed when a diagonal wall decoration is
 * embedded in a shape-9 diagonal wall whose authored thickness faces the
 * opposite direction.
 *
 * Shape-9 walls are stored as scene locs rather than tile.wall, so SceneBuilder
 * cannot reliably derive this correction from getWallTag().
 */
export function embeddedWallDecorationShift(
    decorationType: LocModelType,
    decorationRotation: number,
    wallType: LocModelType,
    wallRotation: number,
    wallDisplacement: number,
): WallDecorationShift {
    if (!isDiagonalDecoration(decorationType) || wallType !== LocModelType.WALL_DIAGONAL) {
        return { x: 0, y: 0 };
    }

    const decRot = decorationRotation & 3;
    const wallRot = wallRotation & 3;
    if (wallRot !== ((decRot + 2) & 3)) {
        return { x: 0, y: 0 };
    }

    const displacement = (wallDisplacement / 2) | 0;
    return {
        x: displacement * DIAGONAL_DISPLACEMENT_X[wallRot],
        y: displacement * DIAGONAL_DISPLACEMENT_Y[wallRot],
    };
}
