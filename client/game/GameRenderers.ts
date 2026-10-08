import { isWebGL2Supported, isWebGPUSupported, isXbox } from "../common/utils/DeviceUtil";
import { WebGLOsrsRenderer } from "../render/WebGLOsrsRenderer";
import { WebGPURenderer } from "../render/webgpu/WebGPURenderer";
import { GameRenderer } from "./GameRenderer";
import { OsrsClient } from "./OsrsClient";

export type OsrsRendererType = "webgl" | "webgpu";
export const WEBGL: OsrsRendererType = "webgl";
export const WEBGPU: OsrsRendererType = "webgpu";

/**
 * Stage 7 flips this once every pass has a WebGPU path. Until then WebGPU is opt-in with
 * `?renderer=webgpu`, so an unfinished backend can never take over a normal session.
 */
export const PREFER_WEBGPU_DEFAULT = false;

export function getRendererName(type: OsrsRendererType): string {
    switch (type) {
        case WEBGL:
            return "WebGL";
        case WEBGPU:
            return "WebGPU";
        default:
            throw new Error("Unknown renderer type");
    }
}

export function createRenderer(type: OsrsRendererType, osrsClient: OsrsClient): GameRenderer {
    switch (type) {
        case WEBGL:
            return new WebGLOsrsRenderer(osrsClient);
        case WEBGPU:
            return new WebGPURenderer(osrsClient);
        default:
            throw new Error("Unknown renderer type");
    }
}

export function getAvailableRenderers(): OsrsRendererType[] {
    const renderers: OsrsRendererType[] = [];

    if (WebGLOsrsRenderer.isSupported()) {
        renderers.push(WEBGL);
    }
    if (WebGPURenderer.isSupported()) {
        renderers.push(WEBGPU);
    }

    return renderers;
}

export function getRequestedRendererType(): OsrsRendererType | undefined {
    if (typeof window === "undefined") return undefined;
    try {
        const params = new URLSearchParams(window.location.search);
        // `?r=gpu` / `?r=gl` are short forms, for typing on a console.
        const requested = params.get("renderer") ?? ({ gpu: WEBGPU, gl: WEBGL } as Record<string, string>)[params.get("r") ?? ""];
        if (requested === WEBGL || requested === WEBGPU) return requested;
    } catch {}
    return undefined;
}

/**
 * Backend for this session. WebGPU must produce an adapter before it is picked; any failure
 * (no `navigator.gpu`, no adapter, request rejected) falls back to WebGL.
 */
export async function pickRendererType(): Promise<OsrsRendererType | undefined> {
    const requested = getRequestedRendererType();
    const webglReady = WebGLOsrsRenderer.isSupported();
    // Only ask for a WebGPU adapter when the result can matter: WebGPU was requested,
    // WebGPU is the preferred default, or there is no WebGL to fall back to.
    // Not on an Xbox: its Edge exposes WebGPU, but the device is removed the first time any
    // pipeline draws ("D3D12 create graphics pipeline state failed", DXGI_ERROR_DRIVER_INTERNAL_ERROR).
    const shouldProbe = (requested === WEBGPU || PREFER_WEBGPU_DEFAULT || !webglReady) && !(isXbox && webglReady);
    let webgpuReady = false;
    if (shouldProbe && isWebGPUSupported && WebGPURenderer.isSupported()) {
        try {
            webgpuReady = (await WebGPURenderer.probeAdapter()) !== undefined;
        } catch {
            webgpuReady = false;
        }
    }

    if (requested === WEBGPU && !webgpuReady) {
        console.warn("[renderer] WebGPU requested but unavailable; falling back to WebGL");
    }
    if (requested === WEBGL && webglReady) return WEBGL;
    if (requested === WEBGPU && webgpuReady) return WEBGPU;
    if (PREFER_WEBGPU_DEFAULT && webgpuReady) return WEBGPU;
    if (webglReady) return WEBGL;
    if (webgpuReady) return WEBGPU;
    return undefined;
}
