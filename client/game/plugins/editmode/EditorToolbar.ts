/**
 * Ported from the elvarg-web-client map editor so the editor keeps its own
 * chrome: a fixed icon rail, dark panel, blue active state. Plain DOM, no React
 * or leva, which is also what keeps it out of the player-facing UI.
 */

export interface EditorTool {
    id: string;
    label: string;
    icon: () => SVGElement;
    action?: () => void;
}

export class EditorToolbar {
    private readonly element: HTMLDivElement;
    private readonly buttons = new Map<string, HTMLButtonElement>();
    private activeToolId: string;

    public constructor(tools: EditorTool[], initialToolId: string, onToolChange: (toolId: string) => void) {
        this.activeToolId = initialToolId;
        this.element = document.createElement("div");
        this.element.dataset.mapEditor = "toolbar";
        this.element.setAttribute("role", "toolbar");
        this.element.setAttribute("aria-label", "Map editor tools");

        Object.assign(this.element.style, {
            position: "fixed",
            left: "12px",
            top: "12px",
            zIndex: "10001",
            display: "flex",
            flexDirection: "column",
            gap: "4px",
            padding: "5px",
            border: "1px solid rgba(255, 255, 255, 0.14)",
            borderRadius: "6px",
            background: "rgba(31, 34, 39, 0.96)",
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.35)",
        });

        for (const tool of tools) {
            const button = document.createElement("button");
            button.type = "button";
            button.title = tool.label;
            button.setAttribute("aria-label", tool.label);
            button.appendChild(tool.icon());
            Object.assign(button.style, {
                width: "34px",
                height: "34px",
                display: "grid",
                placeItems: "center",
                padding: "0",
                border: "1px solid transparent",
                borderRadius: "4px",
                color: "#d9dde5",
                background: "transparent",
                cursor: "pointer",
            });
            button.addEventListener("mousedown", (event) => {
                event.preventDefault();
                event.stopPropagation();
            });
            button.addEventListener("click", (event) => {
                event.stopPropagation();
                if (tool.action) {
                    tool.action();
                    return;
                }
                this.select(tool.id);
                onToolChange(tool.id);
            });
            this.buttons.set(tool.id, button);
            this.element.appendChild(button);
        }

        document.body.appendChild(this.element);
        this.renderActiveTool();
    }

    public select(toolId: string) {
        if (!this.buttons.has(toolId)) {
            return;
        }
        this.activeToolId = toolId;
        this.renderActiveTool();
    }

    public setDisabled(toolId: string, disabled: boolean) {
        const button = this.buttons.get(toolId);
        if (!button) return;
        button.disabled = disabled;
        button.style.cursor = disabled ? "wait" : "pointer";
        button.style.opacity = disabled ? "0.5" : "1";
    }

    public remove() {
        this.element.remove();
        this.buttons.clear();
    }

    private renderActiveTool() {
        this.buttons.forEach((button, toolId) => {
            const active = toolId === this.activeToolId;
            button.setAttribute("aria-pressed", String(active));
            button.style.color = active ? "#ffffff" : "#d9dde5";
            button.style.background = active ? "#3b82f6" : "transparent";
            button.style.borderColor = active ? "#70a5ff" : "transparent";
        });
    }
}

export const createPointerIcon = (): SVGElement => {
    const namespace = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(namespace, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "19");
    svg.setAttribute("height", "19");
    svg.setAttribute("aria-hidden", "true");

    const path = document.createElementNS(namespace, "path");
    path.setAttribute("d", "M5 3.8v14.7l4.1-3.8 2.7 5.5 2.3-1.1-2.7-5.4h5.6L5 3.8Z");
    path.setAttribute("fill", "currentColor");
    path.setAttribute("stroke", "#15171a");
    path.setAttribute("stroke-width", "1.15");
    path.setAttribute("stroke-linejoin", "round");
    svg.appendChild(path);

    return svg;
};

const createActionIcon = (pathData: string, fill = "none"): SVGElement => {
    const namespace = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(namespace, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "17");
    svg.setAttribute("height", "17");
    svg.setAttribute("aria-hidden", "true");

    const path = document.createElementNS(namespace, "path");
    path.setAttribute("d", pathData);
    path.setAttribute("fill", fill);
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.9");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.appendChild(path);
    return svg;
};

export const createSearchIcon = (): SVGElement => createActionIcon("M11 5a6 6 0 1 0 0 12 6 6 0 0 0 0-12Zm4.5 10.5L20 20");

export const createPlayIcon = (): SVGElement => createActionIcon("M8 5.5v13l11-6.5-11-6.5Z", "currentColor");

export const createConfigIcon = (): SVGElement =>
    createActionIcon(
        "M12 8.7a3.3 3.3 0 1 0 0 6.6 3.3 3.3 0 0 0 0-6.6Zm8 3.3-2-.7a6.2 6.2 0 0 0-.5-1.2l.9-1.9-1.7-1.7-1.9.9a6.2 6.2 0 0 0-1.2-.5L13 5h-2l-.6 1.9a6.2 6.2 0 0 0-1.2.5l-1.9-.9-1.7 1.7.9 1.9a6.2 6.2 0 0 0-.5 1.2l-2 .7v2.4l2 .7a6.2 6.2 0 0 0 .5 1.2l-.9 1.9 1.7 1.7 1.9-.9a6.2 6.2 0 0 0 1.2.5L11 21h2l.6-1.9a6.2 6.2 0 0 0 1.2-.5l1.9.9 1.7-1.7-.9-1.9a6.2 6.2 0 0 0 .5-1.2l2-.7v-2.4Z",
    );

export const createCloseIcon = (): SVGElement => createActionIcon("M6 6l12 12M18 6 6 18");

export const createInterfacesIcon = (): SVGElement => createActionIcon("M4 5h16v14H4V5Zm0 4h16M9 9v10");

export const createWorldMapIcon = (): SVGElement =>
    createActionIcon(
        "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 0c2.3 2.4 3.5 5.4 3.5 9S14.3 18.6 12 21m0-18C9.7 5.4 8.5 8.4 8.5 12s1.2 6.6 3.5 9M3.5 9h17m-17 6h17",
    );

export const createShopIcon = (): SVGElement =>
    createActionIcon("M5 10v10h14V10M4 10h16l-2-6H6l-2 6Zm5 10v-6h6v6M7 10v2m5-2v2m5-2v2");

export const createExportIcon = (): SVGElement => createActionIcon("M12 3v12m0 0 4-4m-4 4-4-4M5 15v4h14v-4");

export const createRotateIcon = (): SVGElement =>
    createActionIcon("M20 11a8 8 0 0 0-14.8-4L3 9m0 0V4m0 5h5M4 13a8 8 0 0 0 14.8 4L21 15m0 0v5m0-5h-5");

export const createDuplicateIcon = (): SVGElement =>
    createActionIcon("M8 8h11v11H8zM5 16H4V4h12v1", "none");

export const createLayersIcon = (): SVGElement =>
    createActionIcon("M4 7l8-4 8 4-8 4-8-4Zm0 5 8 4 8-4M4 17l8 4 8-4");

export const createPathIcon = (): SVGElement => createActionIcon("M5 19c2.5-6 5-9 9-9 2.2 0 3.8-1.7 5-5M5 19h5m-5 0v-5M19 5h-5m5 0v5");

export const createTrashIcon = (): SVGElement => createActionIcon("M5 7h14M10 11v6m4-6v6M9 7V4h6v3m-9 0 1 14h10l1-14", "none");
