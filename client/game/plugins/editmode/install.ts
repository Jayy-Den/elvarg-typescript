import { MenuTargetType } from "../../../rs/MenuEntry";
import type { OsrsClient } from "../../OsrsClient";
import { createBrowserEditModePluginPersistence } from "./BrowserEditModePluginPersistence";
import { EditModePlugin } from "./EditModePlugin";
import type { EditModePlaceKind, EditModeSearchResult, EditModeTile } from "./types";

/** Synthetic server ids for editor NPCs, kept clear of the server's own range. */
const EDITOR_NPC_SERVER_ID_BASE = 60000;
const SEARCH_RESULT_LIMIT = 60;
/** North-up at the standard RS working angle: the title-screen preset sits off-axis and reads as skewed. */
const EDITOR_CAMERA_YAW = 0;
const EDITOR_CAMERA_PITCH = 210;
/** Tiles the camera pulls back along its view ray when framing a tile. */
const EDITOR_CAMERA_DISTANCE = 30;
/**
 * The logged-out viewport fills the canvas, and OSRS's own fov curve turns that
 * into a ~78deg wide angle that leans every wall away from centre. 600 is the
 * flatter, RS-like projection the old editor used (Client.cameraZoom = 600).
 */
const EDITOR_CAMERA_FOV = 600;
/** Far enough that fog does not eat the frame at the editor's camera distance. */
const EDITOR_DRAW_DISTANCE = 80;
const WIDGET_SUMMARY_LIMIT = 200;
/** Types decoded per frame while indexing, so the client keeps rendering. */
const INDEX_CHUNK = 2000;

type NameIndex = ReadonlyArray<EditModeSearchResult>;

interface NamedTypeLoader {
    getCount(): number;
    load(id: number): { name?: string } | undefined;
    clearCache(): void;
}

const indexes = new Map<EditModePlaceKind, NameIndex>();
const indexPromises = new Map<EditModePlaceKind, Promise<NameIndex>>();

async function buildNameIndex(loader: NamedTypeLoader): Promise<NameIndex> {
    const results: EditModeSearchResult[] = [];
    const count = loader.getCount() | 0;
    for (let id = 0; id < count; id++) {
        try {
            const name = loader.load(id)?.name;
            if (name && name !== "null") results.push({ id, name });
        } catch {
            // Types that fail to decode simply do not appear in the palette.
        }
        if (id % INDEX_CHUNK === INDEX_CHUNK - 1) {
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
    }
    // Decoding every type fills the loader cache; drop it, we only kept names.
    loader.clearCache();
    return results;
}

function getNameIndex(kind: EditModePlaceKind, loader: NamedTypeLoader): Promise<NameIndex> {
    const cached = indexes.get(kind);
    if (cached) return Promise.resolve(cached);

    let pending = indexPromises.get(kind);
    if (!pending) {
        pending = buildNameIndex(loader).then((index) => {
            indexes.set(kind, index);
            indexPromises.delete(kind);
            return index;
        });
        indexPromises.set(kind, pending);
    }
    return pending;
}

function filterIndex(index: NameIndex, query: string): EditModeSearchResult[] {
    const trimmed = query.trim().toLowerCase();
    if (trimmed.length === 0) return [];

    const byId = Number(trimmed);
    if (Number.isInteger(byId) && byId >= 0) {
        const exact = index.filter((entry) => entry.id === byId);
        const partial = index.filter(
            (entry) => entry.id !== byId && String(entry.id).startsWith(trimmed),
        );
        return [...exact, ...partial].slice(0, SEARCH_RESULT_LIMIT);
    }

    return index
        .filter((entry) => entry.name.toLowerCase().includes(trimmed))
        .slice(0, SEARCH_RESULT_LIMIT);
}

/** Wires the editor to the running client. Dev builds only - see OsrsClient. */
export function installEditMode(client: OsrsClient): EditModePlugin {
    const plugin = new EditModePlugin(
        createBrowserEditModePluginPersistence("osrs.plugin.edit_mode.v1"),
    );

    plugin.attach({
        getCanvas: () => client.renderer?.canvas as HTMLCanvasElement | undefined,
        getPointerTile: () => {
            const renderer = client.renderer as unknown as
                | {
                      computeTileAt?: (
                          x: number,
                          y: number,
                      ) => { tileX: number; tileY: number; plane: number } | undefined;
                  }
                | undefined;
            // hoveredTile is only maintained while the hover overlay is on, so
            // fall back to picking the tile under the pointer ourselves.
            const tile =
                client.hoveredTile ??
                renderer?.computeTileAt?.(client.inputManager.mouseX, client.inputManager.mouseY);
            if (!tile) return undefined;
            return { tileX: tile.tileX | 0, tileY: tile.tileY | 0, plane: (tile.plane ?? 0) | 0 };
        },
        getPointerLoc: () => {
            const entry = client.menuEntries.find(
                (candidate) => candidate.targetType === MenuTargetType.LOC,
            );
            return entry ? { locId: entry.targetId | 0, locName: entry.targetName } : undefined;
        },
        onLocAddChange: (locId, tile, level, shape, rotation) => {
            client.onLocAddChange(locId, tile, level, shape, rotation);
        },
        onLocDel: (tile, level, shape, rotation) => {
            client.onLocDel(tile, level, shape, rotation);
        },
        getLocName: (locId) => client.locTypeLoader?.load(locId)?.name ?? "",
        getNpcName: (npcTypeId) => client.npcTypeLoader?.load(npcTypeId)?.name ?? "",
        search: async (kind, query) => {
            const loader = (
                kind === "npc" ? client.npcTypeLoader : client.locTypeLoader
            ) as unknown as NamedTypeLoader | undefined;
            if (!loader) return [];
            return filterIndex(await getNameIndex(kind, loader), query);
        },
        spawnNpc: (npcTypeId, tile, rotation) => spawnEditorNpc(client, npcTypeId, tile, rotation),
        setFreeCamera: (enabled) => {
            // The client already flies the camera with WASD/QE whenever it is
            // not following the player (GameRenderer.handleKeyInput).
            // ponytail: map streaming still centres on the player, so flying
            // past the loaded radius shows empty space.
            client.followPlayerCamera = !enabled;
        },
        setScenePreview: (enabled) => {
            client.scenePreviewEnabled = enabled;
            if (!enabled) {
                restoreViewSettings(client);
                return;
            }
            applyEditorViewSettings(client);
            // Logged out the camera still holds the title-screen angles and sits
            // 26 tiles up with nothing framed, which reads as a skewed world.
            frameCameraOnTile(
                client,
                {
                    tileX: Math.round(client.camera.getPosX()),
                    tileY: Math.round(client.camera.getPosZ()),
                    plane: 0,
                },
                true,
            );
        },
        isLoggedIn: () => client.isLoggedIn(),
        jumpCameraToTile: (tile) => {
            frameCameraOnTile(client, tile, false);
        },
        rotateCamera: (deltaX, deltaY) => {
            // Same mapping the client uses for its own drag-look.
            const camera = client.camera;
            camera.updateYaw(camera.yaw, -deltaX * 0.9);
            camera.updatePitch(camera.pitch, -deltaY * 0.9);
        },
        levelCamera: () => {
            frameCameraOnTile(
                client,
                {
                    tileX: Math.round(client.camera.getPosX()),
                    tileY: Math.round(client.camera.getPosZ()),
                    plane: 0,
                },
                true,
            );
        },
        listInterfaceGroups: () => client.widgetManager?.getAvailableGroups() ?? [],
        openInterface: (groupId) => {
            client.widgetManager?.setRootInterface(groupId | 0);
        },
        describeInterface: (groupId) =>
            (client.widgetManager?.getWidgetsForGroup(groupId | 0) ?? [])
                .slice(0, WIDGET_SUMMARY_LIMIT)
                .map((widget) => ({
                    uid: widget.uid | 0,
                    fileId: widget.fileId | 0,
                    type: widget.type ?? -1,
                    x: widget.x | 0,
                    y: widget.y | 0,
                    width: widget.width | 0,
                    height: widget.height | 0,
                    text: widget.text,
                })),
        setTerrainOverlay: (tile, overlay, shape, rotation) => {
            const renderer = terrainHost(client);
            if (!renderer) return;
            renderer.terrainOverrides.set(`${tile.tileX},${tile.tileY},${tile.plane}`, {
                overlay: overlay | 0,
                shape: shape | 0,
                rotation: rotation & 0x3,
            });
            reloadTile(renderer, tile);
        },
        clearTerrainOverride: (tile) => {
            const renderer = terrainHost(client);
            if (!renderer) return;
            renderer.terrainOverrides.delete(`${tile.tileX},${tile.tileY},${tile.plane}`);
            reloadTile(renderer, tile);
        },
        despawnNpc: (serverId) => {
            // Dev-only: reuse the server despawn path rather than duplicating
            // the ECS/world-view teardown it performs.
            (client as unknown as { despawnNpcBinary(serverId: number): void }).despawnNpcBinary(
                serverId,
            );
        },
    });

    return plugin;
}

/**
 * Terrain edits go straight into the renderer's override map and then force a
 * full map-square reload, the same route applyGamemodeWorldLocs takes.
 */
type TerrainHost = {
    terrainOverrides: Map<
        string,
        { underlay?: number; overlay?: number; shape?: number; rotation?: number }
    >;
    pendingLocUpdates: Set<number>;
    getMapIdForWorldTile(x: number, y: number): number;
    scheduleLocReload(mapX: number, mapY: number): void;
};

function terrainHost(client: OsrsClient): TerrainHost | undefined {
    const renderer = client.renderer as unknown as TerrainHost | undefined;
    return renderer && renderer.terrainOverrides ? renderer : undefined;
}

function reloadTile(renderer: TerrainHost, tile: EditModeTile): void {
    const mapId = renderer.getMapIdForWorldTile(tile.tileX, tile.tileY);
    renderer.pendingLocUpdates.add(mapId);
    renderer.scheduleLocReload(mapId >> 8, mapId & 0xff);
}

/**
 * Puts the camera on the tile at ground level, then pulls it back along its own
 * view ray so the tile sits mid-screen - the same shape as the follow camera's
 * orbit, which is what makes the view read as a normal RS one.
 */
function frameCameraOnTile(client: OsrsClient, tile: EditModeTile, resetAngles: boolean): void {
    const camera = client.camera;
    if (resetAngles) {
        camera.snapToYaw(EDITOR_CAMERA_YAW);
        camera.snapToPitch(EDITOR_CAMERA_PITCH);
    }

    const centreX = tile.tileX + 0.5;
    const centreZ = tile.tileY + 0.5;
    const renderer = client.renderer as unknown as
        | { sampleHeightAtExactPlane?: (x: number, z: number, plane: number) => number }
        | undefined;
    const height = renderer?.sampleHeightAtExactPlane?.(centreX, centreZ, tile.plane);

    camera.snapToPosition(
        centreX,
        typeof height === "number" && Number.isFinite(height) ? height : undefined,
        centreZ,
    );
    camera.move(0, 0, EDITOR_CAMERA_DISTANCE, true);
}

type SavedViewSettings = {
    fov: { low: number; high: number };
    renderDistance: number;
    lodDistance: number;
};

let savedViewSettings: SavedViewSettings | undefined;

/** Swaps in the editor's flatter projection and a draw distance to match. */
function applyEditorViewSettings(client: OsrsClient): void {
    if (savedViewSettings) return;
    savedViewSettings = {
        fov: client.camera.getViewportFovValues(),
        renderDistance: client.renderDistance,
        lodDistance: client.lodDistance,
    };
    client.camera.setViewportFovValues(EDITOR_CAMERA_FOV, EDITOR_CAMERA_FOV);
    client.renderDistance = EDITOR_DRAW_DISTANCE;
    client.lodDistance = Math.max(0, EDITOR_DRAW_DISTANCE - 2);
}

function restoreViewSettings(client: OsrsClient): void {
    const saved = savedViewSettings;
    if (!saved) return;
    savedViewSettings = undefined;
    client.camera.setViewportFovValues(saved.fov.low, saved.fov.high);
    client.renderDistance = saved.renderDistance;
    client.lodDistance = saved.lodDistance;
}

let nextEditorNpcServerId = EDITOR_NPC_SERVER_ID_BASE;

/**
 * Spawns a cache NPC through the same path the server's NPC add stream uses,
 * so ECS state, movement sync and geometry streaming all stay consistent.
 * ponytail: synthetic ids start at 60000, collide only if the server ever
 * hands out ids that high.
 */
function spawnEditorNpc(
    client: OsrsClient,
    npcTypeId: number,
    tile: EditModeTile,
    rotation: number,
): number | undefined {
    const spawnNpcBinary = (
        client as unknown as {
            spawnNpcBinary(
                spawn: {
                    npcId: number;
                    typeId: number;
                    tileX: number;
                    tileY: number;
                    level: number;
                    rot: number;
                    teleport: boolean;
                    worldViewId: number;
                },
                loopCycle: number,
            ): void;
        }
    ).spawnNpcBinary;
    if (typeof spawnNpcBinary !== "function") return undefined;

    const serverId = nextEditorNpcServerId++;
    spawnNpcBinary.call(
        client,
        {
            npcId: serverId,
            typeId: npcTypeId | 0,
            tileX: tile.tileX | 0,
            tileY: tile.tileY | 0,
            level: tile.plane | 0,
            // Cache rotations are 0-3; the client stores angles in 0-2047.
            rot: (rotation & 0x3) * 512,
            teleport: true,
            worldViewId: -1,
        },
        0,
    );
    return serverId;
}
