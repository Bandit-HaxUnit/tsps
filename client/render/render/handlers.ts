import { GameRenderer } from "../../game/GameRenderer";
import type { WebGLOsrsRendererHost } from "./hostInterface";
import {
    getActiveLoginFieldValue,
    getCanvasTouchPos,
    promptLoginField,
    requestMobileLoginKeyboard,
    resolveLoginFieldAtCanvasPoint,
    setActiveLoginFieldValue,
    syncMobileLoginInput,
    updateMobileLoginViewportBaseline,
} from "./mobileLogin";

export function onCanvasTouchStart(host: WebGLOsrsRendererHost, event: TouchEvent): void {
    // A touch here is a finger, whatever the layout: a tablet on "desktop site" sends a
    // desktop user agent but still needs the soft keyboard. Mouse clicks never fire this.
    const touch = event.changedTouches[0] ?? event.touches[0];
    if (touch && openLoginKeyboardAt(host, touch)) event.preventDefault();
}

/** The login field (0 username, 1 password) under a touch or pointer, if any. */
export function loginFieldAtPointer(host: WebGLOsrsRendererHost, point: Touch | MouseEvent): 0 | 1 | undefined {
    const { x, y } = getCanvasTouchPos(host, point as Touch);
    return resolveLoginFieldAtCanvasPoint(host, x, y);
}

/**
 * Opens the soft keyboard for the login field under a touch, or (Edge on Xbox, which only has a
 * pointer) prompts for it on a click; returns whether a field was hit.
 */
export function openLoginKeyboardAt(host: WebGLOsrsRendererHost, point: Touch | MouseEvent): boolean {
    if (!host.osrsClient.isOnLoginScreen()) return false;
    const field = loginFieldAtPointer(host, point);
    if (field === undefined) return false;
    host.osrsClient.loginState.currentLoginField = field;
    if (typeof MouseEvent !== "undefined" && point instanceof MouseEvent) promptLoginField(host, field);
    else requestMobileLoginKeyboard(host, field);
    return true;
}

export function onMobileLoginViewportChange(host: WebGLOsrsRendererHost): void {
    updateMobileLoginViewportBaseline(host, true);
    host.syncMobileLoginInputPosition?.();
}

export function onMobileLoginInput(host: WebGLOsrsRendererHost, _event: Event): void {
    const input = host.mobileLoginInput;
    if (!input) return;
    setActiveLoginFieldValue(host, input.value);
}

export function onMobileLoginKeyDown(host: WebGLOsrsRendererHost, event: KeyboardEvent): void {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const state = host.osrsClient.loginState;
    if (state.currentLoginField === 0) {
        state.currentLoginField = 1;
        syncMobileLoginInput(host, true);
    }
}

export function onMobileLoginInputFocus(host: WebGLOsrsRendererHost): void {
    host.mobileLoginInputFocused = true;
    host.mobileLoginKeyboardOpen = true;
}

export function onMobileLoginInputBlur(host: WebGLOsrsRendererHost): void {
    host.mobileLoginInputFocused = false;
    if (!host.allowMobileLoginInputBlur) {
        syncMobileLoginInput(host, true);
        return;
    }
    host.mobileLoginKeyboardOpen = false;
    host.allowMobileLoginInputBlur = false;
    host.preserveMobileLoginInputModeOnBlur = false;
    const input = host.mobileLoginInput;
    if (input) {
        setActiveLoginFieldValue(host, input.value);
    }
}

export function onServerTick(host: WebGLOsrsRendererHost, tick: number): void {
    host.lastTick = tick | 0;
}

export async function initRenderer(host: WebGLOsrsRendererHost): Promise<void> {
    await GameRenderer.prototype.init.call(host);
}

export function cleanUpRenderer(host: WebGLOsrsRendererHost): void {
    GameRenderer.prototype.cleanUp.call(host);
}

export function getActiveLoginFieldValueForHost(host: WebGLOsrsRendererHost): string {
    return getActiveLoginFieldValue(host);
}
