import assert from "node:assert/strict";

process.env.REACT_APP_DEFAULT_WS_URL = "ws://localhost:43707";
process.env.REACT_APP_DEFAULT_SERVER_ADDRESS = "localhost:43707";
const page = { protocol: "http:", hostname: "localhost", host: "localhost:3107" };
(globalThis as any).window = { location: page };
const { getDefaultServerAddress, getDefaultServerSecure, getDefaultWsUrl } = require("../config/clientEnv");

assert.equal(getDefaultWsUrl(), "ws://localhost:43707", "the desktop page keeps its local server");
Object.assign(page, { hostname: "192.168.1.215", host: "192.168.1.215:3107" });
assert.equal(getDefaultWsUrl(), "ws://192.168.1.215:43707", "plain http on the LAN points at the page's host");
assert.equal(getDefaultServerSecure(), false);
Object.assign(page, { protocol: "https:", host: "192.168.1.215:4107" });
assert.equal(getDefaultWsUrl(), "wss://192.168.1.215:4107/game-ws",
    "an https LAN page carries the game socket on its own origin (no mixed content)");
assert.equal(getDefaultServerAddress(), "192.168.1.215:4107/game-ws");
assert.equal(getDefaultServerSecure(), true, "and connects with wss");
process.env.REACT_APP_DEFAULT_WS_URL = "wss://play.example.com";
assert.equal(getDefaultWsUrl(), "wss://play.example.com", "a configured remote server is left alone");
console.log("lan https server ok");
