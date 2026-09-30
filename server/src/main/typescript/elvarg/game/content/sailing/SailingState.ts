/** Where an owned boat is. */
export type BoatLocation =
    /** Moored at a dock (a port or mooring point). */
    | { kind: "docked"; dock: string }
    /** Out at sea with its owner, who logged out aboard; restored when they log in. */
    | { kind: "at_sea"; fineX: number; fineY: number; level: number; angle: number }
    /** Lost after a teleport, Escape or death at sea; a shipwright must recover it. */
    | { kind: "sunk" };

/** One slot of a boat's cargo hold. */
export interface CargoSlot {
    id: number;
    amount: number;
}

export interface OwnedBoat {
    slot: number;
    type: string;
    name: string;
    hitpoints: number;
    facilities: number[];
    location: BoatLocation;
    /** The cargo hold, by slot; `null` is an empty slot. */
    cargo: (CargoSlot | null)[];
}

export interface SailingState {
    boats: OwnedBoat[];
    /** The boat the player is aboard, or last set sail in. */
    activeBoatSlot: number | null;
    /** Where Escape sends the player: the last gangplank, mooring point or buoy used. */
    returnPoint: { x: number; y: number; z: number } | null;
    /** Tools compartment slots holding their tool; shared by all of the player's boats. */
    tools: number[];
}

export function emptySailingState(): SailingState {
    return { boats: [], activeBoatSlot: null, returnPoint: null, tools: [] };
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function normalizeLocation(raw: any): BoatLocation {
    if (raw?.kind === "docked" && typeof raw.dock === "string") return { kind: "docked", dock: raw.dock };
    if (raw?.kind === "at_sea" && finite(raw.fineX) && finite(raw.fineY) && finite(raw.angle)) {
        return { kind: "at_sea", fineX: raw.fineX, fineY: raw.fineY, level: finite(raw.level) ? raw.level : 0, angle: raw.angle };
    }
    return { kind: "sunk" };
}

function normalizeCargo(raw: unknown): (CargoSlot | null)[] {
    if (!Array.isArray(raw)) return [];
    return raw.map((slot) => Number.isInteger(slot?.id) && slot.id >= 0 && Number.isInteger(slot?.amount) && slot.amount > 0
        ? { id: slot.id, amount: slot.amount }
        : null);
}

/** Reads a saved sailing state, dropping anything malformed. Missing state is empty. */
export function normalizeSailingState(raw: any): SailingState {
    if (!raw || typeof raw !== "object") return emptySailingState();
    const boats: OwnedBoat[] = [];
    for (const boat of Array.isArray(raw.boats) ? raw.boats : []) {
        if (!Number.isInteger(boat?.slot) || typeof boat.type !== "string") continue;
        if (boats.some((existing) => existing.slot === boat.slot)) continue;
        boats.push({
            slot: boat.slot,
            type: boat.type,
            name: typeof boat.name === "string" ? boat.name : "",
            hitpoints: finite(boat.hitpoints) ? boat.hitpoints : 0,
            facilities: Array.isArray(boat.facilities) ? boat.facilities.filter(Number.isInteger) : [],
            location: normalizeLocation(boat.location),
            cargo: normalizeCargo(boat.cargo),
        });
    }
    const active = boats.some((boat) => boat.slot === raw.activeBoatSlot) ? raw.activeBoatSlot : null;
    const point = raw.returnPoint;
    const returnPoint = finite(point?.x) && finite(point?.y) && finite(point?.z)
        ? { x: point.x, y: point.y, z: point.z }
        : null;
    const tools = Array.isArray(raw.tools) ? [...new Set<number>(raw.tools.filter(Number.isInteger))] : [];
    return { boats, activeBoatSlot: active, returnPoint, tools };
}
