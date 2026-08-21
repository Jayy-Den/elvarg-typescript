import type { ClientSidebarPluginDefinition } from "../../sidebar/pluginTypes";

export const EDIT_MODE_SIDEBAR_PLUGIN: ClientSidebarPluginDefinition = Object.freeze({
    id: "edit_mode",
    title: "Edit Mode",
    tooltip: "Edit Mode (dev)",
    priority: 200,
    panelId: "edit_mode",
    icon: ({ label }: { label: string }) => (
        <svg
            className="rl-sidebar-icon-svg"
            viewBox="0 0 24 24"
            role="img"
            aria-label={label}
            aria-hidden="true"
        >
            <path d="M4 16.5 15.2 5.3l3.5 3.5L7.5 20H4z" />
            <path d="M13.4 7.1 16.9 10.6" />
        </svg>
    ),
});
