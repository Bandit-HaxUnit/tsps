import type { ClientSidebarPluginDefinition } from "../../sidebar/pluginTypes";

export const MENU_SWAPPER_SIDEBAR_PLUGIN: ClientSidebarPluginDefinition = Object.freeze({
    id: "menu_swapper",
    title: "Menu Entry Swapper",
    tooltip: "Menu Entry Swapper",
    priority: 185,
    panelId: "menu_swapper",
    icon: ({ label }: { label: string }) => (
        <svg
            className="rl-sidebar-icon-svg"
            viewBox="0 0 24 24"
            role="img"
            aria-label={label}
            aria-hidden="true"
        >
            <path d="M4 7h12M13 4l3 3-3 3" />
            <path d="M20 17H8M11 14l-3 3 3 3" />
        </svg>
    ),
});
