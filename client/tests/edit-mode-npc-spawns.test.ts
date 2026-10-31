import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { EditModePlugin } from "../game/plugins/editmode/EditModePlugin";
import { parseNpcSpawns } from "../game/plugins/editmode/hostProtocol/npcSpawnMessage";
import type { EditModeSelection } from "../game/plugins/editmode/types";

const dom = new JSDOM('<canvas tabindex="0"></canvas><input>', { pretendToBeVisual: true });
Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    KeyboardEvent: dom.window.KeyboardEvent,
    self: dom.window,
});
const canvas = document.querySelector("canvas")!;

{
    const spawns = parseNpcSpawns(JSON.stringify([
        { level: 0, name: "Goblin", wanderRadius: 3, x: 3222, y: 3218, id: 3 },
        { level: 0, name: "Elena", x: 2592, y: 3336, key: "ELENA_2" },
        { level: 1, name: "Removed", x: 3200, y: 3200, id: 4, remove: true },
    ]));
    assert.deepEqual(spawns, [
        { id: 3, tileX: 3222, tileY: 3218, plane: 0, wanderRadius: 3 },
    ], "spawn entries keep their tile and wander range; keyed and removed entries are skipped");
    assert.throws(() => parseNpcSpawns("[{\"x\":0,\"y\":0,\"level\":9}]"), "invalid planes are rejected");
}

type Call = [string, ...unknown[]];
const calls: Call[] = [];
let pointer = { tileX: 3222, tileY: 3218, plane: 0 };
let selected: EditModeSelection | undefined;
let nextServerId = 60000;

const plugin = new EditModePlugin();
plugin.attach({
    getCanvas: () => canvas,
    getPointerTile: () => pointer,
    getPointerLoc: () => undefined,
    selectPointer: () => selected!,
    getLocName: () => "Tree",
    getNpcName: () => "Goblin",
    search: async () => [],
    spawnNpc: (npcTypeId, tile, rotation) => {
        calls.push(["spawnNpc", npcTypeId, tile, rotation]);
        return nextServerId++;
    },
    despawnNpc: (serverId) => calls.push(["despawnNpc", serverId]),
    hideNpcSpawn: (spawn) => calls.push(["hideNpcSpawn", spawn]),
    showNpcSpawn: (spawn) => calls.push(["showNpcSpawn", spawn]),
    onLocAddChange: () => {},
    onLocDel: () => {},
    setTerrainOverlay: () => {},
    clearTerrainOverride: () => {},
    setFreeCamera: () => {},
    jumpCameraToTile: () => {},
    cancelPendingClick: () => {},
    levelCamera: () => {},
    isLoggedIn: () => true,
});
plugin.setConfig({ enabled: true, active: true, tool: "select" });

const spawnSelection = (): EditModeSelection => ({
    kind: "npc",
    ...pointer,
    locId: 3,
    locName: "Goblin",
    npcServerId: 60000,
    npcSource: "spawn",
    npcSpawn: { id: 3, tileX: pointer.tileX, tileY: pointer.tileY, plane: pointer.plane, direction: 2 },
    npcWanderRadius: 7,
});

// Selecting a persisted spawn exposes its wander range.
selected = spawnSelection();
plugin.applyAtPointer();
assert.equal(plugin.getState().selection?.npcSource, "spawn");
assert.equal(plugin.getState().selection?.npcWanderRadius, 7);

// Changing it stores a small override instead of a new spawn.
calls.length = 0;
plugin.setSelectionWanderRadius(0);
assert.deepEqual(calls, [], "changing the wander range touches no NPC geometry");
assert.deepEqual(plugin.getConfig().edits, [{
    kind: "npcWander",
    locId: 3,
    tileX: 3222,
    tileY: 3218,
    plane: 0,
    shape: 0,
    rotation: 0,
    wanderRadius: 0,
    direction: 2,
}]);
assert.equal(plugin.getState().selection?.npcWanderRadius, 0);
plugin.clearEdits();

// Delete key removes a selected spawn and records its removal.
selected = spawnSelection();
plugin.applyAtPointer();
calls.length = 0;
canvas.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Delete", code: "Delete", bubbles: true }));
assert.deepEqual(calls, [["hideNpcSpawn", { id: 3, tileX: 3222, tileY: 3218, plane: 0 }]]);
assert.deepEqual(plugin.getConfig().edits.map((edit) => edit.kind), ["npcDelete"]);
assert.equal(plugin.getState().selection, undefined, "a deleted NPC clears the selection");

// Delete key removes a selected object too.
plugin.clearEdits();
selected = { kind: "loc", ...pointer, locId: 1276, locName: "Tree", shape: 10, rotation: 0 };
plugin.applyAtPointer();
calls.length = 0;
canvas.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Delete", code: "Delete", bubbles: true }));
assert.deepEqual(plugin.getConfig().edits.map((edit) => edit.kind), ["delete"], "Delete key deletes the selected object");

// Moving a spawn hides the original and carries its range and facing to the new one.
plugin.clearEdits();
selected = spawnSelection();
plugin.applyAtPointer();
plugin.moveSelection();
assert.equal(plugin.getConfig().tool, "place");
assert.equal(plugin.getConfig().placeKind, "npc");
assert.equal(plugin.getConfig().npcId, 3);
calls.length = 0;
pointer = { tileX: 3226, tileY: 3218, plane: 0 };
plugin.applyAtPointer();
assert.deepEqual(plugin.getConfig().edits, [
    { kind: "npcDelete", locId: 3, tileX: 3222, tileY: 3218, plane: 0, shape: 0, rotation: 0 },
    {
        kind: "npc", locId: 3, tileX: 3226, tileY: 3218, plane: 0, shape: 10, rotation: 0,
        wanderRadius: 7, direction: 2,
    },
]);
assert.deepEqual(calls, [
    ["hideNpcSpawn", { id: 3, tileX: 3222, tileY: 3218, plane: 0 }],
    ["spawnNpc", 3, { tileX: 3226, tileY: 3218, plane: 0 }, 0],
]);
assert.equal(plugin.getConfig().tool, "select", "moving returns to the selection tool");

// A moved editor spawn has no removal marker, and its wander range stays on the edit.
plugin.clearEdits();
pointer = { tileX: 3230, tileY: 3218, plane: 0 };
plugin.setConfig({ tool: "place", placeKind: "npc", npcId: 3 });
plugin.applyAtPointer();
plugin.setConfig({ tool: "select" });
selected = {
    kind: "npc", ...pointer, locId: 3, locName: "Goblin", npcServerId: 60002,
    npcSource: "custom", npcWanderRadius: 5,
};
plugin.applyAtPointer();
calls.length = 0;
plugin.setSelectionWanderRadius(4);
assert.deepEqual(plugin.getConfig().edits, [{
    kind: "npc", locId: 3, tileX: 3230, tileY: 3218, plane: 0, shape: 10, rotation: 0, wanderRadius: 4,
}]);
assert.deepEqual(calls, [], "a custom spawn's range is stored on its own edit");

plugin.clearEdits();
dom.window.close();
console.log("Edit mode NPC spawn tests passed");
