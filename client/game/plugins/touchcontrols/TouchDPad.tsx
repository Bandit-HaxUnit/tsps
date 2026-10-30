import { useCallback, useSyncExternalStore } from "react";

import { type TouchControlsPlugin, type TouchDirection } from "./TouchControlsPlugin";
import "./TouchDPad.css";

const BUTTONS: ReadonlyArray<{ direction: TouchDirection; label: string; className: string }> = [
    { direction: "up", label: "▲", className: "touch-dpad-up" },
    { direction: "left", label: "◀", className: "touch-dpad-left" },
    { direction: "right", label: "▶", className: "touch-dpad-right" },
    { direction: "down", label: "▼", className: "touch-dpad-down" },
];

/**
 * Bottom-left movement pad plus a run toggle. The pad is one touch surface:
 * press and slide so a single finger can hold a diagonal. Touches are captured
 * per pointer so a second finger (pad + camera drag) never fights, and nothing
 * reaches the game canvas underneath.
 */
export function TouchDPad({ plugin }: { plugin: TouchControlsPlugin }): JSX.Element | null {
    const subscribe = useCallback((listener: () => void) => plugin.subscribe(listener), [plugin]);
    const getSnapshot = useCallback(() => plugin.getUiState(), [plugin]);
    const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

    const DEAD_ZONE_PX = 18;

    /** Turn a slide position into the directions that finger currently holds. */
    const aimPad = (pointerId: number, clientX: number, clientY: number, pad: HTMLElement) => {
        const rect = pad.getBoundingClientRect();
        const dx = clientX - (rect.left + rect.width / 2);
        const dy = clientY - (rect.top + rect.height / 2);
        const directions: TouchDirection[] = [];
        if (dy < -DEAD_ZONE_PX) directions.push("up");
        else if (dy > DEAD_ZONE_PX) directions.push("down");
        if (dx < -DEAD_ZONE_PX) directions.push("left");
        else if (dx > DEAD_ZONE_PX) directions.push("right");
        plugin.aim(pointerId, directions);
    };

    const onPadDown = (event: React.PointerEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
        try {
            event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
            // Pointer capture is best effort; the pad still releases on pointerup.
        }
        aimPad(event.pointerId, event.clientX, event.clientY, event.currentTarget);
    };

    const onPadMove = (event: React.PointerEvent<HTMLDivElement>) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        event.preventDefault();
        event.stopPropagation();
        aimPad(event.pointerId, event.clientX, event.clientY, event.currentTarget);
    };

    const onPadUp = (event: React.PointerEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
        plugin.release(event.pointerId);
    };

    if (!state.visible) return null;

    return (
        <div className="touch-controls">
            <div
                className="touch-dpad"
                role="group"
                aria-label="Movement pad"
                onPointerDown={onPadDown}
                onPointerMove={onPadMove}
                onPointerUp={onPadUp}
                onPointerCancel={onPadUp}
                // WebView can drop pointerup when the finger leaves the
                // screen; lostpointercapture then guarantees the release.
                onLostPointerCapture={onPadUp}
                onContextMenu={(event) => event.preventDefault()}
            >
                {BUTTONS.map(({ direction, label, className }) => (
                    <span
                        key={direction}
                        aria-label={`Walk ${direction}`}
                        className={`touch-dpad-button ${className}${state.pressed[direction] ? " is-pressed" : ""}`}
                    >
                        {label}
                    </span>
                ))}
            </div>
            <button
                type="button"
                aria-pressed={state.running}
                className={`touch-run${state.running ? " is-on" : ""}`}
                onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    plugin.toggleRun();
                }}
                onContextMenu={(event) => event.preventDefault()}
            >
                Run
            </button>
        </div>
    );
}
