import { Boundary } from "../../model/Boundary";
import { Location } from "../../model/Location";
import { PrivateArea } from "../../model/areas/impl/PrivateArea";
import { RegionManager } from "../../collision/RegionManager";
import type { Boat } from "./Boat";
import type { BoatSpec } from "./BoatSpec";

/** A solid object on the deck (the flag loc shapes 9-11 set). */
const SOLID_OBJECT = 0x100;

/**
 * A boat's deck: its own scene far outside the real map, where everyone aboard stands.
 *
 * As a private area it gets tsps's per-area collision, pathfinding, object lookup and
 * visibility for free. Deck coordinates have no cache map region, so every tile would read as
 * walkable; the deck blocks its whole scene except the boat type's walkable tiles.
 */
export class BoatDeckArea extends PrivateArea {
    private readonly walkable = new Set<string>();
    private readonly solid = new Set<string>();

    constructor(readonly boat: Boat, spec: BoatSpec) {
        super([new Boundary(boat.sceneBaseX, boat.sceneBaseX + 103, boat.sceneBaseY, boat.sceneBaseY + 103, 0)]);
        for (const tile of spec.walkableDeck) {
            this.walkable.add(BoatDeckArea.key(boat.deckBaseX + tile.x, boat.deckBaseY + tile.y));
        }
        for (const loc of spec.locs) {
            if (loc.blocks) this.solid.add(BoatDeckArea.key(boat.deckBaseX + loc.x, boat.deckBaseY + loc.y));
        }
    }

    public hasClip(location: Location): boolean {
        return this.boat.containsDeckTile(location.getX(), location.getY()) || super.hasClip(location);
    }

    public getClip(location: Location): number {
        if (super.hasClip(location)) return super.getClip(location);
        if (!this.boat.containsDeckTile(location.getX(), location.getY())) return 0;
        // Everyone aboard stands on level 0 of the deck scene.
        if (location.getZ() !== 0) return RegionManager.BLOCKED_TILE;
        const key = BoatDeckArea.key(location.getX(), location.getY());
        if (!this.walkable.has(key)) return RegionManager.BLOCKED_TILE;
        return this.solid.has(key) ? SOLID_OBJECT : 0;
    }

    private static key(x: number, y: number): string {
        return `${x},${y}`;
    }
}
