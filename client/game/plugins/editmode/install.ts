import { MenuTargetType } from "../../../rs/MenuEntry";
import type { OsrsClient } from "../../OsrsClient";
import { createBrowserEditModePluginPersistence } from "./BrowserEditModePluginPersistence";
import { EditModePlugin } from "./EditModePlugin";
import type { EditModePlaceKind, EditModeSearchResult, EditModeTile } from "./types";

/** Synthetic server ids for editor NPCs, kept clear of the server's own range. */
const EDITOR_NPC_SERVER_ID_BASE = 60000;
const SEARCH_RESULT_LIMIT = 60;
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
