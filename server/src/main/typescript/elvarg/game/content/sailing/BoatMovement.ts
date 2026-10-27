import { type Boat, BoatMoveMode } from "./Boat";
import { type SailableTileCheck, canOccupy } from "./BoatCollision";
import { angleToFineDelta, normalizeAngle, reverseAngle, turnAngleDelta } from "./HeadingUtils";

/*
 * Per-tick boat movement. Full sail moves the boat's base speed, set by its hull (the wiki's
 * base speeds: wooden 1.5 tiles a tick, teak 2, camphor 2.5); half sail moves half that,
 * turning or not. The turn rate comes from rsmod's
 * `BoatMovement.kt` and its live traces (https://github.com/rsmod/rsmod, ISC license): 128
 * angle units a tick.
 *
 * The boat doesn't take the sails' speed at once: it gains or loses its acceleration a tick until
 * it gets there, half a tile with most sails (rsprox, a sloop's world entity: full sail from
 * rest 0.5, 1, 1.5, 2 tiles a tick; stopped from 2.5, 2, 1.5, 1, 0.5, 0), so a stopped boat
 * drifts on for a few tiles. Camphor sails and better add their extra acceleration (table 164).
 *
 * Unlike rsmod, reverse keeps the bow on the helm heading and backs up at half speed instead
 * of turning the boat around.
 */
export const TURN_RATE = 128;
/** A raft's (wooden hull) full sail speed; each boat sails at its hull's base speed. */
export const FULL_SAIL_SPEED = 192;
export const HALF_SAIL_SPEED = FULL_SAIL_SPEED / 2;
/** A move is checked in steps of at most half a tile, so a fast boat can't hop over land. */
const MOVE_STEP = 64;

export interface BoatStep {
    moved: boolean;
    turned: boolean;
    /** The hull hit something it can't sail over this tick. */
    blocked: boolean;
}

/** The speed the sails drive the boat at, in fine units a tick along the bow (negative in reverse). */
export function sailVelocity(boat: Boat): number {
    const sailSpeed = boat.boostSpeed ?? boat.baseSpeed;
    switch (boat.moveMode) {
        case BoatMoveMode.Full:
            return sailSpeed;
        case BoatMoveMode.Half:
            return sailSpeed / 2;
        case BoatMoveMode.Reverse:
            return -sailSpeed / 2;
        default:
            return 0;
    }
}

export function tickBoat(boat: Boat, isSailable: SailableTileCheck): BoatStep {
    const step: BoatStep = { moved: false, turned: false, blocked: false };
    const target = sailVelocity(boat);
    boat.velocity += Math.max(-boat.acceleration, Math.min(boat.acceleration, target - boat.velocity));
    if (boat.velocity === 0) return step;

    // Turning doesn't cost speed: the boat swings towards its heading, then sails on at its
    // speed along the new facing.
    const delta = turnAngleDelta(boat.angle, boat.heading);
    if (delta !== 0) {
        const angle = normalizeAngle(boat.angle + Math.max(-TURN_RATE, Math.min(TURN_RATE, delta)));
        if (canOccupy(boat, boat.fineX, boat.fineY, angle, isSailable)) {
            boat.angle = angle;
            step.turned = true;
        }
    }

    const distance = Math.abs(boat.velocity) * Math.max(1, boat.speedMultiplier);
    const travel = boat.velocity < 0 ? reverseAngle(boat.angle) : boat.angle;
    const startX = boat.fineX;
    const startY = boat.fineY;
    for (let travelled = 0; travelled < distance; ) {
        travelled = Math.min(distance, travelled + MOVE_STEP);
        const partial = angleToFineDelta(travel, travelled);
        const x = startX + partial.dx;
        const y = startY + partial.dy;
        if (!canOccupy(boat, x, y, boat.angle, isSailable)) {
            // Run aground: the way is lost.
            step.blocked = true;
            boat.velocity = 0;
            break;
        }
        applyPosition(boat, x, y, step);
    }
    return step;
}

function applyPosition(boat: Boat, x: number, y: number, step: BoatStep): void {
    if (x === boat.fineX && y === boat.fineY) return;
    boat.fineX = x;
    boat.fineY = y;
    step.moved = true;
}
