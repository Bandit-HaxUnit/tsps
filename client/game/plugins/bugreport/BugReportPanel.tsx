import { useCallback, useSyncExternalStore } from "react";

import { NavigationButton } from "@runelite/client/ui/NavigationButton";
import type { BugReportPlugin, BugReportState } from "./BugReportPlugin";

function BugIcon({ label }: { label: string }): JSX.Element {
    return (
        <svg className="rl-sidebar-icon-svg" viewBox="0 0 24 24" role="img" aria-label={label}>
            <text
                x="12"
                y="9.5"
                textAnchor="middle"
                fontSize="12"
                fontWeight={800}
                letterSpacing="0"
                textLength="22"
                lengthAdjust="spacingAndGlyphs"
                fill="#ef5350"
                style={{ fontFamily: "var(--rl-font-bold, Arial, sans-serif)" }}
            >
                BUG
            </text>
            <text
                x="12"
                y="20"
                textAnchor="middle"
                fontSize="9"
                fontWeight={800}
                fill="#ef5350"
                style={{ fontFamily: "var(--rl-font-bold, Arial, sans-serif)" }}
            >
                ?
            </text>
        </svg>
    );
}

/** Report a Bug: describe it here, copy the screenshot, then file it on the prefilled GitHub issue. */
export function BugReportPanel({ plugin }: { plugin: BugReportPlugin }): JSX.Element {
    const subscribe = useCallback((listener: () => void) => plugin.subscribe(listener), [plugin]);
    const getSnapshot = useCallback(() => plugin.getState(), [plugin]);
    const state: BugReportState = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    return (
        <form
            className="rl-sidebar-panel-content rl-sidebar-scrollable"
            onSubmit={(event) => {
                event.preventDefault();
                plugin.openIssue();
            }}
        >
            <label className="rl-sidebar-field">
                What went wrong?
                <textarea
                    className="rl-sidebar-textarea"
                    rows={6}
                    maxLength={2000}
                    required
                    value={state.description}
                    placeholder="What happened, and what did you expect? Steps to make it happen again help most."
                    onChange={(event) => plugin.setDescription(event.target.value)}
                />
            </label>
            <p className="rl-sidebar-panel-copy">
                {state.capturing
                    ? "Taking a screenshot…"
                    : state.screenshot
                      ? "Screenshot ready."
                      : "No screenshot yet: log in to take one, or paste your own."}
            </p>
            <button
                type="button"
                className="rl-sidebar-text-button"
                disabled={state.capturing}
                onClick={() => void plugin.copyScreenshotToClipboard()}
            >
                Copy game screenshot to clipboard
            </button>
            <p className="rl-sidebar-panel-copy">
                Filing opens a GitHub issue with your description, player and account state
                (position, skills, inventory, equipment), world, client details, game messages
                and recent errors. No address, identifier or browsing data is sent.
            </p>
            {state.notice ? (
                <p className="rl-sidebar-panel-copy" role="status">
                    {state.notice}
                </p>
            ) : null}
            {/* Not disabled on an empty description: a greyed button that ignores clicks reads as
                broken. `required` makes the browser say what is missing instead. */}
            <button type="submit" className="rl-sidebar-text-button">
                Open GitHub issue
            </button>
        </form>
    );
}

/** The Report a Bug button, last on the rail, below every plugin's button. */
export function createBugReportNavigationButton(plugin: BugReportPlugin): NavigationButton {
    return NavigationButton.builder()
        .tooltip("Report a Bug")
        .icon(BugIcon)
        .priority(100)
        .panel(() => <BugReportPanel plugin={plugin} />)
        .build();
}
