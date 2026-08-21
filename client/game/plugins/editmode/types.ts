/** Loc shape ids, mirrored from rs/config/loctype/LocModelType. */
export const LOC_SHAPE_NORMAL = 10;

export type EditModeTool = "select" | "place" | "delete" | "terrain" | "path";

/** OSRS dirt-path overlay; the id most hand-drawn paths use. */
export const DEFAULT_PATH_OVERLAY_ID = 2;

/** What the place tool drops: a cache loc or a cache NPC. */
export type EditModePlaceKind = "loc" | "npc";

export interface EditModeSearchResult {
    id: number;
    name: string;
}

export interface EditModeTile {
    tileX: number;
    tileY: number;
    plane: number;
}

export interface EditModeEdit extends EditModeTile {
    kind: "place" | "delete" | "npc" | "terrain";
    /** Loc id, NPC type id, overlay id for terrain, or 0 for deletes. */
    locId: number;
    /** Loc shape, or overlay shape for terrain; unused for NPCs. */
    shape: number;
    rotation: number;
}

export interface EditModePluginConfig {
    /** Plugin Hub on/off. */
    enabled: boolean;
    /** Whether clicks in the world are captured for editing. */
    active: boolean;
    tool: EditModeTool;
    placeKind: EditModePlaceKind;
    locId: number;
    npcId: number;
    shape: number;
    rotation: number;
    /** Floor overlay the terrain and path tools paint with. */
    overlayId: number;
    edits: EditModeEdit[];
}

export interface EditModeWidgetSummary {
    uid: number;
    fileId: number;
    type: number;
    x: number;
    y: number;
    width: number;
    height: number;
    text?: string;
}

export interface EditModeSelection extends EditModeTile {
    locId: number;
    locName: string;
}

export interface EditModePluginState {
    config: EditModePluginConfig;
    selection?: EditModeSelection;
    search: {
        query: string;
        loading: boolean;
        results: EditModeSearchResult[];
    };
    /** First click of the path tool, waiting for its end tile. */
    pathStart?: EditModeTile;
    /** Camera detached from the player, flown with WASD/QE. Never persisted. */
    freeCamera: boolean;
    /** World rendered on the login screen. Never persisted. */
    scenePreview: boolean;
    interfaces: {
        groups: number[];
        selected?: number;
        widgets: EditModeWidgetSummary[];
    };
    version: number;
}

export interface EditModePluginPersistence {
    load(): Partial<EditModePluginConfig> | undefined;
    save(config: EditModePluginConfig): void;
}

/** Everything the plugin needs from the client, kept structural so tests can fake it. */
export interface EditModeHost {
    getCanvas(): HTMLCanvasElement | undefined;
    /** Tile under the pointer, in world coordinates. */
    getPointerTile(): EditModeTile | undefined;
    /** Menu entries for the current hover, used to identify the loc being pointed at. */
    getPointerLoc(): { locId: number; locName: string } | undefined;
    onLocAddChange(
        locId: number,
        tile: { x: number; y: number },
        level: number,
        shape: number,
        rotation: number,
    ): void;
    onLocDel(tile: { x: number; y: number }, level: number, shape: number, rotation: number): void;
    getLocName(locId: number): string;
    getNpcName(npcTypeId: number): string;
    /** Name/id search over the cache; the index is built on first use. */
    search(kind: EditModePlaceKind, query: string): Promise<EditModeSearchResult[]>;
    /** Spawns a cache NPC client-side. Returns the synthetic server id used. */
    spawnNpc(npcTypeId: number, tile: EditModeTile, rotation: number): number | undefined;
    despawnNpc(serverId: number): void;
    /** Paints a floor overlay on a tile and reloads the map square. */
    setTerrainOverlay(tile: EditModeTile, overlay: number, shape: number, rotation: number): void;
    clearTerrainOverride(tile: EditModeTile): void;
    setFreeCamera(enabled: boolean): void;
    /** Renders the world instead of the login screen while logged out. */
    setScenePreview(enabled: boolean): void;
    isLoggedIn(): boolean;
    /** Moves the camera over a world tile, for navigating while flying. */
    jumpCameraToTile(tile: EditModeTile): void;
    /** Drag-look, in the client's own pixels-to-RS-units mapping. */
    rotateCamera(deltaX: number, deltaY: number): void;
    /** Re-frames the camera north-up at the editor's working angle. */
    levelCamera(): void;
    /** Interface groups the cache has loaded, for the interface browser. */
    listInterfaceGroups(): number[];
    /** Opens an interface group as the root interface. */
    openInterface(groupId: number): void;
    /** Widget summaries for an interface group. */
    describeInterface(groupId: number): EditModeWidgetSummary[];
}
