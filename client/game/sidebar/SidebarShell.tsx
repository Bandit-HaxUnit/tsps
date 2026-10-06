import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

import type { OsrsClient } from "../OsrsClient";
import type { PluginClass } from "../../runelite/client/plugins/Plugin";
import { ConfigPanel } from "../../runelite/client/ui/config/ConfigPanel";
import { PluginListPanel } from "../../runelite/client/ui/plugin/PluginListPanel";
import { GroundItemsPlugin } from "../plugins/grounditems/GroundItemsPlugin";
import { InteractHighlightPlugin } from "../plugins/interacthighlight/InteractHighlightPlugin";
import { TileMarkersPlugin } from "../plugins/tilemarkers/TileMarkersPlugin";
import "./SidebarShell.css";
import type { SidebarStore } from "./SidebarStore";
import type { ClientSidebarEntryData, SidebarPanelId } from "./entries";
import type { SidebarRailIconRenderer } from "./pluginTypes";
import { MenuSwapperPanel } from "../plugins/menuswapper/MenuSwapperPanel";

function SidebarRailIcon({
    icon,
    label,
}: {
    icon?: SidebarRailIconRenderer;
    label: string;
}): JSX.Element {
    if (!icon) {
        return <span className="rl-sidebar-icon-fallback">{label.slice(0, 1).toUpperCase()}</span>;
    }
    const Icon = icon;
    return <Icon label={label} />;
}

function SidebarToggleGlyph({ open }: { open: boolean }): JSX.Element {
    return (
        <svg className="rl-sidebar-toggle-chevron" viewBox="0 0 12 20" aria-hidden="true">
            <path d={open ? "M3.6 3.1L8.1 10l-4.5 6.9" : "M8.4 3.1L3.9 10l4.5 6.9"} />
        </svg>
    );
}

function SidebarNotesPanel({ osrsClient }: { osrsClient: OsrsClient }): JSX.Element {
    const plugin = osrsClient.notesPlugin;
    const subscribe = useCallback((listener: () => void) => plugin.subscribe(listener), [plugin]);
    const getSnapshot = useCallback(() => plugin.getState(), [plugin]);
    const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

    const onChange = useCallback(
        (value: string) => {
            plugin.setConfig({ notes: value });
        },
        [plugin],
    );

    return (
        <div className="rl-sidebar-panel-content">
            <div className="rl-sidebar-panel-title">Notes</div>
            <textarea
                className="rl-sidebar-notes-input"
                value={state.config.notes}
                onChange={(event) => onChange(event.target.value)}
                placeholder="Write notes for plugin work here."
            />
        </div>
    );
}

/** The generated RuneLite-shaped settings panel for one plugin class. */
function PluginConfigPanel({
    osrsClient,
    pluginClass,
}: {
    osrsClient: OsrsClient;
    pluginClass: PluginClass;
}): JSX.Element {
    const config = pluginClass.config;
    if (!config) {
        return <p className="rl-sidebar-panel-copy">This plugin has no settings.</p>;
    }
    return (
        <div className="rl-sidebar-panel-content rl-sidebar-scrollable">
            <ConfigPanel
                descriptor={config}
                configManager={osrsClient.runeLite.configManager}
                title={pluginClass.descriptor.name}
            />
        </div>
    );
}

export interface SidebarPanelRenderContext {
    osrsClient: OsrsClient;
    selectedEntryId: string;
}

export type SidebarPanelRenderer = (ctx: SidebarPanelRenderContext) => JSX.Element;

export interface SidebarShellProps {
    osrsClient: OsrsClient;
    store: SidebarStore<ClientSidebarEntryData>;
    panelRenderers?: Record<SidebarPanelId, SidebarPanelRenderer>;
}

const DEFAULT_PANEL_RENDERERS: Record<string, SidebarPanelRenderer> = {
    plugin_hub: ({ osrsClient }) => (
        <PluginListPanel
            pluginManager={osrsClient.runeLite.pluginManager}
            configManager={osrsClient.runeLite.configManager}
        />
    ),
    ground_items: ({ osrsClient }) => (
        <PluginConfigPanel osrsClient={osrsClient} pluginClass={GroundItemsPlugin} />
    ),
    interact_highlight: ({ osrsClient }) => (
        <PluginConfigPanel osrsClient={osrsClient} pluginClass={InteractHighlightPlugin} />
    ),
    tile_markers: ({ osrsClient }) => (
        <PluginConfigPanel osrsClient={osrsClient} pluginClass={TileMarkersPlugin} />
    ),
    notes: (ctx) => <SidebarNotesPanel osrsClient={ctx.osrsClient} />,
    menu_swapper: (ctx) => <MenuSwapperPanel plugin={ctx.osrsClient.menuSwapperPlugin} />,
};

export function SidebarShell({
    osrsClient,
    store,
    panelRenderers,
}: SidebarShellProps): JSX.Element {
    const subscribe = useCallback((listener: () => void) => store.subscribe(listener), [store]);
    const getSnapshot = useCallback(() => store.getState(), [store]);

    const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

    const selectedEntry = useMemo(() => {
        if (!state.selectedId) return undefined;
        return state.entries.find((entry) => entry.id === state.selectedId);
    }, [state.entries, state.selectedId]);
    const pluginHubEntry = useMemo(
        () => state.entries.find((entry) => entry.id === "plugin_hub"),
        [state.entries],
    );

    const resolvedRenderers = useMemo(
        () => ({
            ...DEFAULT_PANEL_RENDERERS,
            ...(panelRenderers ? panelRenderers : {}),
        }),
        [panelRenderers],
    );

    const selectedPanelId = selectedEntry?.data?.panelId;
    const panelRenderer = selectedPanelId ? resolvedRenderers[selectedPanelId] : undefined;
    const shouldShowPanel =
        state.open && selectedEntry !== undefined && panelRenderer !== undefined;
    const drawerTitle = selectedEntry?.title ?? pluginHubEntry?.title ?? "Plugins";

    useEffect(() => {
        if (!shouldShowPanel) {
            return;
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                store.setOpen(false);
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [shouldShowPanel, store]);

    const onDrawerToggle = useCallback(() => {
        if (state.open) {
            store.setOpen(false);
            return;
        }

        if (state.selectedId) {
            store.setOpen(true);
            return;
        }

        const fallbackEntryId =
            pluginHubEntry?.id ?? (state.entries[0] ? state.entries[0].id : null);
        if (fallbackEntryId) {
            store.select(fallbackEntryId);
        }
    }, [pluginHubEntry, state.entries, state.open, state.selectedId, store]);

    const onEntryClick = useCallback(
        (entryId: string) => {
            if (state.open && state.selectedId === entryId) {
                store.setOpen(false);
                return;
            }
            store.select(entryId);
        },
        [state.open, state.selectedId, store],
    );

    return (
        <div className={`rl-sidebar-root ${shouldShowPanel ? "open" : "closed"}`}>
            <button
                type="button"
                className="rl-sidebar-backdrop"
                onClick={() => store.setOpen(false)}
                aria-label="Close sidebar"
                tabIndex={shouldShowPanel ? 0 : -1}
            />
            <button
                type="button"
                className={`rl-sidebar-toggle ${shouldShowPanel ? "active" : ""}`}
                onClick={onDrawerToggle}
                aria-label={shouldShowPanel ? "Collapse sidebar" : "Open sidebar"}
                aria-expanded={shouldShowPanel}
                aria-hidden={shouldShowPanel}
                tabIndex={shouldShowPanel ? -1 : 0}
                title={shouldShowPanel ? "Collapse sidebar" : "Open sidebar"}
            >
                <SidebarToggleGlyph open={shouldShowPanel} />
            </button>
            <aside className="rl-sidebar-drawer" aria-hidden={!shouldShowPanel}>
                <div className="rl-sidebar-drawer-header">
                    <div className="rl-sidebar-heading">
                        <div className="rl-sidebar-heading-kicker">RSPS.app</div>
                        <div className="rl-sidebar-heading-title">{drawerTitle}</div>
                    </div>
                    <button
                        type="button"
                        className="rl-sidebar-close"
                        onClick={() => store.setOpen(false)}
                        aria-label="Close sidebar"
                        title="Close sidebar"
                    >
                        <SidebarToggleGlyph open={true} />
                    </button>
                </div>
                <div className="rl-sidebar-buttons">
                    {state.entries.map((entry) => {
                        const active = state.selectedId === entry.id;
                        const icon = entry.data?.icon;
                        return (
                            <button
                                key={entry.id}
                                type="button"
                                className={`rl-sidebar-button ${active ? "active" : ""}`}
                                onClick={() => onEntryClick(entry.id)}
                                aria-label={entry.title}
                                title={entry.tooltip ? entry.tooltip : entry.title}
                            >
                                <SidebarRailIcon icon={icon} label={entry.title} />
                            </button>
                        );
                    })}
                </div>
                {shouldShowPanel && panelRenderer && selectedEntry && (
                    <section className="rl-sidebar-panel">
                        {panelRenderer({
                            osrsClient,
                            selectedEntryId: selectedEntry.id,
                        })}
                    </section>
                )}
            </aside>
        </div>
    );
}
