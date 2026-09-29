import { type Boat, BoatMoveMode } from "./Boat";
import { type SailableTileCheck, canOccupy } from "./BoatCollision";
import { angleToFineDelta, normalizeAngle, reverseAngle, turnAngleDelta } from "./HeadingUtils";

/*
 * Per-tick boat movement. Rates come from rsmod's `BoatMovement.kt` and its live traces
 * (https://github.com/rsmod/rsmod, ISC license): full sail moves 64 fine units a tick (a tile
 * every 2 ticks), half sail 32, and turning rotates 128 angle units a tick while sliding 64.
 *
 * Unlike rsmod, reverse keeps the bow on the helm heading and backs up at half speed instead
 * of turning the boat around.
 */
export const TURN_RATE = 128;
export const FULL_SAIL_SPEED = 64;
export const HALF_SAIL_SPEED = 32;
export const TURN_SLIDE_SPEED = 64;

export interface BoatStep {
    moved: boolean;
    turned: boolean;
    /** The hull hit something it can't sail over this tick. */
    blocked: boolean;
}

export function tickBoat(boat: Boat, isSailable: SailableTileCheck): BoatStep {
    const step: BoatStep = { moved: false, turned: false, blocked: false };
    if (boat.moveMode === BoatMoveMode.Stopped) return step;

    const multiplier = Math.max(1, boat.speedMultiplier);
    const delta = turnAngleDelta(boat.angle, boat.heading);
    if (delta !== 0) {
        const angle = normalizeAngle(boat.angle + Math.max(-TURN_RATE, Math.min(TURN_RATE, delta)));
        const slide = angleToFineDelta(travelAngle(boat, angle), TURN_SLIDE_SPEED * multiplier);
        const x = boat.fineX + slide.dx;
        const y = boat.fineY + slide.dy;
        if (canOccupy(boat, x, y, angle, isSailable)) {
            applyPosition(boat, x, y, step);
        } else if (!canOccupy(boat, boat.fineX, boat.fineY, angle, isSailable)) {
            step.blocked = true;
            return step;
        }
        boat.angle = angle;
        step.turned = true;
        return step;
    }

    const speed =
        boat.moveMode === BoatMoveMode.Full ? FULL_SAIL_SPEED : HALF_SAIL_SPEED;
    const move = angleToFineDelta(travelAngle(boat, boat.angle), speed * multiplier);
    const x = boat.fineX + move.dx;
    const y = boat.fineY + move.dy;
    if (canOccupy(boat, x, y, boat.angle, isSailable)) {
        applyPosition(boat, x, y, step);
    } else {
        step.blocked = true;
    }
    return step;
}

function travelAngle(boat: Boat, facing: number): number {
    return boat.moveMode === BoatMoveMode.Reverse ? reverseAngle(facing) : facing;
}

function applyPosition(boat: Boat, x: number, y: number, step: BoatStep): void {
    if (x === boat.fineX && y === boat.fineY) return;
    boat.fineX = x;
    boat.fineY = y;
    step.moved = true;
}
