import assert from "node:assert/strict";
import { CollisionFlag } from "../common/CollisionFlag";
import { MovementDirection } from "../common/Direction";
import { PlayerMovementSync } from "../game/movement/PlayerMovementSync";
import { PlayerSyncContext } from "../game/sync/PlayerSyncContext";
import { PlayerUpdateDecoder } from "../game/sync/PlayerUpdateDecoder";
import {
    createPlayerSyncState,
    encodePlayerSync,
} from "../../server/src/main/typescript/elvarg/net/protocol/ClientProtocol";

const playerEcs = {
    setInteractionOrientationProvider() {},
    trimQueuedStepsAfter() {
        return true;
    },
    setServerPos() {
        return true;
    },
    setRunning() {},
    getInteractionIndex() {
        return -1;
    },
};

const movement = new PlayerMovementSync(
    playerEcs as any,
    undefined,
    undefined,
    undefined,
    undefined,
    (_plane, x, y) => (x === 1 && y === 0 ? CollisionFlag.OBJECT : 0),
);

movement.registerEntity({
    serverId: 1,
    ecsIndex: 0,
    tile: { x: 0, y: 0 },
    level: 0,
    subX: 64,
    subY: 64,
});

const { path } = movement.receiveUpdate({
    serverId: 1,
    ecsIndex: 0,
    x: (1 << 7) + 64,
    y: (1 << 7) + 64,
    level: 0,
    running: true,
    moved: true,
    directions: [MovementDirection.NorthEast],
    traversals: [2],
});

assert.equal(path.steps.length, 2);
assert.notEqual(path.steps[0].direction, MovementDirection.NorthEast);
assert.deepEqual(path.steps.at(-1)?.tile, { x: 1, y: 1 });

const start = { x: 3081, y: 3506, level: 0 };
const serverState = createPlayerSyncState(1, start);
const packet = encodePlayerSync(
    1,
    3040,
    3472,
    1,
    [{
        index: 1,
        x: 3080,
        y: 3507,
        level: 0,
        appearance: Buffer.alloc(0),
        movementType: 2,
    }],
    serverState,
);
const payload = packet.subarray(3);
const syncLength = payload.readUInt16BE(10);
const context = new PlayerSyncContext();
context.setBase(payload.readUInt16BE(0), payload.readUInt16BE(2));
context.setLocalIndex(1);
context.activate(1, start);
for (const index of context.emptyIndices) context.flags[index] = 1;

const frame = new PlayerUpdateDecoder().decode(
    payload.subarray(12, 12 + syncLength),
    context,
    { packetSize: syncLength, loopCycle: 1 },
);
assert.equal(frame.movements[0]?.mode, "run");
assert.equal(frame.movements[0]?.snap, undefined);
assert.equal(frame.movements[0]?.directions, undefined);
assert.deepEqual(frame.movements[0]?.tile, { x: 3080, y: 3507, level: 0 });

console.log("player run path reconstruction check passed");

// A one-tile moveTo (for example, placement onto a chair) must not be decoded
// as a walking step while its animation has already started.
for (const index of [1, 2]) {
    const state = createPlayerSyncState(1, start);
    const ctx = new PlayerSyncContext();
    ctx.setBase(3040, 3472);
    ctx.setLocalIndex(1);
    ctx.activate(1, start);
    for (const empty of ctx.emptyIndices) ctx.flags[empty] = 1;
    const views = [1, 2].map(id => ({ index: id, ...start, appearance: Buffer.alloc(0) }));
    const decode = (tick: number) => {
        const data = encodePlayerSync(tick, 3040, 3472, 1, views, state).subarray(3);
        const length = data.readUInt16BE(10);
        return new PlayerUpdateDecoder().decode(data.subarray(12, 12 + length), ctx,
            { packetSize: length, loopCycle: tick });
    };
    decode(1);
    Object.assign(views[index - 1], { y: start.y + 1, resetPath: true,
        animation: { id: 4103, delay: 0 }, faceDirection: 256 });
    const placed = decode(2);
    const move = placed.movements.find(event => event.index === index);
    assert.equal(move?.mode, "teleport", "placement must snap for both self and observers");
    assert.equal(move?.snap, true);
    assert.deepEqual(move?.tile, { ...start, y: start.y + 1 });
    assert.equal(placed.updateBlocks.get(index)?.faceDir, 256);
}
console.log("player placement reset checks passed");
