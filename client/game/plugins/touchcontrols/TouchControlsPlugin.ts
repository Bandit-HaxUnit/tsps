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

const TouchDPad = lazy(() =>
    import("./TouchDPad").then((m) => ({ default: m.TouchDPad })),
);

/** The four d-pad directions; several can be held at once for diagonals. */
export type TouchDirection = "up" | "down" | "left" | "right";

export type TouchControlsUiState = {
    visible: boolean;
    running: boolean;
    pressed: Record<TouchDirection, boolean>;
};

const NO_PRESSED: Record<TouchDirection, boolean> = {
    up: false,
    down: false,
    left: false,
    right: false,
};

/**
 * The slice of OsrsClient the d-pad needs. Kept structural so the plugin stays
 * testable without a full client (same shape as FirstPersonPlugin's client type).
 */
export type TouchControlsClient = {
    camera: Camera;
    isLoggedIn(): boolean;
    isWidgetTextInputActive?(): boolean;
    cs2Vm?: { inputDialogType?: number };
    widgetManager?: {
        interfaceParents: Map<number, { type: number }>;
        isEffectivelyHidden?(uid: number): boolean;
    };
    setKeyboardMovement?(dx: number, dy: number, running: boolean, rotation: number): void;
    stopKeyboardMovement?(deactivate?: boolean): void;
    setKeyboardRunMode?(running: boolean): void;
};

function detectTouchDevice(): boolean {
    if (typeof window === "undefined" || typeof navigator === "undefined") return false;
    const params = new URLSearchParams(window.location.search);
    // ?touch=1 forces the pad on for desktop testing; ?touch=0 hides it on a phone.
    if (params.get("touch") === "0") return false;
    if (params.get("touch") === "1") return true;
    return (navigator.maxTouchPoints ?? 0) > 0 || "ontouchstart" in window;
}

/**
 * On-screen movement pad for phones and tablets.
 *
 * Movement itself already exists end to end: `ContinuousMovement` sends
 * MOVEMENT_INPUT (opcode 215) and the server's FreeMovement plugin walks the
 * player, so this plugin is only the touch control that feeds it. The vector
 * maths mirrors FirstPersonPlugin's WASD handling so both feel the same.
 */
export class TouchControlsPlugin extends Plugin implements ClientPlugin {
    static descriptor: PluginDescriptor = {
        name: "Touch Controls",
        description: "On-screen d-pad and run toggle for walking on touch screens.",
        tags: ["input", "mobile"],
        configKey: "touchcontrolsplugin",
    };

    /** The settings group the Config UI renders for this plugin. */
    static config = TouchControlsConfig;

    private readonly client: TouchControlsClient;
    /** Optional: unavailable in standalone builds (tests), where config stays Default. */
    private readonly configManager?: ConfigManager;
    private readonly touchDevice = detectTouchDevice();
    /** Live touches by pointer id; several can be held at once for diagonals. */
    private readonly pointers = new Map<number, readonly TouchDirection[]>();
    private readonly listeners = new Set<() => void>();
    private running = false;
    private padMode: PadModeValue = PadMode.DEFAULT;
    private uiState: TouchControlsUiState = { visible: false, running: false, pressed: { ...NO_PRESSED } };

    constructor(client?: TouchControlsClient) {
        super();
        this.client = client ?? inject<TouchControlsClient>(CLIENT_TOKEN);
        try {
            this.configManager = inject(ConfigManager);
        } catch {
            // Built standalone (tests): the pad follows device detection only.
        }
        this.readConfig();
    }

    /** Runtime change from the settings panel flips pad visibility live. */
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
        return createElement(TouchDPad, { plugin: this });
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

    press(pointerId: number, direction: TouchDirection): void {
        if (!this.canMove()) return;
        this.pointers.set(pointerId, [direction]);
        this.publish();
        this.drive();
    }

    /**
     * 8-way pad: one pointer holds a set of directions (a slide across the pad
     * re-aims it); everything else about the pointer is untouched.
     */
    aim(pointerId: number, directions: readonly TouchDirection[]): void {
        if (!this.canMove()) return;
        this.pointers.set(pointerId, directions);
        this.publish();
        this.drive();
    }

    release(pointerId: number): void {
        if (!this.pointers.delete(pointerId)) return;
        this.publish();
        this.drive();
    }

    toggleRun(): void {
        this.running = !this.running;
        this.publish();
        if (this.pointers.size) this.drive();
    }

    /** RuneLite's ClientTick: keep the pad honest as the camera turns or a menu opens. */
    onClientTick(): void {
        if (this.pointers.size > 0) {
            if (!this.canMove()) this.releaseAll();
            else this.drive();
        }
        this.publish();
    }

    protected override async shutDown(): Promise<void> {
        this.releaseAll();
    }

    private releaseAll(): void {
        if (this.pointers.size === 0) return;
        this.pointers.clear();
        this.stopWalking();
        this.publish();
    }

    private stopWalking(): void {
        this.client.stopKeyboardMovement?.();
    }

    private drive(): void {
        let forward = 0;
        let right = 0;
        for (const directions of this.pointers.values()) {
            for (const direction of directions) {
                if (direction === "up") forward += 1;
                else if (direction === "down") forward -= 1;
                else if (direction === "right") right += 1;
                else right -= 1;
            }
        }
        if (!forward && !right) {
            this.stopWalking();
            return;
        }
        // Camera-relative, like FirstPersonPlugin: "up" walks away from the camera.
        const camera = this.client.camera;
        const yaw = camera.yaw * RS_TO_RADIANS;
        const length = Math.hypot(forward, right);
        const dx = (Math.sin(yaw) * forward + Math.cos(yaw) * right) / length;
        const dy = (Math.cos(yaw) * forward - Math.sin(yaw) * right) / length;
        this.client.setKeyboardRunMode?.(this.running);
        this.client.setKeyboardMovement?.(dx, dy, this.running, (camera.getYaw() + 1024) & 2047);
    }

    /**
     * Movement input starts by closing interruptible interfaces server-side, so the pad
     * must stay inert while a bank or dialogue is open (FirstPersonPlugin's guard).
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
        const pressed = { ...NO_PRESSED };
        for (const directions of this.pointers.values()) {
            for (const direction of directions) pressed[direction] = true;
        }
        // On/Off beat detection and the ?touch= query override; Default keeps both.
        const padOn =
            this.padMode === PadMode.ON ? true : this.padMode === PadMode.OFF ? false : this.touchDevice;
        const visible = padOn && this.client.isLoggedIn();
        const current = this.uiState;
        if (current.visible === visible && current.running === this.running &&
            current.pressed.up === pressed.up && current.pressed.down === pressed.down &&
            current.pressed.left === pressed.left && current.pressed.right === pressed.right) return;
        this.uiState = { visible, running: this.running, pressed };
        for (const listener of [...this.listeners]) {
            try {
                listener();
            } catch (err) {
                console.warn("[touch-controls] listener failed", err);
            }
        }
    }
}
