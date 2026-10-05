/**
 * The local player's attack timer, as the server sends it (ATTACK_TIMER): the ticks until their
 * next attack, whenever that changes (an attack, eating, a special). Kept as the server tick it
 * ends on, so it counts down with the ticks.
 */
let endsAtTick = 0;

export function setAttackTimer(ticks: number, currentTick: number): void {
    endsAtTick = (currentTick | 0) + Math.max(0, ticks | 0);
}

/** Ticks left until the next attack (0 when it is ready). */
export function getAttackTimerTicks(currentTick: number): number {
    return Math.max(0, endsAtTick - (currentTick | 0));
}
