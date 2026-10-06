import { useEffect, useReducer, useState } from "react";

import type { PluginClass } from "@runelite/client/plugins/Plugin";
import type { PluginManager } from "@runelite/client/plugins/PluginManager";
import type { ConfigManager } from "@runelite/client/config/ConfigManager";
import { ConfigPanel } from "../config/ConfigPanel";

export function PluginListPanel({
    pluginManager,
    configManager,
}: {
    pluginManager: PluginManager;
    configManager: ConfigManager;
}): JSX.Element {
    const [, forceUpdate] = useReducer((version: number) => version + 1, 0);
    useEffect(() => pluginManager.subscribe(forceUpdate), [pluginManager]);
    const [search, setSearch] = useState("");
    const [openConfig, setOpenConfig] = useState<PluginClass | undefined>();

    const needle = search.trim().toLowerCase();
    const pluginClasses = pluginManager
        .getPluginClasses()
        .filter((pluginClass) => !pluginClass.descriptor.hidden)
        .filter((pluginClass) => {
            if (!needle) return true;
            const descriptor = pluginClass.descriptor;
            const haystack = [descriptor.name, descriptor.description ?? "", ...(descriptor.tags ?? [])]
                .join(" ")
                .toLowerCase();
            return haystack.includes(needle);
        })
        .sort((a, b) => a.descriptor.name.localeCompare(b.descriptor.name));

    return (
        <div className="rl-sidebar-panel-content rl-sidebar-scrollable">
            <div className="rl-sidebar-panel-title">RSPS.app</div>
            <p className="rl-sidebar-panel-copy">
                Enable or disable plugins. Toggle states persist in local storage.
            </p>
            <label className="rl-sidebar-field">
                <span>Search</span>
                <input
                    type="search"
                    value={search}
                    placeholder="Plugin name or tag"
                    onChange={(event) => setSearch(event.target.value)}
                />
            </label>
            {pluginClasses.map((pluginClass) => {
                const descriptor = pluginClass.descriptor;
                const enabled = pluginManager.isEnabled(pluginClass);
                const failed = pluginManager.getFailure(pluginClass);
                const config = pluginClass.config;
                return (
                    <div key={descriptor.configKey ?? descriptor.name}>
                        <div className="rl-sidebar-plugin-row">
                            <button
                                type="button"
                                className="rl-sidebar-plugin-open"
                                onClick={() =>
                                    setOpenConfig((current) =>
                                        current === pluginClass ? undefined : pluginClass,
                                    )
                                }
                                aria-label={`${descriptor.name} settings`}
                                title="Plugin settings"
                                disabled={!config}
                            >
                                <span className="rl-sidebar-plugin-name">{descriptor.name}</span>
                                {descriptor.description ? (
                                    <span className="rl-sidebar-plugin-desc">{descriptor.description}</span>
                                ) : null}
                                {failed ? (
                                    <span className="rl-sidebar-plugin-failure">Failed: {failed}</span>
                                ) : null}
                            </button>
                            <input
                                type="checkbox"
                                checked={enabled}
                                onChange={(event) =>
                                    void pluginManager.setPluginEnabled(
                                        pluginClass,
                                        event.target.checked,
                                    )
                                }
                                aria-label={`Enable ${descriptor.name} plugin`}
                            />
                        </div>
                        {openConfig === pluginClass && config ? (
                            <div className="rl-plugin-config-embed">
                                <ConfigPanel
                                    descriptor={config}
                                    configManager={configManager}
                                    title={`${descriptor.name} settings`}
                                />
                            </div>
                        ) : null}
                    </div>
                );
            })}
            {pluginClasses.length === 0 ? (
                <p className="rl-sidebar-panel-copy">No plugins match “{search}”.</p>
            ) : null}
        </div>
    );
}
