import { isMobileMode, isXbox } from "../../../common/utils/DeviceUtil";
import * as handlers from "../../render/handlers";
import type { WebGLOsrsRendererHost } from "../../render/hostInterface";
import * as mobileLogin from "../../render/mobileLogin";
import type { WebGPURenderer } from "../WebGPURenderer";

export interface MobileLoginInput {
    /** WebGL's per-frame syncMobileLoginInput: focuses or blurs the hidden input. */
    sync(focus: boolean): void;
    isKeyboardOpen(): boolean;
    dispose(): void;
}

/**
 * The WebGL login screen's soft keyboard (render/render/mobileLogin.ts) for WebGPU: a tap on the
 * username or password field focuses a hidden input, so touch devices, including a tablet on
 * "desktop site", get their keyboard. The shared functions take the WebGL host; this hands them a
 * structurally-typed stand-in with the fields and methods they use (as WebGPUUi's quality host).
 */
export function createMobileLoginInput(renderer: WebGPURenderer): MobileLoginInput {
    const shim: Record<string, unknown> = {
        osrsClient: renderer.osrsClient,
        canvas: renderer.canvas,
        LOGIN_FIELD_BASE_Y: 201 + 15 + 15 + 10, // WebGLOsrsRenderer.LOGIN_FIELD_BASE_Y
        mobileLoginInputFocused: false,
        mobileLoginKeyboardOpen: false,
        mobileLoginViewportBaselineWidth: 0,
        mobileLoginViewportBaselineHeight: 0,
        allowMobileLoginInputBlur: false,
        preserveMobileLoginInputModeOnBlur: false,
    };
    const host = shim as unknown as WebGLOsrsRendererHost;
    // WebGLOsrsRenderer's one-line wrappers: the shared functions call each other through the host.
    shim.shouldUseMobileLoginInput = () => mobileLogin.shouldUseMobileLoginInput(host);
    shim.isMobileLoginKeyboardOpen = () => mobileLogin.isMobileLoginKeyboardOpen(host);
    shim.refreshMobileLoginKeyboardState = () => mobileLogin.refreshMobileLoginKeyboardState(host);
    shim.readMobileLoginViewportMetrics = () => mobileLogin.readMobileLoginViewportMetrics(host);
    shim.updateMobileLoginViewportBaseline = (force?: boolean) =>
        mobileLogin.updateMobileLoginViewportBaseline(host, force);
    shim.syncMobileLoginInputPosition = () => mobileLogin.syncMobileLoginInputPosition(host);
    shim.ensureMobileLoginInput = () => mobileLogin.ensureMobileLoginInput(host);
    shim.syncMobileLoginInput = (focus: boolean) => mobileLogin.syncMobileLoginInput(host, focus);
    shim.getActiveLoginFieldValue = () => mobileLogin.getActiveLoginFieldValue(host);
    shim.onMobileLoginInput = (event: Event) => handlers.onMobileLoginInput(host, event);
    shim.onMobileLoginKeyDown = (event: KeyboardEvent) => handlers.onMobileLoginKeyDown(host, event);
    shim.onMobileLoginInputFocus = () => handlers.onMobileLoginInputFocus(host);
    shim.onMobileLoginInputBlur = () => handlers.onMobileLoginInputBlur(host);
    const onViewportChange = () => handlers.onMobileLoginViewportChange(host);

    // handlers.onCanvasTouchStart, except the field is found through the layout the title was
    // last drawn with (the one this frame's login clicks map through), not WebGL's surface layout.
    const onTouchStart = (event: TouchEvent): void => {
        const touch = event.changedTouches[0] ?? event.touches[0];
        if (touch && openKeyboardAt(touch)) event.preventDefault();
    };
    // Edge on Xbox clicks with a pointer, never a touch, and only opens its keyboard for a real text
    // field the player selects: a transparent input follows the pointer over the login fields
    // (mobileLogin.placeXboxLoginInput); a click that still lands on the canvas prompts instead.
    const onClick = (event: MouseEvent): void => {
        openKeyboardAt(event);
    };
    const fieldAt = (point: Touch | MouseEvent): 0 | 1 | undefined => {
        if (!renderer.osrsClient.isOnLoginScreen()) return undefined;
        const { x, y } = mobileLogin.getCanvasTouchPos(host, point as Touch);
        const loginRenderer = renderer.osrsClient.loginRenderer;
        loginRenderer.setMousePosition(x, y);
        const content = loginRenderer.mapPointerToContent(loginRenderer.mouseX, loginRenderer.mouseY);
        return mobileLogin.resolveLoginFieldAt(host, content.y);
    };
    const onMouseMove = (event: MouseEvent): void => mobileLogin.placeXboxLoginInput(host, event, fieldAt(event));
    const openKeyboardAt = (point: Touch | MouseEvent): boolean => {
        const field = fieldAt(point);
        if (field === undefined) return false;
        if (typeof MouseEvent !== "undefined" && point instanceof MouseEvent) mobileLogin.promptLoginField(host, field);
        else mobileLogin.requestMobileLoginKeyboard(host, field);
        return true;
    };

    renderer.canvas.addEventListener("touchstart", onTouchStart, { passive: false, capture: true });
    if (isXbox) {
        renderer.canvas.addEventListener("click", onClick);
        renderer.canvas.addEventListener("mousemove", onMouseMove);
    }
    if (isMobileMode) {
        host.ensureMobileLoginInput();
        host.updateMobileLoginViewportBaseline();
        window.addEventListener("resize", onViewportChange);
        window.addEventListener("orientationchange", onViewportChange);
        window.visualViewport?.addEventListener("resize", onViewportChange);
        window.visualViewport?.addEventListener("scroll", onViewportChange);
    }

    return {
        sync: (focus) => host.syncMobileLoginInput(focus),
        isKeyboardOpen: () => host.isMobileLoginKeyboardOpen(),
        dispose: () => {
            renderer.canvas.removeEventListener("touchstart", onTouchStart, true);
            renderer.canvas.removeEventListener("click", onClick);
            renderer.canvas.removeEventListener("mousemove", onMouseMove);
            if (isMobileMode) {
                window.removeEventListener("resize", onViewportChange);
                window.removeEventListener("orientationchange", onViewportChange);
                window.visualViewport?.removeEventListener("resize", onViewportChange);
                window.visualViewport?.removeEventListener("scroll", onViewportChange);
            }
            mobileLogin.destroyMobileLoginInput(host);
        },
    };
}
