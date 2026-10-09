import { strict as assert } from "node:assert";

import { Scene } from "../rs/scene/Scene";
import { SceneBuilder } from "../rs/scene/SceneBuilder";
import { INVALID_HSL_COLOR } from "../rs/util/ColorUtil";

/**
 * Floor holes (ladder and trapdoor openings) are tiles the map gives no floor. They must draw
 * a dark surface so the sky is not visible through the opening, while unloaded map edges must
 * stay open to the sky.
 */
function floorHolesDrawDark(): void {
    const scene = new Scene(1, 12, 12);
    for (let x = 0; x < scene.sizeX; x++) {
        for (let y = 0; y < scene.sizeY; y++) {
            scene.tileUnderlays[0][x][y] = 1; // a real floor type
        }
    }
    scene.tileUnderlays[0][6][6] = 0; // enclosed floor hole
    scene.tileUnderlays[0][0][6] = 0; // unloaded map edge

    const floorType = {
        getHueBlend: () => 0,
        getHueMultiplier: () => 1,
        saturation: 0,
        lightness: 0,
    };
    const builder = new SceneBuilder(
        {} as any,
        {} as any,
        { load: () => floorType } as any,
        {} as any,
        {} as any,
        {} as any,
        new Map(),
    );
    builder.addTileModels(scene, false);

    const hole = scene.tiles[0][6][6]?.tileModel;
    assert.ok(hole, "an enclosed floor hole gets a tile model");
    assert.notEqual(hole.underlayHslSw, INVALID_HSL_COLOR, "the hole surface is drawn");
    assert.ok((hole.underlayHslSw & 0x7f) < 16, "the hole surface is near-black");

    const edge = scene.tiles[0][0][6]?.tileModel;
    assert.equal(edge, undefined, "an unloaded map edge stays open");

    const floor = scene.tiles[0][5][6]?.tileModel;
    assert.ok(floor, "normal floor tiles still build");
}

floorHolesDrawDark();
