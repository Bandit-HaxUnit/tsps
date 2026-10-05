import assert from "node:assert/strict";

import { getAttackTimerTicks, setAttackTimer } from "../game/plugins/attacktimer/attackTimerState";
import { decodeServerPacket } from "../network/packet/ServerBinaryDecoder";
import { encodeAttackTimer } from "../../server/src/main/typescript/elvarg/net/protocol/ClientProtocol";

// ATTACK_TIMER carries the ticks until the local player's next attack (not an OSRS packet).
const decode = (ticks: number) => decodeServerPacket(new Uint8Array(encodeAttackTimer(ticks))) as any;
assert.deepEqual(decode(4), { type: "attack_timer", payload: { ticks: 4 } });
assert.equal(decode(300).payload.ticks, 255, "capped at a byte");

// Counted from the tick it belongs to: 4, 3, 2, 1, then nothing once the attack is ready.
setAttackTimer(4, 100);
assert.deepEqual([100, 101, 102, 103, 104, 105].map(getAttackTimerTicks), [4, 3, 2, 1, 0, 0]);
// A new value (eating adds ticks) replaces it.
setAttackTimer(5, 102);
assert.equal(getAttackTimerTicks(102), 5);

console.log("attack timer: ok");
