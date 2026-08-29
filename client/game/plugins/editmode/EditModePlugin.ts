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
    type EditModeSearchKind,
    type EditModeDefinitionSummary,
    type EditModeShop,
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
    heightLevel: 0,
    renderAllHeightLevels: true,
    showMapIcons: false,
    showPvpZones: false,
    showMultiCombatZones: false,
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
    private search: EditModePluginState["search"] = {
        kind: "loc",
        query: "",
        loading: false,
        results: [],
    };
    private pathStart?: EditModeTile;
    private freeCamera = false;
    private pointer?: {
        x: number;
        y: number;
        travelled: number;
        startTile?: EditModeTile;
        dragSelection?: EditModeSelection;
    };
    private cameraPointer?: { x: number; y: number };
    private buildingSelect = false;
    private preview?: EditModeEdit;
    private scenePreview = false;
    private interfaces: EditModePluginState["interfaces"] = { groups: [], widgets: [] };
    private world: EditModePluginState["world"] = { loading: false };
    private searchToken = 0;
    private worldLoadToken = 0;
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
            world: this.world,
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

    getCameraTile(): EditModeTile | undefined {
        return this.host?.getCameraTile?.();
    }

    exportActiveRegionPack(): { regionId: number; data: Uint8Array } | undefined {
        const tile = this.getCameraTile();
        return tile ? this.host?.exportRegionPack?.(tile, this.config.edits) : undefined;
    }

    attach(host: EditModeHost): void {
        this.host = host;
        host.setHeightLevel?.(this.config.heightLevel);
        host.setRenderAllHeightLevels?.(this.config.renderAllHeightLevels);
        if (typeof window !== "undefined") {
            window.addEventListener("keydown", this.onShortcut, true);
        }
        this.syncListeners();
        this.refreshWorldDefinition();
    }

    refreshWorldDefinition(): void {
        const load = this.host?.loadWorldDefinition;
        if (!load) return;
        const token = ++this.worldLoadToken;
        const previousDefinition = this.world.definition;
        this.world = { loading: true, definition: previousDefinition };
        this.commit();
        void load.call(this.host).then(
            (definition) => {
                if (token !== this.worldLoadToken) return;
                this.world = { loading: false, definition };
                this.commit();
            },
            (error) => {
                if (token !== this.worldLoadToken) return;
                this.world = {
                    loading: false,
                    definition: previousDefinition,
                    error: error instanceof Error ? error.message : String(error),
                };
                this.commit();
            },
        );
    }

    /** Ctrl+E arms or disarms the tools; the only in-game way in. */
    private readonly onShortcut = (event: KeyboardEvent): void => {
        if (!event.ctrlKey || (event.key !== "e" && event.key !== "E")) return;
        if (!this.config.enabled) return;
        event.preventDefault();
        event.stopPropagation();
        this.setConfig({ active: !this.config.active });
    };

    setConfig(nextConfig: Partial<EditModePluginConfig>): void {
        const wasActive = this.config.active;
        this.config = this.sanitizeConfig({ ...this.config, ...nextConfig });
        if (nextConfig.heightLevel !== undefined) {
            this.host?.setHeightLevel?.(this.config.heightLevel);
        }
        if (nextConfig.renderAllHeightLevels !== undefined) {
            this.host?.setRenderAllHeightLevels?.(this.config.renderAllHeightLevels);
        }
        this.syncListeners();
        if (Object.keys(nextConfig).some((key) => key !== "edits")) {
            this.refreshPlacementPreview();
        }
        this.commit();
        if (!wasActive && this.config.active && !this.world.loading) {
            this.refreshWorldDefinition();
        }
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
    searchCache(query: string, kind: EditModeSearchKind = this.config.placeKind): void {
        const host = this.host;
        this.search = {
            kind,
            query,
            loading: host !== undefined && query.trim().length > 0,
            results: [],
        };
        this.commit();
        if (!host || !this.search.loading) return;

        const token = ++this.searchToken;
        void host
            .search(kind, query)
            .then((results) => {
                if (token !== this.searchToken) return;
                this.search = { kind, query, loading: false, results };
                this.commit();
            })
            .catch(() => {
                if (token !== this.searchToken) return;
                this.search = { kind, query, loading: false, results: [] };
                this.commit();
            });
    }

    /** Selects a search result as the id the place tool will drop. */
    useSearchResult(id: number): void {
        if (this.search.kind === "item") return;
        this.setConfig(this.search.kind === "npc" ? { npcId: id } : { locId: id });
    }

    describeDefinition(kind: EditModeSearchKind, id: number): EditModeDefinitionSummary | undefined {
        return this.host?.describeDefinition?.(kind, id);
    }

    listShops(): Promise<EditModeShop[]> {
        return this.host?.listShops?.() ?? Promise.resolve([]);
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
        const spawn = this.world.definition?.spawn;
        // A missing definition (no development API, e.g. browser-hosted worlds)
        // only costs the spawn framing, so it must not block the editor.
        if (enabled && host.loadWorldDefinition && this.world.loading) return;
        host.setScenePreview(
            enabled,
            spawn && { tileX: spawn.x, tileY: spawn.y, plane: spawn.z },
        );
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

    duplicateSelection(): void {
        if (!this.selection || this.selection.kind === "npc" || this.selection.locId < 0) return;
        this.setConfig({
            tool: "place",
            placeKind: "loc",
            locId: this.selection.locId,
            shape: this.selection.shape ?? this.config.shape,
            rotation: this.selection.rotation ?? this.config.rotation,
        });
    }

    rotateSelection(): void {
        const selection = this.selection;
        if (!selection || selection.kind !== "loc" || selection.locId < 0) return;
        const shape = selection.shape ?? this.config.shape;
        const rotation = selection.rotation ?? this.config.rotation;
        const nextRotation = (rotation + 1) & 0x3;
        this.commitEdits([
            {
                kind: "delete",
                locId: 0,
                tileX: selection.tileX,
                tileY: selection.tileY,
                plane: selection.plane,
                shape,
                rotation,
            },
            {
                kind: "place",
                locId: selection.locId,
                tileX: selection.tileX,
                tileY: selection.tileY,
                plane: selection.plane,
                shape,
                rotation: nextRotation,
            },
        ]);
        this.selection = { ...selection, rotation: nextRotation };
        this.commit();
    }

    deleteSelection(): void {
        if (!this.selection || this.selection.kind === "npc" || this.selection.locId < 0) return;
        this.commitEdits([
            {
                kind: "delete",
                locId: 0,
                tileX: this.selection.tileX,
                tileY: this.selection.tileY,
                plane: this.selection.plane,
                shape: this.selection.shape ?? this.config.shape,
                rotation: this.selection.rotation ?? this.config.rotation,
            },
        ]);
        this.selection = undefined;
        this.host?.clearSelectionHighlight?.();
        this.commit();
    }

    paintSelection(): void {
        if (!this.selection || this.selection.kind === "building") return;
        this.commitEdits([this.terrainEdit(this.selection, 0, 0)]);
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
    applyAtPointer(buildingSelect = this.buildingSelect): void {
        const host = this.host;
        const tile = host?.getPointerTile();
        if (!host || !tile) return;

        if (this.config.tool === "select") {
            if (buildingSelect && host.selectBuilding) {
                this.selection = host.selectBuilding(tile);
                this.commit();
                return;
            }
            const loc = host.getPointerLoc();
            this.selection =
                host.selectPointer?.(tile) ??
                (loc ? { ...tile, ...loc } : { ...tile, locId: -1, locName: "" });
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
        if (this.config.tool === "place") this.clearPlacementPreview();
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

    /** Captures editor presses before the game can drag-look, walk, or draw its click cross. */
    private readonly onMouseDown = (event: MouseEvent): void => {
        if (event.target !== this.host?.getCanvas()) return;
        if (!this.hasEditableScene()) return;
        if (event.button === 2) {
            event.preventDefault();
            this.cameraPointer = { x: event.clientX, y: event.clientY };
            this.host?.cancelPendingClick();
            return;
        }
        if (event.button !== 0) return;
        this.pointer = {
            x: event.clientX,
            y: event.clientY,
            travelled: 0,
            startTile: this.config.tool === "select" ? this.host?.getPointerTile() : undefined,
        };
        this.host.cancelPendingClick();
    };

    private readonly onMouseMove = (event: MouseEvent): void => {
        this.buildingSelect = event.shiftKey;
        const cameraPointer = this.cameraPointer;
        if (cameraPointer) {
            const deltaX = event.clientX - cameraPointer.x;
            const deltaY = event.clientY - cameraPointer.y;
            cameraPointer.x = event.clientX;
            cameraPointer.y = event.clientY;
            this.host?.rotateCamera?.(deltaX, deltaY);
            return;
        }
        if (event.target === this.host?.getCanvas()) {
            this.refreshPlacementPreview();
            this.refreshPointerPreview();
        } else {
            this.clearPlacementPreview();
            this.host?.clearPointerPreview?.();
        }
        const pointer = this.pointer;
        if (!pointer) return;
        pointer.travelled += Math.abs(event.clientX - pointer.x) + Math.abs(event.clientY - pointer.y);
        pointer.x = event.clientX;
        pointer.y = event.clientY;
        if (
            pointer.travelled > DRAG_THRESHOLD_PX &&
            pointer.startTile &&
            this.config.tool === "select"
        ) {
            const tile = this.host?.getPointerTile();
            if (
                tile &&
                (pointer.dragSelection?.tileEndX !== tile.tileX ||
                    pointer.dragSelection?.tileEndY !== tile.tileY)
            ) {
                pointer.dragSelection = this.host?.selectTileRange?.(pointer.startTile, tile);
            }
        }
    };

    private readonly onMouseUp = (event: MouseEvent): void => {
        if (event.button === 2) {
            this.cameraPointer = undefined;
            this.host?.cancelPendingClick();
            const refresh = (): void => {
                if (!this.handlesCanvasInput()) return;
                this.refreshPlacementPreview();
                this.refreshPointerPreview();
            };
            if (this.host?.afterNextSceneFrame) this.host.afterNextSceneFrame(refresh);
            else refresh();
            return;
        }
        const pointer = this.pointer;
        this.pointer = undefined;
        if (!pointer || event.button !== 0) return;
        if (pointer.travelled > DRAG_THRESHOLD_PX) {
            if (pointer.dragSelection) {
                this.selection = pointer.dragSelection;
                this.commit();
            }
            return;
        }
        this.host?.cancelPendingClick();
        const buildingSelect = this.buildingSelect;
        const apply = (): void => {
            if (this.handlesCanvasInput()) this.applyAtPointer(buildingSelect);
        };
        if (this.host?.afterNextSceneFrame) this.host.afterNextSceneFrame(apply);
        else apply();
    };

    private readonly onKeyDown = (event: KeyboardEvent): void => {
        const target = event.target as HTMLElement | null;
        if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
        // The login form is drawn on the canvas, so its typing would otherwise
        // lose every "r" to the rotate shortcut.
        if (!this.hasEditableScene()) return;
        if (event.key === "Shift") {
            this.buildingSelect = true;
            this.refreshPointerPreview();
            return;
        }
        if (event.key === "r" || event.key === "R") {
            event.preventDefault();
            if (this.config.tool === "select" && this.selection?.kind === "loc") {
                this.rotateSelection();
            } else {
                this.rotate();
            }
        } else if (event.key === "Escape") {
            if (this.pathStart) {
                this.pathStart = undefined;
                this.commit();
                return;
            }
            this.setConfig({ active: false });
        }
    };

    private readonly onKeyUp = (event: KeyboardEvent): void => {
        if (event.key !== "Shift") return;
        this.buildingSelect = false;
        this.refreshPointerPreview();
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
        if (!shouldCapture) this.clearPlacementPreview();
        if (!shouldCapture) this.host?.clearSelectionHighlight?.();

        if (shouldCapture === this.capturing) return;
        this.capturing = shouldCapture;

        if (typeof window === "undefined") return;
        if (shouldCapture) {
            // Bubble after InputManager's canvas hooks, then remove the click
            // pulse before the next frame can treat an editor click as Walk here.
            window.addEventListener("mousedown", this.onMouseDown);
            window.addEventListener("mousemove", this.onMouseMove);
            window.addEventListener("mouseup", this.onMouseUp);
            window.addEventListener("keydown", this.onKeyDown, true);
            window.addEventListener("keyup", this.onKeyUp, true);
        } else {
            this.pointer = undefined;
            this.cameraPointer = undefined;
            this.buildingSelect = false;
            window.removeEventListener("mousedown", this.onMouseDown);
            window.removeEventListener("mousemove", this.onMouseMove);
            window.removeEventListener("mouseup", this.onMouseUp);
            window.removeEventListener("keydown", this.onKeyDown, true);
            window.removeEventListener("keyup", this.onKeyUp, true);
        }
    }

    private refreshPlacementPreview(): void {
        const host = this.host;
        const id = this.config.placeKind === "npc" ? this.config.npcId : this.config.locId;
        const tile = host?.getPointerTile();
        if (
            !host?.setPlacementPreview ||
            !this.handlesCanvasInput() ||
            this.config.tool !== "place" ||
            id <= 0 ||
            !tile
        ) {
            this.clearPlacementPreview();
            return;
        }

        const next: EditModeEdit = {
            kind: this.config.placeKind === "npc" ? "npc" : "place",
            locId: id,
            ...tile,
            shape: this.config.shape,
            rotation: this.config.rotation,
        };
        const current = this.preview;
        if (
            current?.kind === next.kind &&
            current.locId === next.locId &&
            current.tileX === next.tileX &&
            current.tileY === next.tileY &&
            current.plane === next.plane &&
            current.shape === next.shape &&
            current.rotation === next.rotation
        ) {
            return;
        }
        this.clearPlacementPreview();
        host.setPlacementPreview(this.config.placeKind, id, tile, next.shape, next.rotation);
        this.preview = next;
    }

    private refreshPointerPreview(): void {
        const host = this.host;
        const tile = host?.getPointerTile();
        if (!host?.previewPointer || this.config.tool !== "select" || !tile) {
            host?.clearPointerPreview?.();
            return;
        }
        if (this.buildingSelect && host.previewBuilding) {
            host.previewBuilding(tile);
            return;
        }
        host.previewPointer(tile);
    }

    private clearPlacementPreview(): void {
        if (!this.preview) return;
        this.host?.clearPlacementPreview?.();
        this.preview = undefined;
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
            heightLevel: toInt(input?.heightLevel, DEFAULT_CONFIG.heightLevel, 0, 3),
            renderAllHeightLevels:
                input?.renderAllHeightLevels ?? DEFAULT_CONFIG.renderAllHeightLevels,
            showMapIcons: input?.showMapIcons ?? DEFAULT_CONFIG.showMapIcons,
            showPvpZones: input?.showPvpZones ?? DEFAULT_CONFIG.showPvpZones,
            showMultiCombatZones:
                input?.showMultiCombatZones ?? DEFAULT_CONFIG.showMultiCombatZones,
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
            world: this.world,
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
