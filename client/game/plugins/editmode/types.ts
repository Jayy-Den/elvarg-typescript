/** Loc shape ids, mirrored from rs/config/loctype/LocModelType. */
export const LOC_SHAPE_NORMAL = 10;

export type EditModeTool = "select" | "place" | "delete";

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
    kind: "place" | "delete" | "npc";
    /** Loc id, NPC type id, or 0 for deletes. */
    locId: number;
    /** Loc shape; unused for NPCs. */
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
    edits: EditModeEdit[];
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
}
