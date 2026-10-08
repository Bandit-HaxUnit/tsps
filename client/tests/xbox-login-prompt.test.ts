import assert from "node:assert/strict";

const answers: (string | null)[] = [];
const asked: string[] = [];
(globalThis as any).window = { prompt: (label: string) => { asked.push(label); return answers.shift() ?? null; } };
const { placeXboxLoginInput, promptLoginField } = require("../render/render/mobileLogin");

let saves = 0;
const state = { currentLoginField: 0, username: "", password: "", savePersistedLoginState: () => { saves++; } };
const host = { osrsClient: { loginState: state } } as any;

answers.push("zezima");
promptLoginField(host, 0);
assert.equal(state.username, "zezima", "the console keyboard's text fills the username");
assert.equal(state.currentLoginField, 1, "and moves on to the empty password");
answers.push("hunter2");
promptLoginField(host, 1);
assert.equal(state.password, "hunter2");
answers.push(null);
promptLoginField(host, 0);
assert.equal(state.username, "zezima", "cancelling the prompt leaves the field as it was");
assert.deepEqual(asked, ["Username", "Password", "Username"]);
assert.equal(saves, 2);
console.log("xbox login prompt ok");

// The pointer-following input: a click on a login field lands on a real text input, which is what
// opens Edge's keyboard on Xbox; its typing fills the field and Enter moves on.
{
    const listeners = new Map<string, (event?: any) => void>();
    const input: any = {
        style: {}, dataset: {}, value: "", type: "text",
        addEventListener: (name: string, fn: (event?: any) => void) => listeners.set(name, fn),
        blur: () => { (globalThis as any).document.activeElement = undefined; listeners.get("blur")?.(); },
    };
    (globalThis as any).document = {
        activeElement: undefined,
        createElement: () => input,
        body: { appendChild: () => undefined },
    };
    const loginState = { currentLoginField: 1, username: "", password: "", savePersistedLoginState: () => {} };
    const xboxHost = { osrsClient: { loginState, isOnLoginScreen: () => true } } as any;
    placeXboxLoginInput(xboxHost, { clientX: 400, clientY: 300 }, 0);
    assert.deepEqual([input.style.left, input.style.top, input.style.pointerEvents], ["310px", "282px", "auto"],
        "over the username field the input sits under the pointer");
    placeXboxLoginInput(xboxHost, { clientX: 50, clientY: 50 }, undefined);
    assert.equal(input.style.pointerEvents, "none", "off the fields, clicks reach the canvas");
    placeXboxLoginInput(xboxHost, { clientX: 400, clientY: 300 }, 0);
    (globalThis as any).document.activeElement = input;
    listeners.get("focus")!();
    assert.equal(loginState.currentLoginField, 0, "selecting the input picks the username field");
    input.value = "zezima";
    listeners.get("input")!();
    assert.equal(loginState.username, "zezima", "typing fills the username");
    listeners.get("keydown")!({ key: "Enter", preventDefault() {} });
    assert.deepEqual([loginState.currentLoginField, input.type], [1, "password"], "Enter moves on to the password");
    input.value = "hunter2";
    listeners.get("input")!();
    assert.equal(loginState.password, "hunter2");
    placeXboxLoginInput(xboxHost, { clientX: 10, clientY: 10 }, undefined);
    assert.equal(input.style.pointerEvents, "auto", "the pointer moving away does not pull the input from under typing");
    listeners.get("keydown")!({ key: "Enter", preventDefault() {} });
    assert.equal(input.style.pointerEvents, "none", "Enter on the password closes the keyboard");
    console.log("xbox login input ok");
}
