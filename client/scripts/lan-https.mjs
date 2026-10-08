// An https front for playing the dev client from another device on the LAN (an Xbox, a phone).
// Plain http://<lan-ip> is not a secure context: no cross-origin isolation (so every render worker
// keeps its own copy of the cache, which a console's tab memory cannot hold) and no WebGPU. This
// serves the dev server over https with a self-signed certificate, and carries the game socket on
// the same origin at /game-ws (an https page cannot open ws://; see clientEnv viaHttpsPage).
//
// Usage: node scripts/lan-https.mjs <https port> <dev server port> <game port>
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import httpProxy from "http-proxy";

const [httpsPort, devPort, gamePort] = process.argv.slice(2).map(Number);
if (!httpsPort || !devPort || !gamePort) {
    console.error("Usage: node scripts/lan-https.mjs <https port> <dev server port> <game port>");
    process.exit(1);
}

const lanAddresses = Object.values(os.networkInterfaces()).flat()
    .filter((net) => net && net.family === "IPv4" && !net.internal).map((net) => net.address);

// One self-signed certificate for this machine's LAN addresses, regenerated when they change.
const dir = path.join(os.tmpdir(), "tsps-lan-https");
const keyFile = path.join(dir, "key.pem");
const certFile = path.join(dir, "cert.pem");
const namesFile = path.join(dir, "names");
const names = ["localhost", ...lanAddresses].join(",");
if (!fs.existsSync(certFile) || fs.readFileSync(namesFile, "utf8") !== names) {
    fs.mkdirSync(dir, { recursive: true });
    const subjectAltName = ["DNS:localhost", ...lanAddresses.map((address) => `IP:${address}`)].join(",");
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "30",
        "-keyout", keyFile, "-out", certFile, "-subj", "/CN=tsps-lan", "-addext", `subjectAltName=${subjectAltName}`],
        { stdio: "ignore" });
    fs.writeFileSync(namesFile, names);
}

const proxy = httpProxy.createProxyServer({ xfwd: true });
// The dev server only sends an ETag; a console browser may keep reusing its copy of the bundle.
proxy.on("proxyRes", (proxyRes, req) => {
    proxyRes.headers["cache-control"] = "no-store";
    // `?prof=1` pages may take sampled JavaScript profiles (the JS Self-Profiling API). Only then:
    // with this header, Edge on an Xbox stops passing the controller to the page.
    if (/[?&]prof=1(&|$)/.test(req.url ?? "")) proxyRes.headers["document-policy"] = "js-profiling";
});

/**
 * Summarises a JS Self-Profiling trace: the share of samples where the page was idle, and the
 * functions holding the most samples, by self time (on top of the stack) and in total.
 */
function summariseProfile(trace) {
    const frameName = (id) => {
        const frame = trace.frames[id];
        const file = frame.resourceId === undefined ? "" : String(trace.resources[frame.resourceId]).split("/").pop();
        return `${frame.name || "(anonymous)"} ${file}:${frame.line ?? "?"}`;
    };
    const self = new Map();
    const total = new Map();
    let idle = 0;
    for (const sample of trace.samples) {
        if (sample.stackId === undefined) {
            idle++;
            continue;
        }
        const seen = new Set();
        for (let stack = trace.stacks[sample.stackId]; stack; stack = trace.stacks[stack.parentId]) {
            const name = frameName(stack.frameId);
            if (seen.size === 0) self.set(name, (self.get(name) ?? 0) + 1);
            if (!seen.has(name)) total.set(name, (total.get(name) ?? 0) + 1);
            seen.add(name);
            if (stack.parentId === undefined) break;
        }
    }
    const count = trace.samples.length || 1;
    const top = (map) => [...map].sort((a, b) => b[1] - a[1]).slice(0, 25)
        .map(([name, samples]) => `  ${(samples * 100 / count).toFixed(1).padStart(5)}%  ${name}`).join("\n");
    return `samples:${trace.samples.length} idle:${(idle * 100 / count).toFixed(1)}%\nself:\n${top(self)}\ntotal:\n${top(total)}`;
}
proxy.on("error", (error, _req, res) => {
    console.warn("[lan-https]", error.message);
    if (res && "writeHead" in res && !res.headersSent) res.writeHead(502).end();
    else res?.destroy?.();
});

// Cache downloads per device and second (dat2 Range requests), to see how much of a map load is
// waiting on the network: "[cache] <ip> 14 requests 3.2MB".
const cacheTraffic = new Map();
setInterval(() => {
    for (const [address, { requests, bytes }] of cacheTraffic) {
        console.log(`[cache] ${address} ${requests} requests ${(bytes / 1048576).toFixed(1)}MB`);
    }
    cacheTraffic.clear();
}, 1000).unref();
const trafficOf = (address) => {
    let entry = cacheTraffic.get(address);
    if (!entry) cacheTraffic.set(address, entry = { requests: 0, bytes: 0 });
    return entry;
};
proxy.on("proxyRes", (proxyRes, req) => {
    if (!req.headers.range) return;
    const address = req.socket.remoteAddress;
    trafficOf(address).requests++;
    proxyRes.on("data", (chunk) => { trafficOf(address).bytes += chunk.length; });
});

const server = https.createServer({ key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) },
    (req, res) => {
        // `?map-profile=1` render workers post their per-pass map build timings here.
        if (req.url === "/__maplog" && req.method === "POST") {
            let body = "";
            req.on("data", (chunk) => { body += chunk; });
            req.on("end", () => {
                console.log(`[maplog] ${req.socket.remoteAddress} ${body.slice(0, 300)}`);
                res.writeHead(204).end();
            });
            return;
        }
        // The Xbox diagnostics line posts its memory breakdown here (client/game/XboxDiagnostics.tsx).
        if (req.url === "/__diag" && req.method === "POST") {
            let body = "";
            req.on("data", (chunk) => { body += chunk; });
            req.on("end", () => {
                try {
                    const report = JSON.parse(body);
                    if (!report.breakdown) {
                        console.log(`[diag] ${req.socket.remoteAddress} ${report.stage} heap:${report.heap} last:${report.last || "-"} ${report.view ?? ""}`);
                        for (const message of report.messages ?? []) console.log(`[console] ${req.socket.remoteAddress} ${message}`);
                        res.writeHead(204).end();
                        return;
                    }
                    const mb = (bytes) => Math.round(bytes / 1048576);
                    const parts = report.breakdown
                        .filter((entry) => entry.bytes > 1048576)
                        .sort((a, b) => b.bytes - a.bytes)
                        .map((entry) => `${mb(entry.bytes)}MB[${entry.types.join("+")}|${entry.attribution.map((a) => `${a.scope}${a.url ? ":" + a.url.split("/").pop() : ""}`).join(",") || "shared"}]`);
                    console.log(`[diag] ${req.socket.remoteAddress} ${report.stage} heap:${report.heap} total:${mb(report.bytes)}MB ${parts.join(" ")}`);
                } catch {
                    console.log(`[diag] unreadable report`);
                }
                res.writeHead(204).end();
            });
            return;
        }
        // A sampled profile from the Xbox diagnostics: the raw trace is kept for a closer look.
        if (req.url === "/__profile" && req.method === "POST") {
            let body = "";
            req.on("data", (chunk) => { body += chunk; });
            req.on("end", () => {
                try {
                    const report = JSON.parse(body);
                    const file = path.join(dir, `profile-${Date.now()}.json`);
                    fs.writeFileSync(file, body);
                    console.log(`[profile] ${req.socket.remoteAddress} ${report.view ?? ""}\n${report.error ?? summariseProfile(report.trace)}\n  raw: ${file}`);
                } catch (error) {
                    console.log(`[profile] unreadable report: ${error.message}`);
                }
                res.writeHead(204).end();
            });
            return;
        }
        // Each device's browser identification, once per page load (handy for device checks).
        if (req.url === "/" || req.url?.startsWith("/?")) console.log(`[lan-https] ${req.socket.remoteAddress} ${req.headers["user-agent"]}`);
        proxy.web(req, res, { target: `http://127.0.0.1:${devPort}` });
    });
server.on("upgrade", (req, socket, head) => {
    const game = req.url?.startsWith("/game-ws");
    if (game) req.url = "/";
    proxy.ws(req, socket, head, { target: `ws://127.0.0.1:${game ? gamePort : devPort}` });
});
server.listen(httpsPort, "0.0.0.0", () => {
    for (const address of lanAddresses) console.log(`[lan-https] https://${address}:${httpsPort}`);
});
