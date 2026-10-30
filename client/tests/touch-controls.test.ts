import { strict as assert } from "node:assert";

import type { Camera } from "../game/Camera";
import {
    TouchControlsPlugin,
    type TouchControlsClient,
} from "../game/plugins/touchcontrols/TouchControlsPlugin";

type Move = { dx: number; dy: number; running: boolean; rotation: number };

function makeClient(overrides: Partial<TouchControlsClient> = {}): {
    client: TouchControlsClient;
    moves: Move[];
    stops: number[];
    runModes: boolean[];
} {
    const moves: Move[] = [];
    const stops: number[] = [];
    const runModes: boolean[] = [];
    const client: TouchControlsClient = {
        // Camera yaw 0 looks north; actor rotation is camera yaw + 1024.
        camera: { yaw: 0, getYaw: () => 0 } as unknown as Camera,
        isLoggedIn: () => true,
        setKeyboardMovement: (dx, dy, running, rotation) => moves.push({ dx, dy, running, rotation }),
        stopKeyboardMovement: () => stops.push(1),
        setKeyboardRunMode: (running) => runModes.push(running),
        widgetManager: { interfaceParents: new Map(), isEffectivelyHidden: () => false },
        ...overrides,
    };
    return { client, moves, stops, runModes };
}

const near = (actual: number, expected: number, message: string) =>
    assert.ok(Math.abs(actual - expected) < 1e-6, `${message} (expected ${expected}, got ${actual})`);

// Single direction: "up" walks away from the camera at full speed.
{
    const { client, moves } = makeClient();
    const plugin = new TouchControlsPlugin(client);
    plugin.press(1, "up");
    assert.equal(moves.length, 1, "a press must send one movement input");
    near(moves[0].dx, 0, "northward input has no sideways component");
    near(moves[0].dy, 1, "northward input is a unit vector");
    assert.equal(moves[0].rotation, 1024, "actor faces the camera's forward direction");
}

// Two fingers held at once produce a normalised diagonal, not a 1.41x sprint.
{
    const { client, moves } = makeClient();
    const plugin = new TouchControlsPlugin(client);
    plugin.press(1, "up");
    plugin.press(2, "left");
    const diagonal = moves[moves.length - 1];
    near(diagonal.dx, -Math.SQRT1_2, "diagonal is normalised on X");
    near(diagonal.dy, Math.SQRT1_2, "diagonal is normalised on Y");
    assert.ok(Math.hypot(diagonal.dx, diagonal.dy) <= 1 + 1e-9, "input vector never exceeds unit length");
}

// Releasing one finger keeps the other direction walking.
{
    const { client, moves } = makeClient();
    const plugin = new TouchControlsPlugin(client);
    plugin.press(1, "up");
    plugin.press(2, "left");
    plugin.release(1);
    const remaining = moves[moves.length - 1];
    near(remaining.dx, -1, "only the held direction remains");
    near(remaining.dy, 0, "the released direction stops contributing");
}

// Releasing the last finger stops movement exactly once.
{
    const { client, stops } = makeClient();
    const plugin = new TouchControlsPlugin(client);
    plugin.press(1, "up");
    plugin.release(1);
    assert.equal(stops.length, 1, "releasing the last touch stops walking");
}

// Run toggle rides along with the next movement input.
{
    const { client, moves, runModes } = makeClient();
    const plugin = new TouchControlsPlugin(client);
    plugin.toggleRun();
    plugin.press(1, "right");
    assert.equal(runModes[runModes.length - 1], true, "run mode is pushed to the client");
    assert.equal(moves[moves.length - 1].running, true, "movement input carries the run flag");
    near(moves[moves.length - 1].dx, 1, "east is +X at yaw 0");
}

// An open interface must keep the pad inert: server-side movement closes interfaces.
{
    const { client, moves, stops } = makeClient({
        widgetManager: {
            interfaceParents: new Map([[1, { type: 0 }]]),
            isEffectivelyHidden: () => false,
        },
    });
    const plugin = new TouchControlsPlugin(client);
    plugin.press(1, "up");
    assert.equal(moves.length, 0, "no movement input while a bank-style interface is open");
    assert.equal(stops.length, 0, "nothing to stop when movement never started");
}

// Logging out mid-press releases the pad instead of leaving a phantom walk.
{
    const { client, stops } = makeClient();
    let loggedIn = true;
    client.isLoggedIn = () => loggedIn;
    const plugin = new TouchControlsPlugin(client);
    plugin.press(1, "up");
    loggedIn = false;
    plugin.onClientTick();
    assert.equal(stops.length, 1, "logout stops walking");
    assert.equal(plugin.getUiState().pressed.up, false, "the pad clears its pressed state");
}

// Camera yaw turns the walk direction: at yaw 512 (east) "up" walks east.
{
    const { client, moves } = makeClient();
    client.camera = { yaw: 512, getYaw: () => 512 } as unknown as Camera;
    const plugin = new TouchControlsPlugin(client);
    plugin.press(1, "up");
    near(moves[moves.length - 1].dx, 1, "forward follows the camera east");
    near(moves[moves.length - 1].dy, 0, "no northward drift at 90 degrees");
}

console.log("touch controls plugin test passed");
