import type { OsrsClient } from "../../OsrsClient";
import { ConfigChanged } from "@runelite/api/events";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { CLIENT_TOKEN, inject } from "@runelite/client/plugins/PluginInjector";
import type { Camera } from "../../Camera";
import type { ClientPlugin } from "../ClientPluginManager";
import { RS_TO_RADIANS } from "../../../rs/MathConstants";
import { createElement, lazy, type ReactNode } from "react";
import { PadMode, type PadModeValue, TouchControlsConfig } from "./TouchControlsConfig";

const TouchJoystick = lazy(() =>
    import("./TouchJoystick").then((m) => ({ default: m.TouchJoystick })),
);

export type TouchControlsUiState = {
    visible: boolean;
};

/**
 * The slice of OsrsClient the joystick needs. Kept structural so the plugin stays
 * testable without a full client (same shape as FirstPersonPlugin's client type).
 */
export type TouchControlsClient = {
    camera: Camera;
    /** The run orb; the joystick walks or runs as it says. */
    runMode?: boolean;
    isLoggedIn(): boolean;
    isWidgetTextInputActive?(): boolean;
    cs2Vm?: { inputDialogType?: number };
    widgetManager?: {
        interfaceParents: Map<number, { type: number }>;
        isEffectivelyHidden?(uid: number): boolean;
    };
    setKeyboardMovement?(dx: number, dy: number, running: boolean, rotation: number): void;
    stopKeyboardMovement?(deactivate?: boolean): void;
};

function detectTouchDevice(): boolean {
    if (typeof window === "undefined" || typeof navigator === "undefined") return false;
    const params = new URLSearchParams(window.location.search);
    // ?touch=1 forces the joystick on for desktop testing; ?touch=0 hides it on a phone.
    if (params.get("touch") === "0") return false;
    if (params.get("touch") === "1") return true;
    return (navigator.maxTouchPoints ?? 0) > 0 || "ontouchstart" in window;
}

/**
 * On-screen movement joystick for phones and tablets.
 *
 * Movement itself already exists end to end: `ContinuousMovement` sends
 * MOVEMENT_INPUT (opcode 215) and the server's FreeMovement plugin walks the
 * player, so this plugin is only the touch control that feeds it.
 */
export class TouchControlsPlugin extends Plugin implements ClientPlugin {
    static descriptor: PluginDescriptor = {
        name: "Touch Controls",
        description: "On-screen joystick for walking on touch screens.",
        tags: ["input", "mobile"],
        configKey: "touchcontrolsplugin",
    };

    /** The settings group the Config UI renders for this plugin. */
    static config = TouchControlsConfig;

    private readonly client: TouchControlsClient;
    /** Optional: unavailable in standalone builds (tests), where config stays Default. */
    private readonly configManager?: ConfigManager;
    private readonly touchDevice = detectTouchDevice();
    private readonly listeners = new Set<() => void>();
    /** The held stick, camera-relative: forward is away from the camera. Undefined when released. */
    private stick?: { forward: number; right: number };
    private padMode: PadModeValue = PadMode.DEFAULT;
    private uiState: TouchControlsUiState = { visible: false };

    constructor(client?: TouchControlsClient) {
        super();
        this.client = client ?? inject<TouchControlsClient>(CLIENT_TOKEN);
        try {
            this.configManager = inject(ConfigManager);
        } catch {
            // Built standalone (tests): the joystick follows device detection only.
        }
        this.readConfig();
    }

    /** Runtime change from the settings panel flips joystick visibility live. */
    onConfigChanged(event: ConfigChanged): void {
        if (event.getGroup() !== TouchControlsConfig.group) return;
        this.readConfig();
        this.publish();
    }

    private readConfig(): void {
        this.padMode =
            this.configManager?.getConfig(TouchControlsConfig).padMode() ?? PadMode.DEFAULT;
    }

    renderHud(_osrsClient: OsrsClient): ReactNode {
        return createElement(TouchJoystick, { plugin: this });
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    getUiState(): TouchControlsUiState {
        return this.uiState;
    }

    /** Hold the stick at (forward, right); (0, 0) is centred and stands still. */
    steer(forward: number, right: number): void {
        if (!this.canMove()) return;
        this.stick = { forward, right };
        this.drive();
    }

    release(): void {
        if (!this.stick) return;
        this.stick = undefined;
        this.stopWalking();
    }

    /** RuneLite's ClientTick: keep the walk honest as the camera turns or a menu opens. */
    onClientTick(): void {
        if (this.stick) {
            if (!this.canMove()) this.release();
            else this.drive();
        }
        this.publish();
    }

    protected override async shutDown(): Promise<void> {
        this.release();
    }

    private stopWalking(): void {
        this.client.stopKeyboardMovement?.();
    }

    private drive(): void {
        const { forward, right } = this.stick!;
        if (!forward && !right) {
            this.stopWalking();
            return;
        }
        // Camera-relative, like FirstPersonPlugin: forward walks away from the camera.
        const camera = this.client.camera;
        const yaw = camera.yaw * RS_TO_RADIANS;
        const dx = Math.sin(yaw) * forward + Math.cos(yaw) * right;
        const dy = Math.cos(yaw) * forward - Math.sin(yaw) * right;
        // Face the way we walk: camera forward (yaw + 1024) turned by the stick's angle.
        const turn = Math.round(Math.atan2(right, forward) / RS_TO_RADIANS);
        this.client.setKeyboardMovement?.(dx, dy, !!this.client.runMode, (camera.getYaw() + 1024 + turn) & 2047);
    }

    /**
     * Movement input starts by closing interruptible interfaces server-side, so the
     * joystick must stay inert while a bank or dialogue is open (FirstPersonPlugin's guard).
     */
    private canMove(): boolean {
        if (!this.client.isLoggedIn()) return false;
        const active = typeof document === "undefined" ? undefined : document.activeElement;
        if (active?.matches?.("input, textarea, select, [contenteditable='true']")) return false;
        if (this.client.isWidgetTextInputActive?.()) return false;
        if ((this.client.cs2Vm?.inputDialogType ?? 0) > 1) return false;
        const parents = this.client.widgetManager?.interfaceParents;
        if (parents) {
            for (const [uid, parent] of parents) {
                if ((parent.type === 0 || parent.type === 3) &&
                    !this.client.widgetManager?.isEffectivelyHidden?.(uid)) return false;
            }
        }
        return true;
    }

    private publish(): void {
        // On/Off beat detection and the ?touch= query override; Default keeps both.
        const padOn =
            this.padMode === PadMode.ON ? true : this.padMode === PadMode.OFF ? false : this.touchDevice;
        const visible = padOn && this.client.isLoggedIn();
        if (this.uiState.visible === visible) return;
        this.uiState = { visible };
        for (const listener of [...this.listeners]) {
            try {
                listener();
            } catch (err) {
                console.warn("[touch-controls] listener failed", err);
            }
        }
    }
}
