import {
    LOC_SHAPE_NORMAL,
    type EditModeEdit,
    type EditModeHost,
    type EditModePluginConfig,
    type EditModePluginPersistence,
    type EditModePluginState,
    type EditModeSelection,
    type EditModeTool,
} from "./types";

type EditModePluginListener = () => void;

const DEFAULT_CONFIG: EditModePluginConfig = Object.freeze({
    enabled: false,
    active: false,
    tool: "select" as EditModeTool,
    locId: 0,
    shape: LOC_SHAPE_NORMAL,
    rotation: 0,
    edits: [] as EditModeEdit[],
});

const TOOLS: ReadonlySet<string> = new Set<EditModeTool>(["select", "place", "delete"]);

function toInt(value: unknown, fallback: number, min: number, max: number): number {
    const numeric = Math.floor(Number(value));
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(min, Math.min(max, numeric));
}

export class EditModePlugin {
    private readonly listeners = new Set<EditModePluginListener>();
    private readonly persistence?: EditModePluginPersistence;
    private host?: EditModeHost;
    private capturing = false;
    private config: EditModePluginConfig;
    private state: EditModePluginState;
    private selection?: EditModeSelection;
    private version = 0;

    constructor(persistence?: EditModePluginPersistence) {
        this.persistence = persistence;
        this.config = this.sanitizeConfig(persistence?.load());
        this.state = { config: this.config, version: this.version };
    }

    subscribe(listener: EditModePluginListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    getState(): EditModePluginState {
        return this.state;
    }

    getConfig(): EditModePluginConfig {
        return this.state.config;
    }

    attach(host: EditModeHost): void {
        this.host = host;
        this.syncListeners();
    }

    setConfig(nextConfig: Partial<EditModePluginConfig>): void {
        this.config = this.sanitizeConfig({ ...this.config, ...nextConfig });
        this.syncListeners();
        this.commit();
    }

    /** Cache name for a loc id, "" when the cache is not loaded yet. */
    getLocName(locId: number): string {
        try {
            return this.host?.getLocName(locId) ?? "";
        } catch {
            return "";
        }
    }

    rotate(): void {
        this.setConfig({ rotation: (this.config.rotation + 1) & 0x3 });
    }

    /** Re-applies every stored edit to the scene, e.g. after a login or map reload. */
    reapply(): void {
        for (const edit of this.config.edits) {
            this.dispatch(edit);
        }
    }

    /**
     * Reverts the most recent placement. Deletes are not revertible - the loc
     * suppression lives in the renderer's override map until the page reloads.
     * ponytail: undo covers places only, wire a real override-clear if deletes need undo.
     */
    undo(): boolean {
        const edits = this.config.edits;
        const index = edits.map((edit) => edit.kind).lastIndexOf("place");
        if (index === -1) return false;
        const edit = edits[index];
        this.host?.onLocDel(
            { x: edit.tileX, y: edit.tileY },
            edit.plane,
            edit.shape,
            edit.rotation,
        );
        this.setConfig({ edits: edits.filter((_, i) => i !== index) });
        return true;
    }

    clearEdits(): void {
        this.setConfig({ edits: [] });
    }

    /** Applies the active tool at the tile under the pointer. */
    applyAtPointer(): void {
        const host = this.host;
        const tile = host?.getPointerTile();
        if (!host || !tile) return;

        if (this.config.tool === "select") {
            const loc = host.getPointerLoc();
            this.selection = loc ? { ...tile, ...loc } : { ...tile, locId: -1, locName: "" };
            this.commit();
            return;
        }

        const edit: EditModeEdit = {
            kind: this.config.tool === "place" ? "place" : "delete",
            locId: this.config.tool === "place" ? this.config.locId : 0,
            tileX: tile.tileX,
            tileY: tile.tileY,
            plane: tile.plane,
            shape: this.config.shape,
            rotation: this.config.rotation,
        };
        this.dispatch(edit);
        this.setConfig({ edits: [...this.config.edits, edit] });
    }

    private dispatch(edit: EditModeEdit): void {
        const host = this.host;
        if (!host) return;
        const tile = { x: edit.tileX, y: edit.tileY };
        if (edit.kind === "place") {
            host.onLocAddChange(edit.locId, tile, edit.plane, edit.shape, edit.rotation);
        } else {
            host.onLocDel(tile, edit.plane, edit.shape, edit.rotation);
        }
    }

    private readonly onMouseDown = (event: MouseEvent): void => {
        if (event.button !== 0 || event.target !== this.host?.getCanvas()) return;
        event.preventDefault();
        event.stopPropagation();
        this.applyAtPointer();
    };

    private readonly onKeyDown = (event: KeyboardEvent): void => {
        const target = event.target as HTMLElement | null;
        if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
        if (event.key === "r" || event.key === "R") {
            event.preventDefault();
            this.rotate();
        } else if (event.key === "Escape") {
            this.setConfig({ active: false });
        }
    };

    private syncListeners(): void {
        if (typeof window === "undefined") return;
        const shouldCapture = this.config.enabled && this.config.active && this.host !== undefined;
        if (shouldCapture === this.capturing) return;
        this.capturing = shouldCapture;

        if (shouldCapture) {
            window.addEventListener("mousedown", this.onMouseDown, true);
            window.addEventListener("keydown", this.onKeyDown, true);
        } else {
            window.removeEventListener("mousedown", this.onMouseDown, true);
            window.removeEventListener("keydown", this.onKeyDown, true);
        }
    }

    private sanitizeConfig(
        input: Partial<EditModePluginConfig> | undefined,
    ): EditModePluginConfig {
        const edits = Array.isArray(input?.edits) ? input.edits : DEFAULT_CONFIG.edits;
        return {
            enabled: input?.enabled ?? DEFAULT_CONFIG.enabled,
            active: (input?.enabled ?? DEFAULT_CONFIG.enabled) && (input?.active ?? false),
            tool: TOOLS.has(input?.tool as string) ? (input?.tool as EditModeTool) : "select",
            locId: toInt(input?.locId, DEFAULT_CONFIG.locId, 0, 0xffff),
            shape: toInt(input?.shape, DEFAULT_CONFIG.shape, 0, 22),
            rotation: toInt(input?.rotation, DEFAULT_CONFIG.rotation, 0, 3),
            edits: edits
                .filter((edit) => edit && (edit.kind === "place" || edit.kind === "delete"))
                .map((edit) => ({
                    kind: edit.kind,
                    locId: toInt(edit.locId, 0, 0, 0xffff),
                    tileX: toInt(edit.tileX, 0, 0, 0xffff),
                    tileY: toInt(edit.tileY, 0, 0, 0xffff),
                    plane: toInt(edit.plane, 0, 0, 3),
                    shape: toInt(edit.shape, LOC_SHAPE_NORMAL, 0, 22),
                    rotation: toInt(edit.rotation, 0, 0, 3),
                })),
        };
    }

    private commit(): void {
        this.version++;
        this.state = { config: this.config, selection: this.selection, version: this.version };
        this.persistence?.save(this.config);
        for (const listener of this.listeners) {
            try {
                listener();
            } catch (err) {
                console.log("[edit-mode-plugin] listener failed", err);
            }
        }
    }
}
