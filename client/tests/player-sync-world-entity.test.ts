import assert from "node:assert/strict";
import { ClientState } from "../game/ClientState";
import { PlayerSyncContext } from "../game/sync/PlayerSyncContext";
import { PlayerUpdateDecoder } from "../game/sync/PlayerUpdateDecoder";
import {
    createPlayerSyncState,
    encodePlayerSync,
} from "../../server/src/main/typescript/elvarg/net/protocol/ClientProtocol";

// A player on a boat deck stands on tiles in the deck's own scene (9600+), far outside the main
// scene window around the tile under the boat. Walking there must still decode as walking, not
// as an out-of-scene snap.
const MAIN_BASE = { x: 3040, y: 2936 };
const deck = { x: 9603, y: 9602, level: 0 };

function decodeWalk(localIsWalker: boolean) {
    const walker = localIsWalker ? 1 : 2;
    const state = createPlayerSyncState(1, localIsWalker ? deck : { x: 3070, y: 2987, level: 0 });
    const ctx = new PlayerSyncContext();
    ctx.setBase(MAIN_BASE.x, MAIN_BASE.y);
    ctx.setLocalIndex(1);
    ctx.activate(1, localIsWalker ? deck : { x: 3070, y: 2987, level: 0 });
    if (!localIsWalker) ctx.activate(2, deck);
    for (const empty of ctx.emptyIndices) ctx.flags[empty] = 1;
    const views = localIsWalker
        ? [{ index: 1, ...deck, appearance: Buffer.alloc(0) }]
        : [
              { index: 1, x: 3070, y: 2987, level: 0, appearance: Buffer.alloc(0) },
              { index: 2, ...deck, appearance: Buffer.alloc(0) },
          ];
    const decode = (tick: number) => {
        const data = encodePlayerSync(1, MAIN_BASE.x, MAIN_BASE.y, tick, views, state).subarray(3);
        const length = data.readUInt16BE(10);
        return new PlayerUpdateDecoder().decode(data.subarray(12, 12 + length), ctx, {
            packetSize: length,
            loopCycle: tick,
        });
    };
    decode(1);
    Object.assign(views[views.length - 1], { y: deck.y + 1, movementType: 1 });
    return decode(2).movements.find((event) => event.index === walker);
}

const isDeckTile = (tileX: number, tileY: number) => tileX >= 9600 && tileY >= 9600;
try {
    ClientState.isWorldEntityTile = isDeckTile;
    for (const local of [true, false]) {
        const move = decodeWalk(local);
        const who = local ? "the local player" : "another player";
        assert.equal(move?.mode, "walk", `${who} walking on deck walks`);
        assert.equal(move?.snap, undefined, `${who} walking on deck doesn't snap`);
        assert.deepEqual(move?.tile, { ...deck, y: deck.y + 1 });
    }

    // Off a world entity, a tile outside the main scene still snaps as before.
    ClientState.isWorldEntityTile = () => false;
    assert.equal(decodeWalk(true)?.snap, true);
} finally {
    ClientState.isWorldEntityTile = () => false;
}

console.log("player sync world entity check passed");
