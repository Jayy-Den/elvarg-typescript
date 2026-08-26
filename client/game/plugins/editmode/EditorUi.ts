import FileSaver from "file-saver";
import type { EditModePlugin } from "./EditModePlugin";
import { EditorPalette, type PaletteMode } from "./EditorPalette";
import {
    EditorToolbar,
    createCloseIcon,
    createDuplicateIcon,
    createExportIcon,
    createInterfacesIcon,
    createLayersIcon,
    createPathIcon,
    createPlayIcon,
    createPointerIcon,
    createRotateIcon,
    createSearchIcon,
    createShopIcon,
    createTrashIcon,
    createWorldMapIcon,
} from "./EditorToolbar";
import type {
    EditModeDefinitionSummary,
    EditModeSearchKind,
    EditModeShop,
    EditModeWidgetSummary,
} from "./types";

const PANEL_STYLE: Partial<CSSStyleDeclaration> = {
    position: "fixed",
    zIndex: "10002",
    boxSizing: "border-box",
    padding: "10px",
    border: "1px solid rgba(255,255,255,0.16)",
    borderRadius: "6px",
    color: "#eef4ff",
    background: "rgba(18,20,24,0.97)",
    boxShadow: "0 12px 32px rgba(0,0,0,0.42)",
    font: "13px/1.4 sans-serif",
};

const INPUT_STYLE: Partial<CSSStyleDeclaration> = {
    boxSizing: "border-box",
    width: "100%",
    height: "34px",
    padding: "6px 9px",
    border: "1px solid rgba(255,255,255,0.2)",
    borderRadius: "4px",
    outline: "none",
    color: "#fff",
    background: "#111318",
    font: "13px sans-serif",
};

function stopClientInput(element: HTMLElement): void {
    for (const eventName of ["mousedown", "click", "keydown", "keyup"] as const) {
        element.addEventListener(eventName, (event) => event.stopPropagation());
    }
}

function createPanel(name: string, width = "360px"): HTMLDivElement {
    const panel = document.createElement("div");
    panel.dataset.mapEditor = name;
    Object.assign(panel.style, PANEL_STYLE, { left: "62px", top: "112px", width });
    stopClientInput(panel);
    document.body.appendChild(panel);
    return panel;
}

function createHeader(titleText: string, onClose: () => void): HTMLDivElement {
    const header = document.createElement("div");
    Object.assign(header.style, {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: "8px",
    });
    const title = document.createElement("strong");
    title.textContent = titleText;
    const close = document.createElement("button");
    close.type = "button";
    close.title = `Close ${titleText.toLowerCase()}`;
    close.setAttribute("aria-label", close.title);
    close.appendChild(createCloseIcon());
    Object.assign(close.style, {
        width: "24px",
        height: "24px",
        display: "grid",
        placeItems: "center",
        padding: "0",
        border: "0",
        color: "#aeb8c8",
        background: "transparent",
        cursor: "pointer",
    });
    close.addEventListener("click", onClose);
    header.append(title, close);
    return header;
}

function createActionButton(
    title: string,
    icon: () => SVGElement,
    action: () => void,
): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.title = title;
    button.setAttribute("aria-label", title);
    button.appendChild(icon());
    Object.assign(button.style, {
        width: "30px",
        height: "30px",
        display: "grid",
        placeItems: "center",
        padding: "0",
        border: "1px solid rgba(255,255,255,0.16)",
        borderRadius: "4px",
        color: "#cbd5e1",
        background: "rgba(255,255,255,0.06)",
        cursor: "pointer",
    });
    button.addEventListener("click", action);
    return button;
}

function createResultButton(text: string, action: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = text;
    Object.assign(button.style, {
        width: "100%",
        minHeight: "34px",
        padding: "7px 8px",
        border: "1px solid transparent",
        borderRadius: "4px",
        color: "#e5e7eb",
        background: "transparent",
        cursor: "pointer",
        font: "13px sans-serif",
        textAlign: "left",
    });
    button.addEventListener("mouseenter", () => {
        button.style.background = "rgba(59,130,246,0.22)";
        button.style.borderColor = "rgba(96,165,250,0.35)";
    });
    button.addEventListener("mouseleave", () => {
        button.style.background = "transparent";
        button.style.borderColor = "transparent";
    });
    button.addEventListener("click", action);
    return button;
}

class EditorChrome {
    private readonly toolbar: EditorToolbar;
    private readonly palette: EditorPalette;
    private readonly overlay: HTMLDivElement;
    private readonly selectionDetails: HTMLDivElement;
    private readonly bottomBar: HTMLDivElement;
    private readonly heightInput: HTMLInputElement;
    private readonly renderAllInput: HTMLInputElement;
    private readonly mapIconsInput: HTMLInputElement;
    private readonly pvpZonesInput: HTMLInputElement;
    private readonly multiCombatZonesInput: HTMLInputElement;
    private readonly unsubscribe: () => void;
    private readonly canvasShell?: HTMLElement;
    private readonly previousCanvasBottom: string;
    private auxiliaryPanel?: HTMLElement;
    private detailPanel?: HTMLElement;
    private shops?: EditModeShop[];
    private lastVersion = -1;

    constructor(private readonly plugin: EditModePlugin) {
        this.palette = new EditorPalette({
            onModeChange: (mode) => this.search(mode),
            onQueryChange: (query) => this.plugin.searchCache(query, this.currentSearchMode()),
            onPick: (id) => this.pickSearchResult(id),
            onInspect: (id) => this.showDefinition(this.currentSearchMode(), id),
        });

        this.toolbar = new EditorToolbar(
            [
                { id: "select", label: "Pointer · Select objects", icon: createPointerIcon },
                {
                    id: "cache-search",
                    label: "Search cache",
                    icon: createSearchIcon,
                    action: () => this.togglePalette(),
                },
                { id: "path", label: "Draw path", icon: createPathIcon },
                {
                    id: "shops",
                    label: "Browse shops",
                    icon: createShopIcon,
                    action: () => void this.toggleShops(),
                },
                {
                    id: "interfaces",
                    label: "Browse interfaces",
                    icon: createInterfacesIcon,
                    action: () => this.toggleInterfaces(),
                },
                {
                    id: "world-map",
                    label: "Open world map",
                    icon: createWorldMapIcon,
                    action: () => this.toggleWorldMap(),
                },
                {
                    id: "export-region",
                    label: "Export active region (.pack)",
                    icon: createExportIcon,
                    action: () => this.exportRegion(),
                },
                {
                    id: "play",
                    label: "Play game",
                    icon: createPlayIcon,
                    action: () => this.plugin.setConfig({ active: false }),
                },
            ],
            "select",
            (toolId) => this.plugin.setConfig({ tool: toolId === "path" ? "path" : "select" }),
        );

        this.overlay = document.createElement("div");
        this.overlay.dataset.mapEditor = "controls";
        Object.assign(this.overlay.style, {
            position: "fixed",
            left: "62px",
            top: "12px",
            zIndex: "10000",
            padding: "10px 12px",
            borderRadius: "4px",
            color: "#fff",
            background: "rgba(18,20,24,0.86)",
            font: "13px/1.45 sans-serif",
            pointerEvents: "none",
            whiteSpace: "pre-line",
        });
        document.body.appendChild(this.overlay);

        this.selectionDetails = document.createElement("div");
        this.selectionDetails.dataset.mapEditor = "selection-details";
        Object.assign(this.selectionDetails.style, PANEL_STYLE, {
            right: "12px",
            top: "12px",
            left: "auto",
            width: "270px",
            display: "none",
            borderColor: "rgba(96,165,250,0.5)",
            background: "rgba(18,20,24,0.9)",
        });
        stopClientInput(this.selectionDetails);
        document.body.appendChild(this.selectionDetails);

        this.bottomBar = document.createElement("div");
        this.bottomBar.dataset.mapEditor = "bottom-bar";
        Object.assign(this.bottomBar.style, {
            position: "absolute",
            left: "0",
            right: "0",
            bottom: "0",
            height: "38px",
            zIndex: "10001",
            boxSizing: "border-box",
            display: "flex",
            alignItems: "center",
            gap: "7px",
            padding: "5px 12px",
            borderTop: "1px solid rgba(255,255,255,0.16)",
            color: "#eef4ff",
            background: "#121418",
            font: "13px sans-serif",
        });
        stopClientInput(this.bottomBar);

        const heightLabel = document.createElement("span");
        heightLabel.textContent = "HL:";
        heightLabel.title = "Height/Level";
        const decrement = this.createHeightButton("−", -1);
        this.heightInput = document.createElement("input");
        this.heightInput.type = "number";
        this.heightInput.min = "0";
        this.heightInput.max = "3";
        this.heightInput.step = "1";
        this.heightInput.title = "Height/Level";
        this.heightInput.setAttribute("aria-label", "Height/Level");
        Object.assign(this.heightInput.style, INPUT_STYLE, {
            width: "48px",
            height: "28px",
            padding: "3px 5px",
            textAlign: "center",
        });
        this.heightInput.addEventListener("change", () =>
            this.setHeightLevel(Number(this.heightInput.value)),
        );
        const increment = this.createHeightButton("+", 1);
        const renderAllLabel = document.createElement("label");
        Object.assign(renderAllLabel.style, {
            display: "flex",
            alignItems: "center",
            gap: "6px",
            marginLeft: "8px",
            cursor: "pointer",
        });
        renderAllLabel.append("Render all HL:");
        this.renderAllInput = document.createElement("input");
        this.renderAllInput.type = "checkbox";
        this.renderAllInput.addEventListener("change", () =>
            this.plugin.setConfig({ renderAllHeightLevels: this.renderAllInput.checked }),
        );
        renderAllLabel.appendChild(this.renderAllInput);
        const mapIconsLabel = document.createElement("label");
        Object.assign(mapIconsLabel.style, {
            display: "flex",
            alignItems: "center",
            gap: "6px",
            marginLeft: "8px",
            cursor: "pointer",
        });
        mapIconsLabel.append("Icons:");
        this.mapIconsInput = document.createElement("input");
        this.mapIconsInput.type = "checkbox";
        this.mapIconsInput.addEventListener("change", () =>
            this.plugin.setConfig({ showMapIcons: this.mapIconsInput.checked }),
        );
        mapIconsLabel.appendChild(this.mapIconsInput);
        const zoneToggle = (
            text: string,
            color: string,
            change: (checked: boolean) => void,
        ): { label: HTMLLabelElement; input: HTMLInputElement } => {
            const label = document.createElement("label");
            Object.assign(label.style, {
                display: "flex",
                alignItems: "center",
                gap: "5px",
                marginLeft: "8px",
                color,
                cursor: "pointer",
            });
            label.append(`${text}:`);
            const input = document.createElement("input");
            input.type = "checkbox";
            input.setAttribute("aria-label", `Show ${text} zones`);
            input.addEventListener("change", () => change(input.checked));
            label.appendChild(input);
            return { label, input };
        };
        const pvpZones = zoneToggle("PvP", "#fca5a5", (checked) =>
            this.plugin.setConfig({ showPvpZones: checked }),
        );
        this.pvpZonesInput = pvpZones.input;
        const multiCombatZones = zoneToggle("Multi", "#fcd34d", (checked) =>
            this.plugin.setConfig({ showMultiCombatZones: checked }),
        );
        this.multiCombatZonesInput = multiCombatZones.input;
        this.bottomBar.append(
            heightLabel,
            decrement,
            this.heightInput,
            increment,
            renderAllLabel,
            mapIconsLabel,
            pvpZones.label,
            multiCombatZones.label,
        );

        const viewport = document.querySelector<HTMLElement>(".game-viewport");
        this.canvasShell =
            viewport?.querySelector<HTMLElement>(".game-canvas-shell") ?? undefined;
        this.previousCanvasBottom = this.canvasShell?.style.bottom ?? "";
        if (viewport && this.canvasShell) {
            this.canvasShell.style.bottom = this.bottomBar.style.height;
            viewport.appendChild(this.bottomBar);
            requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
        }

        this.sync();
        this.unsubscribe = plugin.subscribe(() => this.sync());
    }

    remove(): void {
        this.unsubscribe();
        this.toolbar.remove();
        this.palette.remove();
        this.overlay.remove();
        this.selectionDetails.remove();
        this.bottomBar.remove();
        if (this.canvasShell) this.canvasShell.style.bottom = this.previousCanvasBottom;
        requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
        this.auxiliaryPanel?.remove();
        this.detailPanel?.remove();
    }

    private currentSearchMode(): EditModeSearchKind {
        return this.plugin.getState().search.kind;
    }

    private createHeightButton(text: string, delta: number): HTMLButtonElement {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = text;
        button.title = "Height/Level";
        button.setAttribute("aria-label", `${delta < 0 ? "Decrease" : "Increase"} Height/Level`);
        Object.assign(button.style, {
            width: "28px",
            height: "28px",
            padding: "0",
            border: "1px solid rgba(255,255,255,0.2)",
            borderRadius: "4px",
            color: "#fff",
            background: "rgba(255,255,255,0.07)",
            cursor: "pointer",
        });
        button.addEventListener("click", () =>
            this.setHeightLevel(this.plugin.getConfig().heightLevel + delta),
        );
        return button;
    }

    private setHeightLevel(level: number): void {
        this.plugin.setConfig({ heightLevel: Math.max(0, Math.min(3, level | 0)) });
    }

    private search(mode: PaletteMode): void {
        if (mode !== "item") this.plugin.setConfig({ placeKind: mode });
        this.plugin.searchCache(this.plugin.getState().search.query, mode);
    }

    private pickSearchResult(id: number): void {
        const mode = this.currentSearchMode();
        if (mode === "item") {
            this.showDefinition(mode, id);
            return;
        }
        this.plugin.setConfig({ placeKind: mode });
        this.plugin.useSearchResult(id);
        this.plugin.setConfig({ tool: "place" });
        this.toolbar.select("cache-search");
        this.palette.setVisible(false);
    }

    private togglePalette(): void {
        this.closeAuxiliaryPanel();
        this.palette.toggle();
    }

    private sync(): void {
        const state = this.plugin.getState();
        this.heightInput.value = String(state.config.heightLevel);
        this.renderAllInput.checked = state.config.renderAllHeightLevels;
        this.mapIconsInput.checked = state.config.showMapIcons;
        this.pvpZonesInput.checked = state.config.showPvpZones;
        this.multiCombatZonesInput.checked = state.config.showMultiCombatZones;
        this.toolbar.select(
            state.config.tool === "place"
                ? "cache-search"
                  : state.config.tool === "path"
                  ? "path"
                  : "select",
        );
        this.palette.setMode(state.search.kind);
        this.palette.setSelectedId(
            state.search.kind === "npc" ? state.config.npcId : state.config.locId,
        );
        if (state.version !== this.lastVersion) {
            this.lastVersion = state.version;
            this.palette.renderResults(state.search.results, state.search.loading);
        }

        const tile = state.selection ?? this.plugin.getCameraTile();
        const location = tile ? `${tile.tileX}, ${tile.tileY}, ${tile.plane}` : "unknown";
        const worldStatus = state.world.loading
            ? "zones loading"
            : state.world.error
              ? "zones unavailable"
              : `${state.world.definition?.zones.length ?? 0} zones`;
        const help =
            state.config.tool === "place"
                ? `Place ${state.config.placeKind === "npc" ? "NPC" : "object"}: click terrain · R: rotate`
                : state.config.tool === "path"
                  ? state.pathStart
                      ? "Path: move to preview · click to place · Esc: cancel"
                      : "Path: click to start"
                  : "Pointer: click object to select · Shift+click: select building";
        this.overlay.textContent =
            `Edit Mode · Scene window loaded\n` +
            `World ${location} · ${state.config.edits.length} stored edits · ${worldStatus}\n` +
            `${help} · Right/middle drag: rotate\nWheel: zoom · WASD: move · Shift: faster`;
        this.renderSelection();
    }

    private renderSelection(): void {
        const selection = this.plugin.getState().selection;
        if (!selection) {
            this.selectionDetails.style.display = "none";
            return;
        }
        this.selectionDetails.replaceChildren();
        if (selection.kind === "building") {
            const title = document.createElement("div");
            title.textContent = "Building";
            const location = document.createElement("div");
            location.textContent =
                `World ${selection.tileX}, ${selection.tileY} → ${selection.tileEndX}, ${selection.tileEndY}` +
                ` · planes ${selection.plane}–${selection.planeEnd ?? selection.plane}`;
            const dimensions = document.createElement("div");
            dimensions.textContent =
                `${selection.buildingShape ?? "Building"} · ${selection.buildingWidth} × ${selection.buildingDepth} tiles` +
                ` · ${selection.buildingFloors} floor${selection.buildingFloors === 1 ? "" : "s"}` +
                ` · ${selection.buildingTileCount} selected tiles`;
            const objects = document.createElement("div");
            objects.textContent =
                `${selection.buildingObjectCount} objects` +
                ` · ${selection.buildingWallCount} walls/corners` +
                ` · ${selection.buildingDoorCount} doors` +
                ` · ${selection.buildingRoofCount} roof pieces` +
                ` · ${selection.buildingDecorationCount} wall decorations` +
                ` · ${selection.buildingOtherCount} other`;
            const wall = document.createElement("div");
            wall.textContent =
                selection.buildingWallId === undefined
                    ? "Wall type: mixed/unknown"
                    : `Primary wall ID ${selection.buildingWallId}`;
            this.selectionDetails.append(title, location, dimensions, objects, wall);
            this.selectionDetails.style.display = "block";
            return;
        }
        const title = document.createElement("div");
        const hasTileRange =
            selection.tileEndX !== undefined &&
            selection.tileEndY !== undefined &&
            (selection.tileEndX !== selection.tileX || selection.tileEndY !== selection.tileY);
        title.textContent =
            selection.locId >= 0
                ? `${selection.locName || (selection.kind === "npc" ? "Unknown NPC" : "Unknown object")} · ${selection.kind === "npc" ? "NPC" : "ID"} ${selection.locId}`
                : hasTileRange
                  ? "Ground tiles"
                  : "Ground tile";
        const location = document.createElement("div");
        location.textContent =
            !hasTileRange
                ? `World ${selection.tileX}, ${selection.tileY}, ${selection.plane}`
                : `World ${selection.tileX}, ${selection.tileY} → ${selection.tileEndX}, ${selection.tileEndY}, ${selection.plane}`;
        const rotation = document.createElement("div");
        rotation.textContent =
            selection.kind === "loc" && selection.rotation !== undefined
                ? `Object rotation ${selection.rotation}`
                : `Placement rotation ${this.plugin.getConfig().rotation}`;
        const divider = document.createElement("div");
        Object.assign(divider.style, {
            height: "1px",
            margin: "8px 0",
            background: "rgba(255,255,255,0.1)",
        });
        const actions = document.createElement("div");
        Object.assign(actions.style, { display: "flex", gap: "5px" });
        actions.append(
            createActionButton("Paint configured overlay", createLayersIcon, () =>
                this.plugin.paintSelection(),
            ),
            createActionButton("Rotate object", createRotateIcon, () => this.plugin.rotateSelection()),
            createActionButton("Duplicate object", createDuplicateIcon, () =>
                this.plugin.duplicateSelection(),
            ),
            createActionButton("Delete object", createTrashIcon, () =>
                this.plugin.deleteSelection(),
            ),
        );
        const overlayRow = document.createElement("label");
        Object.assign(overlayRow.style, {
            display: "flex",
            alignItems: "center",
            gap: "8px",
            marginTop: "8px",
        });
        overlayRow.textContent = "Overlay";
        const input = document.createElement("input");
        input.type = "number";
        input.min = "0";
        input.value = String(this.plugin.getConfig().overlayId);
        Object.assign(input.style, INPUT_STYLE, { width: "76px", marginLeft: "auto" });
        input.addEventListener("change", () =>
            this.plugin.setConfig({ overlayId: Number(input.value) | 0 }),
        );
        overlayRow.appendChild(input);
        this.selectionDetails.append(title, location, rotation, divider, actions, overlayRow);
        this.selectionDetails.style.display = "block";
    }

    private showDefinition(kind: EditModeSearchKind, id: number): void {
        const definition = this.plugin.describeDefinition(kind, id);
        if (!definition) return;
        this.detailPanel?.remove();
        const kindTitle = kind === "npc" ? "NPC" : kind === "loc" ? "Object" : "Item";
        const panel = createPanel("definition-panel", "320px");
        this.detailPanel = panel;
        Object.assign(panel.style, {
            right: "12px",
            top: "12px",
            left: "auto",
            maxHeight: "calc(100vh - 24px)",
            overflowY: "auto",
            zIndex: "10004",
        });
        panel.appendChild(
            createHeader(`${kindTitle} ${id} · ${definition.name}`, () => this.closeDetailPanel()),
        );
        this.appendDefinitionFields(panel, definition);
    }

    private appendDefinitionFields(
        panel: HTMLElement,
        definition: EditModeDefinitionSummary,
    ): void {
        for (const [label, value] of definition.fields) {
            const row = document.createElement("div");
            Object.assign(row.style, {
                display: "grid",
                gridTemplateColumns: "112px 1fr",
                gap: "8px",
                padding: "4px 0",
                borderTop: "1px solid rgba(255,255,255,0.06)",
                fontSize: "12px",
            });
            const key = document.createElement("span");
            key.textContent = label;
            key.style.color = "#94a3b8";
            const val = document.createElement("span");
            val.textContent = value;
            val.style.wordBreak = "break-word";
            row.append(key, val);
            panel.appendChild(row);
        }
    }

    private toggleInterfaces(): void {
        if (this.auxiliaryPanel?.dataset.mapEditor === "interface-browser") {
            this.closeAuxiliaryPanel();
            return;
        }
        this.palette.setVisible(false);
        this.closeAuxiliaryPanel();
        this.plugin.refreshInterfaces();
        const panel = createPanel("interface-browser");
        this.auxiliaryPanel = panel;
        panel.appendChild(createHeader("Interfaces", () => this.closeAuxiliaryPanel()));
        const input = document.createElement("input");
        input.type = "search";
        input.placeholder = "Search interface text or ID";
        input.setAttribute("aria-label", "Search interface cache");
        Object.assign(input.style, INPUT_STYLE);
        const results = document.createElement("div");
        Object.assign(results.style, {
            maxHeight: "390px",
            marginTop: "8px",
            overflowY: "auto",
        });
        const render = () => {
            const query = input.value.trim().toLowerCase();
            results.replaceChildren();
            for (const groupId of this.plugin
                .getState()
                .interfaces.groups.filter((group) => !query || String(group).includes(query))) {
                results.appendChild(
                    createResultButton(`Interface ${groupId}`, () => {
                        this.plugin.selectInterface(groupId);
                        this.showInterfaceViewer(
                            groupId,
                            this.plugin.getState().interfaces.widgets,
                        );
                    }),
                );
            }
        };
        input.addEventListener("input", render);
        panel.append(input, results);
        render();
        input.focus();
    }

    private showInterfaceViewer(groupId: number, widgets: EditModeWidgetSummary[]): void {
        this.detailPanel?.remove();
        const panel = createPanel("interface-viewer", "min(720px, calc(100vw - 32px))");
        this.detailPanel = panel;
        Object.assign(panel.style, {
            left: "50%",
            top: "50%",
            transform: "translate(-50%,-50%)",
            zIndex: "10005",
            maxHeight: "calc(100vh - 32px)",
            overflowY: "auto",
        });
        panel.appendChild(createHeader(`Interface ${groupId}`, () => this.closeDetailPanel()));
        const metadata = document.createElement("div");
        metadata.textContent = `${widgets.length} decoded widgets`;
        Object.assign(metadata.style, { marginBottom: "8px", color: "#94a3b8" });
        const open = document.createElement("button");
        open.type = "button";
        open.textContent = "Open in client";
        Object.assign(open.style, INPUT_STYLE, {
            width: "auto",
            marginBottom: "8px",
            cursor: "pointer",
        });
        open.addEventListener("click", () => this.plugin.openInterface(groupId));
        const table = document.createElement("div");
        Object.assign(table.style, { font: "11px/1.5 ui-monospace, monospace" });
        for (const widget of widgets) {
            const row = document.createElement("div");
            row.textContent = `${widget.fileId} · type ${widget.type} · ${widget.x},${widget.y} · ${widget.width}×${widget.height}${widget.text ? ` · ${widget.text.replace(/<[^>]+>/g, " ")}` : ""}`;
            Object.assign(row.style, {
                padding: "3px 0",
                borderTop: "1px solid rgba(255,255,255,0.06)",
            });
            table.appendChild(row);
        }
        panel.append(metadata, open, table);
    }

    private async toggleShops(): Promise<void> {
        if (this.auxiliaryPanel?.dataset.mapEditor === "shop-browser") {
            this.closeAuxiliaryPanel();
            return;
        }
        this.palette.setVisible(false);
        this.closeAuxiliaryPanel();
        const panel = createPanel("shop-browser");
        this.auxiliaryPanel = panel;
        panel.appendChild(createHeader("Shops", () => this.closeAuxiliaryPanel()));
        const input = document.createElement("input");
        input.type = "search";
        input.placeholder = "Search shop name or ID";
        input.setAttribute("aria-label", "Search shops");
        Object.assign(input.style, INPUT_STYLE);
        const results = document.createElement("div");
        Object.assign(results.style, {
            maxHeight: "390px",
            marginTop: "8px",
            overflowY: "auto",
        });
        panel.append(input, results);
        const render = () => {
            const query = input.value.trim().toLowerCase();
            results.replaceChildren();
            if (!this.shops) {
                results.textContent = "Loading shop definitions…";
                return;
            }
            const matches = this.shops.filter(
                (shop) =>
                    !query ||
                    String(shop.id).startsWith(query) ||
                    shop.name.toLowerCase().includes(query),
            );
            for (const shop of matches) {
                results.appendChild(
                    createResultButton(
                        `${shop.id} · ${shop.name} · ${shop.originalStock.length} items`,
                        () => this.showShop(shop),
                    ),
                );
            }
            if (!matches.length) results.textContent = "No matching shops.";
        };
        input.addEventListener("input", render);
        render();
        try {
            this.shops ??= await this.plugin.listShops();
        } catch {
            if (this.auxiliaryPanel === panel) {
                results.textContent =
                    "Shop definitions are unavailable. Start the development API on port 49600.";
            }
            return;
        }
        if (this.auxiliaryPanel === panel) render();
        input.focus();
    }

    private showShop(shop: EditModeShop): void {
        this.detailPanel?.remove();
        const panel = createPanel("shop-editor", "440px");
        this.detailPanel = panel;
        Object.assign(panel.style, {
            right: "12px",
            top: "12px",
            left: "auto",
            zIndex: "10005",
            maxHeight: "calc(100vh - 24px)",
            overflowY: "auto",
        });
        panel.appendChild(createHeader(`${shop.name} · ${shop.id}`, () => this.closeDetailPanel()));
        const metadata = document.createElement("div");
        metadata.textContent = `Currency: ${shop.currency || "COINS"}`;
        Object.assign(metadata.style, { marginBottom: "8px", color: "#94a3b8" });
        panel.appendChild(metadata);
        for (const item of shop.originalStock) {
            const row = document.createElement("div");
            Object.assign(row.style, {
                display: "grid",
                gridTemplateColumns: "52px 1fr auto",
                gap: "8px",
                padding: "7px 4px",
                borderTop: "1px solid rgba(255,255,255,0.06)",
            });
            const id = document.createElement("span");
            id.textContent = String(item.id);
            id.style.color = "#93c5fd";
            const name = document.createElement("span");
            name.textContent = item.name || `Item ${item.id}`;
            const amount = document.createElement("span");
            amount.textContent = `× ${item.amount}`;
            amount.style.color = "#94a3b8";
            row.append(id, name, amount);
            panel.appendChild(row);
        }
    }

    private toggleWorldMap(): void {
        if (this.auxiliaryPanel?.dataset.mapEditor === "world-map") {
            this.closeAuxiliaryPanel();
            return;
        }
        this.palette.setVisible(false);
        this.closeAuxiliaryPanel();
        const tile = this.plugin.getCameraTile() ?? {
            tileX: 3222,
            tileY: 3218,
            plane: 0,
        };
        const panel = createPanel("world-map", "min(900px, calc(100vw - 32px))");
        this.auxiliaryPanel = panel;
        Object.assign(panel.style, {
            left: "50%",
            top: "50%",
            transform: "translate(-50%,-50%)",
            height: "min(720px, calc(100vh - 32px))",
            display: "flex",
            flexDirection: "column",
            zIndex: "10006",
        });
        panel.appendChild(createHeader("World map", () => this.closeAuxiliaryPanel()));
        const controls = document.createElement("form");
        Object.assign(controls.style, {
            display: "grid",
            gridTemplateColumns: "1fr 1fr 80px auto",
            gap: "6px",
            marginBottom: "8px",
        });
        const x = document.createElement("input");
        const y = document.createElement("input");
        const plane = document.createElement("input");
        for (const [input, value, label] of [
            [x, tile.tileX, "World X"],
            [y, tile.tileY, "World Y"],
            [plane, tile.plane, "Plane"],
        ] as const) {
            input.type = "number";
            input.value = String(value);
            input.placeholder = label;
            input.setAttribute("aria-label", label);
            Object.assign(input.style, INPUT_STYLE);
        }
        const jump = document.createElement("button");
        jump.type = "submit";
        jump.textContent = "Jump";
        Object.assign(jump.style, INPUT_STYLE, { width: "auto", cursor: "pointer" });
        controls.append(x, y, plane, jump);
        const canvas = document.createElement("canvas");
        canvas.width = 840;
        canvas.height = 620;
        Object.assign(canvas.style, {
            flex: "1",
            minHeight: "0",
            width: "100%",
            background: "#090b0f",
            cursor: "crosshair",
        });
        // ponytail: grid navigation replaces full cache-region rasterization; port WorldMapRenderer when visual terrain editing needs it.
        const draw = (centerX: number, centerY: number) => {
            const context = canvas.getContext("2d");
            if (!context) return;
            context.fillStyle = "#090b0f";
            context.fillRect(0, 0, canvas.width, canvas.height);
            context.strokeStyle = "rgba(148,163,184,0.28)";
            context.fillStyle = "#64748b";
            context.font = "11px monospace";
            const scale = 2;
            const minX = centerX - canvas.width / scale / 2;
            const maxY = centerY + canvas.height / scale / 2;
            for (
                let worldX = Math.floor(minX / 64) * 64;
                worldX < minX + canvas.width / scale;
                worldX += 64
            ) {
                const px = (worldX - minX) * scale;
                context.beginPath();
                context.moveTo(px, 0);
                context.lineTo(px, canvas.height);
                context.stroke();
                context.fillText(String(worldX >> 6), px + 4, 14);
            }
            for (
                let worldY = Math.floor((maxY - canvas.height / scale) / 64) * 64;
                worldY < maxY;
                worldY += 64
            ) {
                const py = (maxY - worldY) * scale;
                context.beginPath();
                context.moveTo(0, py);
                context.lineTo(canvas.width, py);
                context.stroke();
                context.fillText(String(worldY >> 6), 4, py - 4);
            }
            context.fillStyle = "#3b82f6";
            context.strokeStyle = "#fff";
            context.beginPath();
            context.arc(canvas.width / 2, canvas.height / 2, 6, 0, Math.PI * 2);
            context.fill();
            context.stroke();
            canvas.dataset.centerX = String(centerX);
            canvas.dataset.centerY = String(centerY);
        };
        controls.addEventListener("submit", (event) => {
            event.preventDefault();
            const nextX = Number(x.value) | 0;
            const nextY = Number(y.value) | 0;
            this.plugin.jumpToTile(nextX, nextY, Number(plane.value) | 0);
            draw(nextX, nextY);
        });
        canvas.addEventListener("click", (event) => {
            const bounds = canvas.getBoundingClientRect();
            const centerX = Number(canvas.dataset.centerX);
            const centerY = Number(canvas.dataset.centerY);
            const worldX = Math.round(
                centerX +
                    ((event.clientX - bounds.left) / bounds.width - 0.5) *
                        (canvas.width / 2),
            );
            const worldY = Math.round(
                centerY -
                    ((event.clientY - bounds.top) / bounds.height - 0.5) *
                        (canvas.height / 2),
            );
            x.value = String(worldX);
            y.value = String(worldY);
            this.plugin.jumpToTile(worldX, worldY, Number(plane.value) | 0);
            draw(worldX, worldY);
        });
        panel.append(controls, canvas);
        draw(tile.tileX, tile.tileY);
    }

    private exportRegion(): void {
        try {
            const exported = this.plugin.exportActiveRegionPack();
            if (!exported) throw new Error("Active region is not ready");
            const blob = new Blob([exported.data.slice().buffer], {
                type: "application/octet-stream",
            });
            FileSaver.saveAs(blob, `${exported.regionId}.pack`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error("[edit-mode] Region export failed", error);
            window.alert(`Region export failed: ${message}`);
        }
    }

    private closeAuxiliaryPanel(): void {
        this.auxiliaryPanel?.remove();
        this.auxiliaryPanel = undefined;
    }

    private closeDetailPanel(): void {
        this.detailPanel?.remove();
        this.detailPanel = undefined;
    }
}

/** Mounts the reference editor chrome and returns its complete teardown. */
export function mountEditorUi(plugin: EditModePlugin): () => void {
    const editor = new EditorChrome(plugin);
    return () => editor.remove();
}
