/** Loc shape ids, mirrored from rs/config/loctype/LocModelType. */
export const LOC_SHAPE_NORMAL = 10;

export type EditModeTool = "select" | "place" | "delete" | "terrain" | "path";

/** OSRS dirt-path overlay; the id most hand-drawn paths use. */
export const DEFAULT_PATH_OVERLAY_ID = 2;

/** What the place tool drops: a cache loc or a cache NPC. */
export type EditModePlaceKind = "loc" | "npc";

/** Cache categories exposed by the reference editor's search panel. */
export type EditModeSearchKind = EditModePlaceKind | "item";

export interface EditModeSearchResult {
    id: number;
    name: string;
}

export interface EditModeDefinitionSummary {
    id: number;
    kind: EditModeSearchKind;
    name: string;
    fields: Array<[string, string]>;
}

export interface EditModeShop {
    id: number;
    name: string;
    currency?: string;
    originalStock: Array<{ id: number; amount: number; name?: string }>;
}

export type EditModeWorldZoneTag = "pvp" | "multi-combat";

export interface EditModeWorldZone {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    z: number;
    tags: EditModeWorldZoneTag[];
}

export interface EditModeWorldDefinition {
    spawn: { x: number; y: number; z: number };
    zones: EditModeWorldZone[];
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
    /** Height level edited by pointer, placement, and terrain tools. */
    heightLevel: number;
    /** Show every height level, or heightLevel and everything below it. */
    renderAllHeightLevels: boolean;
    /** Draw selectable map-function sprites at their floor tiles. */
    showMapIcons: boolean;
    showPvpZones: boolean;
    showMultiCombatZones: boolean;
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
    kind?: "ground" | "loc" | "npc" | "building";
    locId: number;
    locName: string;
    shape?: number;
    rotation?: number;
    tileEndX?: number;
    tileEndY?: number;
    planeEnd?: number;
    buildingWidth?: number;
    buildingDepth?: number;
    buildingFloors?: number;
    buildingTileCount?: number;
    buildingShape?: "Rectangle" | "Irregular";
    buildingObjectCount?: number;
    buildingWallCount?: number;
    buildingDoorCount?: number;
    buildingRoofCount?: number;
    buildingDecorationCount?: number;
    buildingOtherCount?: number;
    buildingWallId?: number;
}

export interface EditModePluginState {
    config: EditModePluginConfig;
    selection?: EditModeSelection;
    search: {
        kind: EditModeSearchKind;
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
    world: {
        loading: boolean;
        definition?: EditModeWorldDefinition;
        error?: string;
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
    getCameraTile?(): EditModeTile | undefined;
    /** Menu entries for the current hover, used to identify the loc being pointed at. */
    getPointerLoc(): { locId: number; locName: string } | undefined;
    /** Selects and visually marks the topmost entity, or the ground tile. */
    selectPointer?(tile: EditModeTile): EditModeSelection;
    previewPointer?(tile: EditModeTile): void;
    previewBuilding?(tile: EditModeTile): void;
    selectBuilding?(tile: EditModeTile): EditModeSelection | undefined;
    clearPointerPreview?(): void;
    selectTileRange?(start: EditModeTile, end: EditModeTile): EditModeSelection;
    afterNextSceneFrame?(callback: () => void): void;
    clearSelectionHighlight?(): void;
    rotateCamera?(deltaX: number, deltaY: number): void;
    /** Shows the currently armed loc/NPC at the tile under the pointer. */
    setPlacementPreview?(
        kind: EditModePlaceKind,
        id: number,
        tile: EditModeTile,
        shape: number,
        rotation: number,
    ): void;
    clearPlacementPreview?(): void;
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
    search(kind: EditModeSearchKind, query: string): Promise<EditModeSearchResult[]>;
    describeDefinition?(kind: EditModeSearchKind, id: number): EditModeDefinitionSummary | undefined;
    listShops?(): Promise<EditModeShop[]>;
    loadWorldDefinition?(): Promise<EditModeWorldDefinition>;
    /** Spawns a cache NPC client-side. Returns the synthetic server id used. */
    spawnNpc(npcTypeId: number, tile: EditModeTile, rotation: number): number | undefined;
    despawnNpc(serverId: number): void;
    /** Paints a floor overlay on a tile and reloads the map square. */
    setTerrainOverlay(tile: EditModeTile, overlay: number, shape: number, rotation: number): void;
    clearTerrainOverride(tile: EditModeTile): void;
    setFreeCamera(enabled: boolean): void;
    /** Renders the world instead of the login screen while logged out. */
    setScenePreview(enabled: boolean, spawn?: EditModeTile): void;
    setHeightLevel?(level: number): void;
    setRenderAllHeightLevels?(enabled: boolean): void;
    isLoggedIn(): boolean;
    /** Moves the camera over a world tile, for navigating while flying. */
    jumpCameraToTile(tile: EditModeTile): void;
    /** Serializes the map square under the camera for data/regions/{regionId}.pack. */
    exportRegionPack?(
        tile: EditModeTile,
        edits: readonly EditModeEdit[],
    ): { regionId: number; data: Uint8Array };
    /** Drops the click the client has queued, so a tool press does not also
     *  walk the player or open a menu. */
    cancelPendingClick(): void;
    /** Re-frames the camera north-up at the editor's working angle. */
    levelCamera(): void;
    /** Interface groups the cache has loaded, for the interface browser. */
    listInterfaceGroups(): number[];
    /** Opens an interface group as the root interface. */
    openInterface(groupId: number): void;
    /** Widget summaries for an interface group. */
    describeInterface(groupId: number): EditModeWidgetSummary[];
}
