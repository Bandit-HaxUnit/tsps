import { useEffect, useRef, useState } from "react";

import { isXbox } from "../common/utils/DeviceUtil";
import { canUseSharedArrayBuffer } from "./Caches";
import type { OsrsClient } from "./OsrsClient";

const MB = 1024 * 1024;

/** Frames in the last second and the slowest frame (ms), from requestAnimationFrame. */
let fps = 0;
let worstFrameMs = 0;
// Everything below only runs on an Xbox (the component only mounts there), but the module is
// imported everywhere.
if (isXbox && typeof requestAnimationFrame === "function") {
    let frames = 0, windowStart = performance.now(), last = windowStart, worst = 0;
    const frame = (now: number) => {
        frames++;
        worst = Math.max(worst, now - last);
        last = now;
        if (now - windowStart >= 1000) {
            fps = Math.round((frames * 1000) / (now - windowStart));
            worstFrameMs = Math.round(worst);
            frames = 0;
            worst = 0;
            windowStart = now;
        }
        requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
}

/**
 * The WebGL renderer string: SwiftShader/WARP/"Basic Render" means software rendering. Read once
 * per context: getParameter waits on the GPU process.
 */
const rendererNames = new WeakMap<WebGLRenderingContext, string>();
function glRendererName(gl?: WebGLRenderingContext): string {
    if (!gl) return "-";
    let name = rendererNames.get(gl);
    if (name === undefined) {
        const info = gl.getExtension("WEBGL_debug_renderer_info");
        name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER)).slice(0, 60);
        rendererNames.set(gl, name);
    }
    return name;
}

/**
 * Whether JavaScript runs compiled: Edge's "Enhance your security on the web" turns the JIT (and
 * WebAssembly) off for sites it does not trust, a LAN IP with a self-signed certificate among them,
 * and everything then runs several times slower. WebAssembly being blocked is the clear sign; the
 * loop time is a rough second one (about 2-3x longer interpreted).
 */
function describeEngine(): string {
    let wasm = "no";
    try {
        // The smallest valid module: the "\0asm" magic and version 1.
        new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
        wasm = "ok";
    } catch {
        wasm = "blocked";
    }
    const start = performance.now();
    let sum = 0;
    for (let i = 0; i < 5_000_000; i++) sum = (sum + i * 7) | 0;
    (globalThis as { __engineProbe?: number }).__engineProbe = sum;
    return `wasm:${wasm} loop:${Math.round(performance.now() - start)}ms`;
}
const engine = isXbox ? describeEngine() : "";

/**
 * The render worker's cache misses: it asks the main thread for each missing group over a
 * BroadcastChannel and waits for "complete". Listening on the same channel times every round trip,
 * which shows whether map building waits on them. Reset at each report.
 */
const js5 = { channel: undefined as BroadcastChannel | undefined, open: new Map<string, number>(), requests: 0, done: 0, totalMs: 0, maxMs: 0 };
function watchJs5(osrsClient?: OsrsClient): void {
    const name = (osrsClient as unknown as { js5Coordinator?: BroadcastChannel } | undefined)?.js5Coordinator?.name;
    if (!name || js5.channel?.name === name || typeof BroadcastChannel === "undefined") return;
    js5.channel?.close();
    js5.open.clear();
    js5.channel = new BroadcastChannel(name);
    js5.channel.onmessage = ({ data }: MessageEvent<{ type?: string; indexId?: number; archiveId?: number }>) => {
        const key = `${data?.indexId}:${data?.archiveId}`;
        if (data?.type === "request") {
            if (!js5.open.has(key)) js5.open.set(key, performance.now());
            js5.requests++;
        } else if (data?.type === "complete" || data?.type === "failed") {
            const start = js5.open.get(key);
            if (start === undefined) return;
            js5.open.delete(key);
            const ms = performance.now() - start;
            js5.done++;
            js5.totalMs += ms;
            js5.maxMs = Math.max(js5.maxMs, ms);
        }
    };
}
function describeJs5(): string {
    const text = `js5:req${js5.requests} done${js5.done} avg${js5.done ? Math.round(js5.totalMs / js5.done) : 0}ms max${Math.round(js5.maxMs)}ms open${js5.open.size}`;
    js5.requests = js5.done = js5.totalMs = js5.maxMs = 0;
    return text;
}

/**
 * Frames over 50 ms (the Long Animation Frames API): how long they took, how much of that ran our
 * scripts (garbage collection inside a script counts there), how much was the browser's own style,
 * layout and paint after them, and the scripts that took longest. A slow frame rate with few or
 * short long frames means the main thread is not what holds frames back (the GPU is).
 */
type LongFrame = PerformanceEntry & {
    renderStart: number;
    scripts: { duration: number; invoker?: string; sourceFunctionName?: string; sourceURL?: string; sourceCharPosition?: number }[];
};
const longFrames = { count: 0, totalMs: 0, scriptMs: 0, renderMs: 0, maxMs: 0, scripts: new Map<string, number>() };
if (isXbox && typeof PerformanceObserver !== "undefined" && PerformanceObserver.supportedEntryTypes?.includes("long-animation-frame")) {
    new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as LongFrame[]) {
            longFrames.count++;
            longFrames.totalMs += entry.duration;
            longFrames.maxMs = Math.max(longFrames.maxMs, entry.duration);
            if (entry.renderStart > 0) longFrames.renderMs += entry.startTime + entry.duration - entry.renderStart;
            for (const script of entry.scripts) {
                longFrames.scriptMs += script.duration;
                const name = `${script.sourceFunctionName || script.invoker || "?"}@${String(script.sourceURL ?? "").split("/").pop()}`;
                longFrames.scripts.set(name, (longFrames.scripts.get(name) ?? 0) + script.duration);
            }
        }
    }).observe({ type: "long-animation-frame", buffered: false });
}
function describeLongFrames(): string {
    const top = [...longFrames.scripts].sort((a, b) => b[1] - a[1]).slice(0, 4)
        .map(([name, ms]) => `${name}=${Math.round(ms)}`).join(",");
    const text = `loaf:${longFrames.count} total${Math.round(longFrames.totalMs)}ms script${Math.round(longFrames.scriptMs)}ms render${Math.round(longFrames.renderMs)}ms max${Math.round(longFrames.maxMs)}ms [${top}]`;
    longFrames.count = longFrames.totalMs = longFrames.scriptMs = longFrames.renderMs = longFrames.maxMs = 0;
    longFrames.scripts.clear();
    return text;
}

/**
 * Console errors and warnings, uncaught errors, rejected promises and the renderer's "[webgpu]"
 * messages (WebGPU validation errors arrive as console errors), each sent once with the next report.
 */
const pendingMessages: string[] = [];
const seenMessages = new Set<string>();
function noteMessage(kind: string, parts: unknown[]): void {
    const text = `${kind}: ${parts.map((part) => (part instanceof Error ? `${part.name}: ${part.message}` : typeof part === "object" ? safeJson(part) : String(part))).join(" ")}`.slice(0, 400);
    if (seenMessages.has(text) || seenMessages.size > 500) return;
    seenMessages.add(text);
    pendingMessages.push(text);
}
function safeJson(value: unknown): string {
    // DOM and WebGPU objects keep their fields on getters, which JSON skips ({}).
    const fields = value as { reason?: unknown; message?: unknown; name?: unknown } | null;
    if (fields && (fields.message !== undefined || fields.reason !== undefined)) {
        return [fields.name, fields.reason, fields.message].filter((part) => part !== undefined).join(" ");
    }
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}
if (isXbox) {
    for (const kind of ["error", "warn", "info"] as const) {
        const original = console[kind].bind(console);
        console[kind] = (...parts: unknown[]) => {
            if (kind !== "info" || String(parts[0]).startsWith("[webgpu]")) noteMessage(kind, parts);
            original(...parts);
        };
    }
    window.addEventListener("error", (event) => noteMessage("uncaught", [event.error ?? event.message]));
    window.addEventListener("unhandledrejection", (event) => noteMessage("rejection", [event.reason]));
}

/** The last key event's key and code, to see what a controller button sends as keys. */
let lastKey = "-";
if (isXbox) {
    window.addEventListener("keydown", (event) => { lastKey = `${event.key}/${event.keyCode}`; }, true);
}

/** The JS Self-Profiling API (Chromium; the page needs `Document-Policy: js-profiling`). */
type SamplingProfiler = { stop(): Promise<unknown> };
const SamplingProfilerClass = (globalThis as {
    Profiler?: new (options: { sampleInterval: number; maxBufferSize: number }) => SamplingProfiler;
}).Profiler;
const PROFILE_MS = 10000;

type MemoryMeasurement = {
    bytes: number;
    breakdown: { bytes: number; types: string[]; attribution: { scope?: string }[] }[];
};

/** What decides whether anything is drawn: the GPU context, camera, sizes and controller state. */
function describeView(osrsClient?: OsrsClient): string {
    try {
        const renderer = osrsClient?.renderer as {
            canvas?: HTMLCanvasElement; app?: { gl?: WebGLRenderingContext };
            mapManager?: { mapSquares: Map<number, unknown>; loadingMapIds: Set<number> };
        } | undefined;
        const maps = renderer?.mapManager;
        const gl = renderer?.app?.gl;
        const camera = osrsClient?.camera;
        const pads = typeof navigator.getGamepads === "function" ? Array.from(navigator.getGamepads()).filter(Boolean) : [];
        const pad = pads[0];
        return [
            `fps:${fps} worst:${worstFrameMs}ms`,
            engine,
            describeJs5(),
            describeLongFrames(),
            // Map squares built / still building (the render worker's queue after a login or teleport).
            `maps:${maps ? `${maps.mapSquares.size}/${maps.loadingMapIds.size}` : "-"}`,
            // Startup progress: the game cache, and the login screen's sprites (the title box).
            `cache:${osrsClient?.loadedCache ? "ok" : "-"} titlebox:${osrsClient?.loginRenderer.titleboxSprite ? "ok" : "-"}`,
            `dpr:${window.devicePixelRatio.toFixed(2)}`,
            `win:${window.innerWidth}x${window.innerHeight}`,
            `canvas:${renderer?.canvas?.width}x${renderer?.canvas?.height}`,
            `gl:${gl ? (gl.isContextLost() ? "LOST" : "ok") : "-"}[${glRendererName(gl)}]`,
            `cam:${camera ? `${Math.round(camera.yaw)}/${Math.round(camera.getScenePitchAngle?.() ?? NaN)}/${Array.from(camera.pos, (v: number) => Math.round(v)).join(",")}` : "-"}`,
            `fs:${document.fullscreenElement ? "yes" : "no"}`,
            `vis:${document.visibilityState}`,
            `pads:${pads.length}${pad ? `(${pad.mapping || "nomap"} ${pad.axes.map((a) => a.toFixed(2)).join(",")} pressed:${pad.buttons.flatMap((b, i) => (b.pressed ? [i] : [])).join("+") || "none"})` : ""}`,
            `lastKey:${lastKey}`,
        ].join(" ");
    } catch (error) {
        return `view-error:${String(error)}`;
    }
}

/** Whole-tab memory split by where it lives: the page, its workers, and memory they share. */
function describeMemory(result: MemoryMeasurement): string {
    const mb = (bytes: number) => Math.round((Number(bytes) || 0) / MB);
    let page = 0, workers = 0, shared = 0;
    try {
        for (const entry of result.breakdown ?? []) {
            const scopes = (entry.attribution ?? []).map((attribution) => attribution?.scope ?? "");
            if (scopes.length !== 1) shared += Number(entry.bytes) || 0;
            else if (scopes[0] === "Window") page += Number(entry.bytes) || 0;
            else workers += Number(entry.bytes) || 0;
        }
    } catch {
        return `TAB:${mb(result.bytes)}MB`;
    }
    return `TAB:${mb(result.bytes)}MB page:${mb(page)} workers:${mb(workers)} shared:${mb(shared)}`;
}

/**
 * Xbox-only readout to find what fills an Xbox browser tab's memory: whether the cache is shared
 * with the render workers (needs cross-origin isolation), the worker count, renderer and stage,
 * JS heap use against its limit, and (cross-origin isolated only) the whole tab's memory.
 */
export function XboxDiagnostics({ workers, osrsClient }: { workers: number; osrsClient?: OsrsClient }): JSX.Element {
    const [line, setLine] = useState("");
    const [total, setTotal] = useState("");
    const stageRef = useRef("starting");
    const heapRef = useRef("");
    const lastTotalRef = useRef("");

    useEffect(() => {
        // Leave the renderer's profiler off: it wraps every frame in a GPU timer query, and with it
        // on the Xbox (ANGLE on Direct3D 11) stalled for seconds, then lost the WebGL context.
        const tick = () => {
            const heap = (performance as Performance & {
                memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number };
            }).memory;
            const stage = !osrsClient ? "starting" : osrsClient.isLoggedIn() ? "in game" : "login";
            stageRef.current = stage;
            watchJs5(osrsClient);
            heapRef.current = heap ? `${Math.round(heap.usedJSHeapSize / MB)}/${Math.round(heap.jsHeapSizeLimit / MB)}MB` : "";
            setLine([
                `iso:${globalThis.crossOriginIsolated === true ? "y" : "n"}`,
                `shared:${canUseSharedArrayBuffer() ? "y" : "n"}`,
                `w:${workers}`,
                osrsClient?.renderer?.type ?? "-",
                stage,
                heap ? `heap:${Math.round(heap.usedJSHeapSize / MB)}/${Math.round(heap.jsHeapSizeLimit / MB)}MB` : "heap:n/a",
            ].join(" "));
        };
        tick();
        const timer = setInterval(tick, 1000);
        // A light report every 3 s, so the dev machine sees the run-up to a crash even when no
        // whole-tab measurement (which can take ~20 s) has finished.
        const pulse = setInterval(() => {
            void fetch("/__diag", {
                method: "POST",
                body: JSON.stringify({
                    stage: stageRef.current, heap: heapRef.current, last: lastTotalRef.current, view: describeView(osrsClient),
                    messages: pendingMessages.splice(0),
                }),
            }).catch(() => undefined);
        }, 3000);
        // In game, a 10 s sampled CPU profile every minute: the LAN https front summarises where
        // the main thread spends its time, and how long it sits idle (waiting on the GPU).
        let profiling = false;
        const takeProfile = () => {
            if (profiling || stageRef.current !== "in game") return;
            const report = (body: object) => void fetch("/__profile", {
                method: "POST", body: JSON.stringify({ view: describeView(osrsClient), ...body }),
            }).catch(() => undefined);
            if (!SamplingProfilerClass) return report({ error: "no Profiler (JS Self-Profiling) in this browser" });
            profiling = true;
            let sampler: SamplingProfiler;
            try {
                sampler = new SamplingProfilerClass({ sampleInterval: 10, maxBufferSize: 10000 });
            } catch (error) {
                report({ error: `Profiler refused: ${String(error)}` });
                return;
            }
            setTimeout(() => {
                sampler.stop().then((trace) => report({ trace })).catch((error) => report({ error: String(error) }))
                    .finally(() => { profiling = false; });
            }, PROFILE_MS);
        };
        const profileTimer = setInterval(takeProfile, 60000);
        const firstProfile = setTimeout(takeProfile, 20000);

        const measure = (performance as Performance & {
            measureUserAgentSpecificMemory?: () => Promise<MemoryMeasurement>;
        }).measureUserAgentSpecificMemory;
        // One measurement at a time: the browser can take ~20 s to answer (it waits for a GC).
        let measuring = false;
        const takeMeasurement = () => {
            if (measuring) return;
            measuring = true;
            measure!.call(performance)
                .then((result) => {
                    lastTotalRef.current = describeMemory(result);
                    setTotal(lastTotalRef.current);
                    // The LAN https front (scripts/lan-https.mjs) logs the full breakdown on the dev machine.
                    void fetch("/__diag", {
                        method: "POST",
                        body: JSON.stringify({ stage: stageRef.current, heap: heapRef.current, ...result }),
                    }).catch(() => undefined);
                })
                .catch((error) => setTotal(`TAB:error ${String(error?.name ?? error)}`))
                .finally(() => { measuring = false; });
        };
        const totalTimer = typeof measure === "function" && globalThis.crossOriginIsolated === true
            ? setInterval(takeMeasurement, 30000)
            : undefined;
        if (totalTimer) {
            setTotal("TAB:…");
            takeMeasurement();
        }
        return () => {
            clearInterval(timer);
            clearInterval(pulse);
            clearInterval(profileTimer);
            clearTimeout(firstProfile);
            if (totalTimer) clearInterval(totalTimer);
        };
    }, [workers, osrsClient]);

    return (
        <div
            style={{
                // Inside a TV's safe area: televisions can crop the outer few percent (overscan).
                position: "fixed",
                top: "6vh",
                left: "6vw",
                zIndex: 2147483647,
                padding: "4px 10px",
                font: "bold 20px monospace",
                color: "#3f3",
                background: "rgba(0, 0, 0, 0.65)",
                pointerEvents: "none",
                whiteSpace: "pre-wrap",
                maxWidth: "88vw",
            }}
        >
            {total ? `${total} ${line}` : line}
        </div>
    );
}
