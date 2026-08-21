/** Loc shape ids, mirrored from rs/config/loctype/LocModelType. */
export const LOC_SHAPE_NORMAL = 10;

export type EditModeTool = "select" | "place" | "delete";

export interface EditModeTile {
    tileX: number;
    tileY: number;
    plane: number;
}

export interface EditModeEdit extends EditModeTile {
    kind: "place" | "delete";
    /** 0 for deletes. */
    locId: number;
    shape: number;
    rotation: number;
}

export interface EditModePluginConfig {
    /** Plugin Hub on/off. */
    enabled: boolean;
    /** Whether clicks in the world are captured for editing. */
    active: boolean;
    tool: EditModeTool;
    locId: number;
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
}
