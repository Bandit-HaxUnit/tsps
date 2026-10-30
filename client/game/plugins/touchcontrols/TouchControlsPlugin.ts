import type { OsrsClient } from "../../OsrsClient";
import { ConfigChanged } from "@runelite/api/events";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { CLIENT_TOKEN, inject } from "@runelite/client/plugins/PluginInjector";
import type { Camera } from "../../Camera";
import { ClientState } from "../../ClientState";
import type { ContinuousMovementRefusal } from "../../movement/ContinuousMovement";
import type { SceneGeometry } from "../../scene/SceneGeometry";
import type { ClientPlugin, LocOutline } from "../ClientPluginManager";
import type { InteractHighlightPluginConfig } from "../interacthighlight/InteractHighlightConfig";
import type { LocType } from "../../../rs/config/loctype/LocType";
import { RS_TO_RADIANS } from "../../../rs/MathConstants";
import { MOBILE_ROOT_INTERFACE } from "../../../rs/cs2/ClientType";
import { menuAction } from "../../../ui/menu/MenuAction";
import { MenuOpcode } from "../../../ui/menu/MenuState";
import { createElement, lazy, type ReactNode } from "react";
import { PadMode, type PadModeValue, TouchControlsConfig } from "./TouchControlsConfig";
import { findBlockingTarget, isStillInReach, targetFor, type TouchTarget, type TouchTargetWorld } from "./TouchTargets";

const TouchJoystick = lazy(() =>
    import("./TouchJoystick").then((m) => ({ default: m.TouchJoystick })),
);

/** The menu opcodes for a loc's five cache options, as a click on them sends. */
const LOC_OPCODES = [MenuOpcode.GameObjectFirstOption, MenuOpcode.GameObjectSecondOption,
    MenuOpcode.GameObjectThirdOption, MenuOpcode.GameObjectFourthOption, MenuOpcode.GameObjectFifthOption];
/** 601:50, the mobile layout's tab stones, which the action button keeps clear of. */
const MOBILE_STONES = (MOBILE_ROOT_INTERFACE << 16) | 50;
/** A collision counts while it is this fresh, in ms. */
const REFUSAL_MS = 300;
/** How square-on the walk must hit the edge (cosine), so sliding along a fence targets nothing. */
const HEAD_ON = 0.8;

export type TouchAction = {
    target: string;
    options: ReadonlyArray<{ option: string; actionIndex: number }>;
};

export type TouchControlsUiState = {
    visible: boolean;
    /** The object the player walked into; its first option is the button. */
    action?: TouchAction;
    /** CSS px from the game's right edge to the tab stones' left edge (0 without them). */
    stonesInset: number;
};

/**
 * The slice of OsrsClient the touch controls need. Kept structural so the plugin stays
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
        rootInterface?: number;
        interfaceParents: Map<number, { type: number }>;
        isEffectivelyHidden?(uid: number): boolean;
        getWidgetByUid?(uid: number): { x?: number; parentUid?: number } | undefined;
    };
    renderer?: { canvas?: { width: number; clientWidth: number } };
    playerEcs?: { getIndexForServerId(serverId: number): number | undefined; getX(i: number): number; getY(i: number): number; getLevel(i: number): number };
    controlledPlayerServerId?: number;
    sceneGeometry?: Pick<SceneGeometry, "locsAtTile">;
    locTypeLoader?: { load(id: number): LocType | undefined };
    varManager?: unknown;
    locOpFlagsAt?(x: number, y: number, locId: number): number | undefined;
    clientPlugins?: { interactHighlightConfig(): InteractHighlightPluginConfig | undefined };
    setKeyboardMovement?(dx: number, dy: number, running: boolean, rotation: number): void;
    stopKeyboardMovement?(deactivate?: boolean): void;
    getKeyboardMovementRefusal?(): ContinuousMovementRefusal | undefined;
    /** Sends a menu option as a click on it would; defaults to the client's menuAction. */
    menuAction?(arg0: number, arg1: number, opcode: number, identifier: number, option: string, target: string): void;
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
 * On-screen movement joystick and action button for phones and tablets.
 *
 * Movement itself already exists end to end: `ContinuousMovement` sends
 * MOVEMENT_INPUT (opcode 215) and the server's FreeMovement plugin walks the
 * player, so this plugin is only the touch control that feeds it. Walking into an
 * object with options (a tree, bank booth, door or the Wilderness ditch) puts its
 * first option on the action button and outlines it in Interact Highlight's hover colour.
 */
export class TouchControlsPlugin extends Plugin implements ClientPlugin {
    static descriptor: PluginDescriptor = {
        name: "Touch Controls",
        description: "On-screen joystick and action button for touch screens.",
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
    /** The walk direction last sent, in world tiles (x east, y north). */
    private heading?: { dx: number; dy: number };
    /** After an action the held stick stays inert until the thumb lifts, or it would cancel the action. */
    private suspended = false;
    private focus?: TouchTarget;
    private seenRefusal?: ContinuousMovementRefusal;
    private padMode: PadModeValue = PadMode.DEFAULT;
    private uiState: TouchControlsUiState = { visible: false, stonesInset: 0 };
    private uiKey = "";

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
        if (this.suspended || !this.canMove()) return;
        this.stick = { forward, right };
        this.drive();
    }

    release(): void {
        this.suspended = false;
        if (!this.stick) return;
        this.stick = undefined;
        this.heading = undefined;
        this.stopWalking();
    }

    /** Use one of the focused object's options, as clicking it would. */
    interact(actionIndex: number): void {
        const focus = this.focus;
        const option = focus?.options.find((o) => o.actionIndex === actionIndex);
        if (!focus || !option || !this.canMove()) return;
        if (this.stick) {
            this.suspended = true;
            this.heading = undefined;
            this.stopWalking();
        }
        const { loc } = focus;
        const args = [loc.tileX - ClientState.baseX, loc.tileY - ClientState.baseY, LOC_OPCODES[actionIndex], loc.id,
            option.option, focus.name] as const;
        if (this.client.menuAction) this.client.menuAction(...args);
        else {
            menuAction(args[0], args[1], args[2], args[3], -1, args[4], args[5], 0, 0);
            // No click happened on screen, so no click cross either.
            ClientState.mouseCrossState = 100;
        }
    }

    /** RuneLite's ClientTick: keep the walk honest as the camera turns or a menu opens. */
    onClientTick(): void {
        if (this.stick && !this.suspended) {
            if (!this.canMove()) this.release();
            else this.drive();
        }
        this.updateFocus();
        this.publish();
    }

    /** The focused object, outlined like Interact Highlight's hover. */
    locOutlines(): LocOutline[] {
        const config = this.client.clientPlugins?.interactHighlightConfig();
        if (!this.focus || !this.uiState.action || !config?.enabled || !config.showHover) return [];
        return [{ loc: this.focus.loc, color: config.hoverColor, alpha: 0.45, width: 2 }];
    }

    protected override async shutDown(): Promise<void> {
        this.release();
        this.focus = undefined;
    }

    private stopWalking(): void {
        this.client.stopKeyboardMovement?.();
    }

    private drive(): void {
        const { forward, right } = this.stick!;
        if (!forward && !right) {
            this.heading = undefined;
            this.stopWalking();
            return;
        }
        // Camera-relative, like FirstPersonPlugin: forward walks away from the camera.
        const camera = this.client.camera;
        const yaw = camera.yaw * RS_TO_RADIANS;
        const dx = Math.sin(yaw) * forward + Math.cos(yaw) * right;
        const dy = Math.cos(yaw) * forward - Math.sin(yaw) * right;
        this.heading = { dx, dy };
        // Face the way we walk: camera forward (yaw + 1024) turned by the stick's angle.
        const turn = Math.round(Math.atan2(right, forward) / RS_TO_RADIANS);
        this.client.setKeyboardMovement?.(dx, dy, !!this.client.runMode, (camera.getYaw() + 1024 + turn) & 2047);
    }

    /** Walking head-on into an object focuses it; walking away (or it going) drops it. */
    private updateFocus(): void {
        const world = this.world();
        const player = this.playerTile();
        if (!world || !player) {
            this.focus = undefined;
            return;
        }
        const refusal = this.client.getKeyboardMovementRefusal?.();
        if (refusal && refusal !== this.seenRefusal && this.heading &&
            performance.now() - refusal.at < REFUSAL_MS) {
            this.seenRefusal = refusal;
            const ex = refusal.toX - refusal.fromX, ey = refusal.toY - refusal.fromY;
            const dot = (ex * this.heading.dx + ey * this.heading.dy) /
                (Math.hypot(ex, ey) * Math.hypot(this.heading.dx, this.heading.dy) || 1);
            const target = dot >= HEAD_ON ? findBlockingTarget(refusal, world) : undefined;
            if (target) this.focus = target;
        }
        if (this.focus) {
            const { loc } = this.focus;
            // Options follow the object's current form (an opened gate, a chopped tree).
            this.focus = isStillInReach(loc, world, player.x, player.y, player.plane) ? targetFor(loc, world) : undefined;
        }
    }

    private world(): TouchTargetWorld | undefined {
        const { sceneGeometry: geometry, locTypeLoader: loader } = this.client;
        if (!geometry || !loader) return undefined;
        const load = (id: number) => {
            try {
                return loader.load(id);
            } catch {
                return undefined;
            }
        };
        return {
            locsAtTile: (x, y, plane) => geometry.locsAtTile(x, y, plane),
            size: (id) => {
                const type = load(id);
                return { sizeX: type?.sizeX ?? 1, sizeY: type?.sizeY ?? 1 };
            },
            current: (id) => {
                const type = load(id);
                if (!type?.transforms) return type;
                return type.transform(this.client.varManager as never, loader as never) ?? undefined;
            },
            opFlags: (x, y, id) => this.client.locOpFlagsAt?.(x, y, id),
        };
    }

    private playerTile(): { x: number; y: number; plane: number } | undefined {
        const players = this.client.playerEcs;
        const index = players?.getIndexForServerId(this.client.controlledPlayerServerId ?? -1);
        if (!players || index === undefined) return undefined;
        return { x: players.getX(index) >> 7, y: players.getY(index) >> 7, plane: players.getLevel(index) | 0 };
    }

    /** CSS px from the right edge of the game to the left edge of the mobile tab stones. */
    private stonesInset(): number {
        const widgets = this.client.widgetManager;
        const canvas = this.client.renderer?.canvas;
        if (widgets?.rootInterface !== MOBILE_ROOT_INTERFACE || !canvas?.width || !canvas.clientWidth ||
            widgets.isEffectivelyHidden?.(MOBILE_STONES)) return 0;
        let widget = widgets.getWidgetByUid?.(MOBILE_STONES);
        if (!widget) return 0;
        // Add up layout x to the root, whose render transform maps it onto the canvas.
        let x = 0;
        let root = widget;
        for (let hops = 0; widget && hops < 50; hops++) {
            x += widget.x ?? 0;
            root = widget;
            widget = widget.parentUid === undefined || widget.parentUid === -1 ? undefined : widgets.getWidgetByUid?.(widget.parentUid);
        }
        const transform = root as { __widgetRenderScaleX?: number; __widgetRenderOffsetX?: number };
        const canvasX = x * (transform.__widgetRenderScaleX ?? 1) + (transform.__widgetRenderOffsetX ?? 0);
        return Math.max(0, Math.round(canvas.clientWidth - canvasX * canvas.clientWidth / canvas.width));
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
        const action = visible && this.focus && this.canMove()
            ? { target: this.focus.name, options: this.focus.options } : undefined;
        const stonesInset = visible ? this.stonesInset() : 0;
        const key = JSON.stringify([visible, action, stonesInset]);
        if (key === this.uiKey) return;
        this.uiKey = key;
        this.uiState = { visible, action, stonesInset };
        for (const listener of [...this.listeners]) {
            try {
                listener();
            } catch (err) {
                console.warn("[touch-controls] listener failed", err);
            }
        }
    }
}
