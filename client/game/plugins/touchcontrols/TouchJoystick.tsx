import { useCallback, useState, useSyncExternalStore } from "react";

import { isIosLandscapeRotated } from "../../InputManager";
import { type TouchControlsPlugin } from "./TouchControlsPlugin";
import "./TouchJoystick.css";

/** Knob travel from the centre, in px; matches the CSS base/knob sizes. */
const RADIUS = 44;
/** Fraction of the travel that still counts as centred. */
const DEAD_ZONE = 0.2;

/**
 * Bottom-left analog joystick. The knob follows the finger inside the base and
 * springs back on release. The touch is captured per pointer so a second finger
 * can drag the camera, and nothing reaches the game canvas underneath.
 */
export function TouchJoystick({ plugin }: { plugin: TouchControlsPlugin }): JSX.Element | null {
    const subscribe = useCallback((listener: () => void) => plugin.subscribe(listener), [plugin]);
    const getSnapshot = useCallback(() => plugin.getUiState(), [plugin]);
    const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    const [knob, setKnob] = useState<{ x: number; y: number } | null>(null);

    const steer = (clientX: number, clientY: number, base: HTMLElement) => {
        const rect = base.getBoundingClientRect();
        const screenX = clientX - (rect.left + rect.width / 2);
        const screenY = clientY - (rect.top + rect.height / 2);
        // iOS portrait turns the whole game +90deg (index.css): map the finger back
        // into the game's own axes, as getMousePos does for the canvas.
        const rotated = isIosLandscapeRotated();
        let x = rotated ? screenY : screenX;
        let y = rotated ? -screenX : screenY;
        const distance = Math.hypot(x, y);
        if (distance > RADIUS) {
            x *= RADIUS / distance;
            y *= RADIUS / distance;
        }
        setKnob({ x, y });
        // Screen y grows down; forward is up.
        if (Math.hypot(x, y) < RADIUS * DEAD_ZONE) plugin.steer(0, 0);
        else plugin.steer(-y / RADIUS, x / RADIUS);
    };

    const onDown = (event: React.PointerEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
        try {
            event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
            // Pointer capture is best effort; the stick still releases on pointerup.
        }
        steer(event.clientX, event.clientY, event.currentTarget);
    };

    const onMove = (event: React.PointerEvent<HTMLDivElement>) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        event.preventDefault();
        event.stopPropagation();
        steer(event.clientX, event.clientY, event.currentTarget);
    };

    const onUp = (event: React.PointerEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
        setKnob(null);
        plugin.release();
    };

    if (!state.visible) return null;

    return (
        <div className="touch-controls">
            <div
                className={`touch-joystick${knob ? " is-active" : ""}`}
                role="group"
                aria-label="Movement joystick"
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={onUp}
                // WebView can drop pointerup when the finger leaves the
                // screen; lostpointercapture then guarantees the release.
                onLostPointerCapture={onUp}
                onContextMenu={(event) => event.preventDefault()}
            >
                <span
                    className="touch-joystick-knob"
                    style={knob ? { transform: `translate(${knob.x}px, ${knob.y}px)` } : undefined}
                />
            </div>
        </div>
    );
}
