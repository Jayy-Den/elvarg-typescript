import { buildPathOverlays, createPathTiles } from "./PathGenerator";
import {
    DEFAULT_PATH_OVERLAY_ID,
    LOC_SHAPE_NORMAL,
    type EditModeEdit,
    type EditModeHost,
    type EditModePlaceKind,
    type EditModePluginConfig,
    type EditModePluginPersistence,
    type EditModePluginState,
    type EditModeSearchResult,
    type EditModeSelection,
    type EditModeTile,
    type EditModeTool,
    type EditModeWidgetSummary,
} from "./types";

type EditModePluginListener = () => void;

const DEFAULT_CONFIG: EditModePluginConfig = Object.freeze({
    enabled: false,
    active: false,
    tool: "select" as EditModeTool,
    placeKind: "loc" as EditModePlaceKind,
    locId: 0,
    npcId: 0,
    shape: LOC_SHAPE_NORMAL,
    rotation: 0,
    overlayId: DEFAULT_PATH_OVERLAY_ID,
    edits: [] as EditModeEdit[],
});

const TOOLS: ReadonlySet<string> = new Set<EditModeTool>([
    "select",
    "place",
    "delete",
    "terrain",
    "path",
]);
/** Keeps a stray path click from repainting half the map square. */
const MAX_PATH_TILES = 512;
/** Pointer travel past this is a camera drag, not a click on a tile. */
const DRAG_THRESHOLD_PX = 4;
const PLACE_KINDS: ReadonlySet<string> = new Set<EditModePlaceKind>(["loc", "npc"]);

/** Keys spawned NPCs by the edit that created them, so undo can despawn them. */
function npcKey(edit: EditModeEdit): string {
    return `${edit.tileX},${edit.tileY},${edit.plane},${edit.locId}`;
}

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
    private search: EditModePluginState["search"] = { query: "", loading: false, results: [] };
    private pathStart?: EditModeTile;
    private freeCamera = false;
    private pointer?: { x: number; y: number; travelled: number };
    private scenePreview = false;
    private interfaces: EditModePluginState["interfaces"] = { groups: [], widgets: [] };
    private searchToken = 0;
    private readonly spawnedNpcs = new Map<string, number>();
    private version = 0;

    constructor(persistence?: EditModePluginPersistence) {
        this.persistence = persistence;
        // Never restore an armed session: a plugin that eats clicks from the
        // first frame is impossible to diagnose from the UI.
        this.config = this.sanitizeConfig({ ...persistence?.load(), active: false });
        this.state = {
            config: this.config,
            search: this.search,
            freeCamera: this.freeCamera,
            scenePreview: this.scenePreview,
            interfaces: this.interfaces,
            version: this.version,
        };
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

    /** Cache name for an NPC type id, "" when the cache is not loaded yet. */
    getNpcName(npcTypeId: number): string {
        try {
            return this.host?.getNpcName(npcTypeId) ?? "";
        } catch {
            return "";
        }
    }

    /** Runs a cache name/id search for the current place kind. */
    searchCache(query: string): void {
        const host = this.host;
        this.search = { query, loading: host !== undefined && query.trim().length > 0, results: [] };
        this.commit();
        if (!host || !this.search.loading) return;

        const token = ++this.searchToken;
        void host
            .search(this.config.placeKind, query)
            .then((results) => {
                if (token !== this.searchToken) return;
                this.search = { query, loading: false, results };
                this.commit();
            })
            .catch(() => {
                if (token !== this.searchToken) return;
                this.search = { query, loading: false, results: [] };
                this.commit();
            });
    }

    /** Selects a search result as the id the place tool will drop. */
    useSearchResult(id: number): void {
        this.setConfig(this.config.placeKind === "npc" ? { npcId: id } : { locId: id });
    }

    /** Detaches or reattaches the camera from the player. */
    setFreeCamera(enabled: boolean): void {
        this.host?.setFreeCamera(enabled);
        this.freeCamera = enabled;
        this.commit();
    }

    /**
     * Renders the world on the login screen. There is no player to orbit, so
     * the camera is detached at the same time and the scene streams around it.
     */
    setScenePreview(enabled: boolean): void {
        const host = this.host;
        if (!host) return;
        host.setScenePreview(enabled);
        this.scenePreview = enabled;
        if (enabled) {
            if (!this.freeCamera) {
                host.setFreeCamera(true);
                this.freeCamera = true;
            }
            if (!this.config.active) {
                // Arm the tools so Esc leaves the preview, which is the only way
                // back to the login screen when entering from its button.
                this.setConfig({ active: true });
                return;
            }
        }
        this.commit();
    }

    /** Puts the camera back to north-up at the editor's working angle. */
    levelCamera(): void {
        this.host?.levelCamera();
    }

    /** Moves the camera over a tile; handy once the camera is detached. */
    jumpToTile(tileX: number, tileY: number, plane = 0): void {
        this.host?.jumpCameraToTile({ tileX: tileX | 0, tileY: tileY | 0, plane: plane & 0x3 });
    }

    /** Refreshes the list of interface groups the cache has loaded. */
    refreshInterfaces(): void {
        const groups = (this.host?.listInterfaceGroups() ?? []).slice().sort((a, b) => a - b);
        this.interfaces = { ...this.interfaces, groups };
        this.commit();
    }

    /** Opens an interface group and lists its widgets. */
    openInterface(groupId: number): void {
        const host = this.host;
        if (!host) return;
        host.openInterface(groupId);
        this.selectInterface(groupId);
    }

    /** Lists an interface group's widgets without opening it. */
    selectInterface(groupId: number): void {
        const widgets: EditModeWidgetSummary[] = this.host?.describeInterface(groupId) ?? [];
        this.interfaces = { ...this.interfaces, selected: groupId, widgets };
        this.commit();
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
     * Reverts the most recent loc placement or NPC spawn. Deletes are not
     * revertible - the loc suppression lives in the renderer's override map
     * until the page reloads.
     * ponytail: undo skips deletes, wire a real override-clear if that bites.
     */
    undo(): boolean {
        const edits = this.config.edits;
        let index = -1;
        for (let i = edits.length - 1; i >= 0; i--) {
            if (edits[i].kind !== "delete") {
                index = i;
                break;
            }
        }
        if (index === -1) return false;

        const edit = edits[index];
        this.revert(edit);
        this.setConfig({ edits: edits.filter((_, i) => i !== index) });
        return true;
    }

    clearEdits(): void {
        for (const edit of this.config.edits) {
            if (edit.kind === "npc" || edit.kind === "terrain") this.revert(edit);
        }
        this.setConfig({ edits: [] });
    }

    private revert(edit: EditModeEdit): void {
        if (edit.kind === "npc") {
            const key = npcKey(edit);
            const serverId = this.spawnedNpcs.get(key);
            if (serverId !== undefined) {
                this.host?.despawnNpc(serverId);
                this.spawnedNpcs.delete(key);
            }
            return;
        }
        if (edit.kind === "terrain") {
            this.host?.clearTerrainOverride({
                tileX: edit.tileX,
                tileY: edit.tileY,
                plane: edit.plane,
            });
            return;
        }
        if (edit.kind === "place") {
            this.host?.onLocDel(
                { x: edit.tileX, y: edit.tileY },
                edit.plane,
                edit.shape,
                edit.rotation,
            );
        }
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

        if (this.config.tool === "terrain") {
            this.commitEdits([this.terrainEdit(tile, 0, 0)]);
            return;
        }

        if (this.config.tool === "path") {
            this.extendPath(tile);
            return;
        }

        const placingNpc = this.config.tool === "place" && this.config.placeKind === "npc";
        const edit: EditModeEdit = {
            kind: this.config.tool !== "place" ? "delete" : placingNpc ? "npc" : "place",
            locId: placingNpc
                ? this.config.npcId
                : this.config.tool === "place"
                  ? this.config.locId
                  : 0,
            tileX: tile.tileX,
            tileY: tile.tileY,
            plane: tile.plane,
            shape: this.config.shape,
            rotation: this.config.rotation,
        };
        this.commitEdits([edit]);
    }

    /**
     * First click sets the path start, second click paints the run between
     * them - including the corner and edge overlays the shape needs.
     */
    private extendPath(tile: EditModeTile): void {
        const start = this.pathStart;
        if (!start || start.plane !== tile.plane) {
            this.pathStart = tile;
            this.commit();
            return;
        }

        const tiles = createPathTiles(
            { x: start.tileX, y: start.tileY },
            { x: tile.tileX, y: tile.tileY },
        ).slice(0, MAX_PATH_TILES);
        const pathKeys = new Set(tiles.map((entry) => `${entry.x}:${entry.y}`));
        // The overlays bleed one tile outwards for caps and corners.
        const minX = Math.min(start.tileX, tile.tileX) - 1;
        const maxX = Math.max(start.tileX, tile.tileX) + 1;
        const minY = Math.min(start.tileY, tile.tileY) - 1;
        const maxY = Math.max(start.tileY, tile.tileY) + 1;
        const overlays = buildPathOverlays(
            pathKeys,
            pathKeys,
            (x, y) => x >= minX && x <= maxX && y >= minY && y <= maxY,
        );

        this.pathStart = undefined;
        this.commitEdits(
            overlays.map((overlay) =>
                this.terrainEdit(
                    { tileX: overlay.x, tileY: overlay.y, plane: tile.plane },
                    overlay.overlayShape,
                    overlay.overlayRotation,
                ),
            ),
        );
    }

    private terrainEdit(tile: EditModeTile, shape: number, rotation: number): EditModeEdit {
        return {
            kind: "terrain",
            locId: this.config.overlayId,
            tileX: tile.tileX,
            tileY: tile.tileY,
            plane: tile.plane,
            shape,
            rotation,
        };
    }

    private commitEdits(edits: EditModeEdit[]): void {
        if (edits.length === 0) return;
        for (const edit of edits) {
            this.dispatch(edit);
        }
        this.setConfig({ edits: [...this.config.edits, ...edits] });
    }

    private dispatch(edit: EditModeEdit): void {
        const host = this.host;
        if (!host) return;

        if (edit.kind === "npc") {
            const key = npcKey(edit);
            const existing = this.spawnedNpcs.get(key);
            if (existing !== undefined) host.despawnNpc(existing);
            const serverId = host.spawnNpc(
                edit.locId,
                { tileX: edit.tileX, tileY: edit.tileY, plane: edit.plane },
                edit.rotation,
            );
            if (serverId !== undefined) this.spawnedNpcs.set(key, serverId);
            return;
        }

        if (edit.kind === "terrain") {
            host.setTerrainOverlay(
                { tileX: edit.tileX, tileY: edit.tileY, plane: edit.plane },
                edit.locId,
                edit.shape,
                edit.rotation,
            );
            return;
        }

        const tile = { x: edit.tileX, y: edit.tileY };
        if (edit.kind === "place") {
            host.onLocAddChange(edit.locId, tile, edit.plane, edit.shape, edit.rotation);
        } else {
            host.onLocDel(tile, edit.plane, edit.shape, edit.rotation);
        }
    }

    /** Whether canvas clicks and shortcuts are being intercepted right now. */
    handlesCanvasInput(): boolean {
        return this.capturing && this.hasEditableScene();
    }

    /**
     * There is only something to edit once a scene is on screen. Without this
     * the armed plugin swallows every canvas click, which on the login screen
     * means the buttons and form stop responding entirely.
     */
    private hasEditableScene(): boolean {
        return this.scenePreview || this.host?.isLoggedIn() === true;
    }

    /**
     * The press is deliberately left alone so the client's own drag-look keeps
     * working exactly as it does everywhere else; only a press that turns out
     * to be a click applies a tool, and that click is then cancelled so the
     * game does not act on it too.
     */
    private readonly onMouseDown = (event: MouseEvent): void => {
        if (event.button !== 0 || event.target !== this.host?.getCanvas()) return;
        if (!this.hasEditableScene()) return;
        this.pointer = { x: event.clientX, y: event.clientY, travelled: 0 };
    };

    private readonly onMouseMove = (event: MouseEvent): void => {
        const pointer = this.pointer;
        if (!pointer) return;
        pointer.travelled += Math.abs(event.clientX - pointer.x) + Math.abs(event.clientY - pointer.y);
        pointer.x = event.clientX;
        pointer.y = event.clientY;
    };

    private readonly onMouseUp = (event: MouseEvent): void => {
        const pointer = this.pointer;
        this.pointer = undefined;
        if (!pointer || event.button !== 0) return;
        if (pointer.travelled > DRAG_THRESHOLD_PX) return;
        this.applyAtPointer();
        this.host?.cancelPendingClick();
    };

    private readonly onKeyDown = (event: KeyboardEvent): void => {
        const target = event.target as HTMLElement | null;
        if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
        // The login form is drawn on the canvas, so its typing would otherwise
        // lose every "x" to the rotate shortcut.
        if (!this.hasEditableScene()) return;
        if (event.key === "x" || event.key === "X") {
            event.preventDefault();
            this.rotate();
        } else if (event.key === "Escape") {
            if (this.pathStart) {
                this.pathStart = undefined;
                this.commit();
                return;
            }
            this.setConfig({ active: false });
        }
    };

    private syncListeners(): void {
        const shouldCapture = this.config.enabled && this.config.active && this.host !== undefined;

        // Checked before the change guard: switching the plugin off entirely
        // never toggles capture, and would otherwise strand the camera off the
        // player with the panel gone.
        if (!shouldCapture && this.scenePreview) {
            this.host?.setScenePreview(false);
            this.scenePreview = false;
        }
        if (!shouldCapture && this.freeCamera) {
            // Logging in re-attaches the camera itself; only give it back when
            // the preview is not the thing holding it.
            this.host?.setFreeCamera(false);
            this.freeCamera = false;
        }

        if (shouldCapture === this.capturing) return;
        this.capturing = shouldCapture;

        if (typeof window === "undefined") return;
        if (shouldCapture) {
            window.addEventListener("mousedown", this.onMouseDown, true);
            window.addEventListener("mousemove", this.onMouseMove, true);
            window.addEventListener("mouseup", this.onMouseUp, true);
            window.addEventListener("keydown", this.onKeyDown, true);
        } else {
            this.pointer = undefined;
            window.removeEventListener("mousedown", this.onMouseDown, true);
            window.removeEventListener("mousemove", this.onMouseMove, true);
            window.removeEventListener("mouseup", this.onMouseUp, true);
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
            placeKind: PLACE_KINDS.has(input?.placeKind as string)
                ? (input?.placeKind as EditModePlaceKind)
                : DEFAULT_CONFIG.placeKind,
            locId: toInt(input?.locId, DEFAULT_CONFIG.locId, 0, 0xffff),
            npcId: toInt(input?.npcId, DEFAULT_CONFIG.npcId, 0, 0xffff),
            overlayId: toInt(input?.overlayId, DEFAULT_CONFIG.overlayId, 0, 0xffff),
            shape: toInt(input?.shape, DEFAULT_CONFIG.shape, 0, 22),
            rotation: toInt(input?.rotation, DEFAULT_CONFIG.rotation, 0, 3),
            edits: edits
                .filter(
                    (edit) =>
                        edit &&
                        (edit.kind === "place" ||
                            edit.kind === "delete" ||
                            edit.kind === "npc" ||
                            edit.kind === "terrain"),
                )
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
        this.state = {
            config: this.config,
            selection: this.selection,
            search: this.search,
            pathStart: this.pathStart,
            freeCamera: this.freeCamera,
            scenePreview: this.scenePreview,
            interfaces: this.interfaces,
            version: this.version,
        };
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
