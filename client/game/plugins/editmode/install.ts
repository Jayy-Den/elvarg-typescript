import { ClientState } from "../../ClientState";
import type { App as PicoApp, UniformBuffer } from "picogl";
import type { Ray } from "../../math/Raycast";
import type { SceneRaycastHit, SceneRaycaster } from "../../scene/SceneRaycaster";
import { MenuTargetType } from "../../../rs/MenuEntry";
import { IndexType } from "../../../rs/cache/IndexType";
import { packWorldMapCoord } from "../../../rs/map/WorldMapArea";
import { SpriteLoader } from "../../../rs/sprite/SpriteLoader";
import { InteractType } from "../../../render/InteractType";
import type { MinimapIcon } from "../../../render/loader/SdMapData";
import { isDoorLocType } from "../../../render/loc/SceneLocs";
import type {
    InteractHighlightTarget,
    LocHighlightTarget,
} from "../../../render/render/constants";
import type { InteractHighlightDrawTarget } from "../../../ui/devoverlay/InteractHighlightOverlay";
import { spriteToCanvas } from "../../../ui/item/ItemIcon";
import type { OsrsClient } from "../../OsrsClient";
import { createBrowserEditModePluginPersistence } from "./BrowserEditModePluginPersistence";
import { detectRectangularBuilding, type DetectedBuilding } from "./BuildingDetector";
import { EditModePlugin } from "./EditModePlugin";
import {
    MapIconGroundOverlay,
    type MapIconGroundEntry,
} from "./MapIconGroundOverlay";
import type {
    EditModeDefinitionSummary,
    EditModeEdit,
    EditModeSearchKind,
    EditModeSearchResult,
    EditModeShop,
    EditModeTile,
} from "./types";

/** Synthetic server ids for editor NPCs, kept clear of the server's own range. */
const EDITOR_NPC_SERVER_ID_BASE = 60000;
const EDITOR_NPC_PREVIEW_SERVER_ID = 59999;
const EDITOR_SELECTION_TILE_SLOT = 255;
const EDITOR_SELECTION_TILE_GROUP = 255;
const EDITOR_HOVER_TILE_SLOT = 254;
const EDITOR_HOVER_TILE_GROUP = 254;
const EDITOR_SELECTION_MAX_SPAN = 128;
const SEARCH_RESULT_LIMIT = 60;
/** North-up at the standard RS working angle: the title-screen preset sits off-axis and reads as skewed. */
const EDITOR_CAMERA_YAW = 0;
const EDITOR_CAMERA_PITCH = 210;

/** Reuses the scene's exact model picker, but includes scenery hidden from the game menu. */
export function raycastEditScene(
    raycaster: SceneRaycaster,
    ray: Ray,
    basePlane?: number,
): SceneRaycastHit | undefined {
    const editorRaycaster = raycaster as unknown as {
        raycast: SceneRaycaster["raycast"];
        isLocTypeInteractive?: (locType: unknown) => boolean;
    };
    const originalFilter = editorRaycaster.isLocTypeInteractive;
    try {
        if (originalFilter) editorRaycaster.isLocTypeInteractive = () => true;
        return editorRaycaster
            .raycast(ray, { maxDistance: 4096, maxHits: 1000, basePlane })
            .find(
                (hit) =>
                    hit.interactType === InteractType.LOC ||
                    (hit.interactType === InteractType.NPC && hit.playerEcsIndex === undefined),
            );
    } finally {
        if (originalFilter) editorRaycaster.isLocTypeInteractive = originalFilter;
    }
}
/** Tiles the camera pulls back along its view ray when framing a tile. */
const EDITOR_CAMERA_DISTANCE = 22;
const WIDGET_SUMMARY_LIMIT = 200;
/** Types decoded per frame while indexing, so the client keeps rendering. */
const INDEX_CHUNK = 2000;

type NameIndex = ReadonlyArray<EditModeSearchResult>;

interface NamedTypeLoader {
    getCount(): number;
    load(id: number): { name?: string } | undefined;
    clearCache(): void;
}

const indexes = new Map<EditModeSearchKind, NameIndex>();
const indexPromises = new Map<EditModeSearchKind, Promise<NameIndex>>();

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

function getNameIndex(kind: EditModeSearchKind, loader: NamedTypeLoader): Promise<NameIndex> {
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

function displayValue(value: unknown): string {
    if (value instanceof Map) return JSON.stringify(Object.fromEntries(value));
    if (Array.isArray(value)) return value.filter((entry) => entry != null).join(", ") || "—";
    if (value == null || value === "") return "—";
    return String(value);
}

const DEFINITION_FIELDS: Record<EditModeSearchKind, string[]> = {
    npc: [
        "modelIds",
        "size",
        "combatLevel",
        "actions",
        "idleSeqId",
        "walkSeqId",
        "attackLevel",
        "defenceLevel",
        "strengthLevel",
        "hitpoints",
        "rangedLevel",
        "magicLevel",
        "attackSpeed",
        "transforms",
    ],
    loc: [
        "models",
        "types",
        "sizeX",
        "sizeY",
        "actions",
        "clipType",
        "blocksProjectile",
        "seqId",
        "mapFunctionId",
        "mapSceneId",
        "transforms",
    ],
    item: [
        "model",
        "examine",
        "price",
        "stackability",
        "isMembers",
        "isTradable",
        "weight",
        "groundActions",
        "inventoryActions",
        "wearPos",
        "note",
        "placeholder",
    ],
};

function describeDefinition(
    client: OsrsClient,
    kind: EditModeSearchKind,
    id: number,
): EditModeDefinitionSummary | undefined {
    const loader = kind === "npc" ? client.npcTypeLoader : kind === "item" ? client.objTypeLoader : client.locTypeLoader;
    const definition = loader?.load(id) as unknown as Record<string, unknown> | undefined;
    if (!definition) return undefined;
    return {
        id,
        kind,
        name: String(definition.name || "Unnamed"),
        fields: DEFINITION_FIELDS[kind].map((field) => [field, displayValue(definition[field])]),
    };
}

async function loadShops(client: OsrsClient): Promise<EditModeShop[]> {
    const response = await fetch(`http://${window.location.hostname || "127.0.0.1"}:49600/shops`);
    if (!response.ok) throw new Error(`Shop API returned ${response.status}`);
    const shops = (await response.json()) as EditModeShop[];
    return shops.map((shop) => ({
        ...shop,
        originalStock: shop.originalStock.map((item) => ({
            ...item,
            name: client.objTypeLoader?.load(item.id)?.name ?? `Item ${item.id}`,
        })),
    }));
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
    let previewLoc: EditModeEdit | undefined;
    let previewNpc = false;
    let buildingPreviewTileKey: string | undefined;
    let placementModelHighlight: InteractHighlightDrawTarget | undefined;
    let pointerModelHighlight: InteractHighlightDrawTarget | undefined;
    let buildingModelHighlight: InteractHighlightDrawTarget | undefined;
    let buildingSelectionHighlight: InteractHighlightDrawTarget | undefined;
    let buildingHighlightRenderer: TerrainHost | undefined;
    let heightLevelRenderer: TerrainHost | undefined;
    let editorPickCache:
        | {
              renderer: TerrainHost;
              frame: number;
              x: number;
              y: number;
              pick: { tile: EditModeTile; target?: InteractHighlightTarget } | undefined;
          }
        | undefined;
    let mapIconFrame: number | undefined;
    let mapIconTargets = new Map<string, LocHighlightTarget>();
    let mapIconGroundOverlay: MapIconGroundOverlay | undefined;
    let mapIconGroundManager: TerrainHost["overlayManager"];
    const mapIconSprites = new Map<number, HTMLCanvasElement>();
    const mapIconLocs = new WeakMap<MinimapIcon, { locId: number; rotation?: number } | null>();
    let previousInteractHighlightConfig:
        | ReturnType<typeof client.interactHighlightPlugin.getConfig>
        | undefined;

    const clearPlacementPreview = (): void => {
        placementModelHighlight = undefined;
        if (previewNpc) {
            despawnEditorNpc(client, EDITOR_NPC_PREVIEW_SERVER_ID);
            previewNpc = false;
        }
        previewLoc = undefined;
    };
    const clearPointerPreview = (): void => {
        buildingPreviewTileKey = undefined;
        pointerModelHighlight = undefined;
        buildingModelHighlight = undefined;
        client.tileHighlightManager.clear(EDITOR_HOVER_TILE_SLOT);
        terrainHost(client)?.clearInteractHighlightHoverTarget();
    };
    const configureInteractHighlight = (): void => {
        if (!previousInteractHighlightConfig) {
            previousInteractHighlightConfig = {
                ...client.interactHighlightPlugin.getConfig(),
            };
        }
        Object.assign(client.interactHighlightPlugin.getConfig(), {
            enabled: true,
            showHover: true,
            showInteract: true,
            hoverColor: 0xffffff,
            interactColor: 0xffffff,
        });
    };
    const clearSelectionHighlight = (): void => {
        clearPointerPreview();
        buildingSelectionHighlight = undefined;
        client.tileHighlightManager.clear(EDITOR_SELECTION_TILE_SLOT);
        const renderer = terrainHost(client);
        renderer?.clearInteractHighlightActiveTarget();
        if (previousInteractHighlightConfig) {
            Object.assign(
                client.interactHighlightPlugin.getConfig(),
                previousInteractHighlightConfig,
            );
            previousInteractHighlightConfig = undefined;
        }
    };
    const getMapIconSprite = (spriteId: number): HTMLCanvasElement | undefined => {
        const cached = mapIconSprites.get(spriteId);
        if (cached) return cached;
        try {
            const sprite = SpriteLoader.loadIntoIndexedSprite(
                client.cacheSystem.getIndex(IndexType.DAT2.sprites),
                spriteId,
            );
            if (!sprite) return undefined;
            const canvas = spriteToCanvas(sprite);
            mapIconSprites.set(spriteId, canvas);
            return canvas;
        } catch {
            return undefined;
        }
    };
    const resolveMapIconTarget = (
        renderer: TerrainHost,
        icon: MinimapIcon,
        tileX: number,
        tileY: number,
        plane: number,
    ): LocHighlightTarget | undefined => {
        const cached = mapIconLocs.get(icon);
        if (cached === null) return undefined;
        if (cached) {
            return {
                kind: "loc",
                locId: cached.locId,
                tileX,
                tileY,
                plane,
                locModelType: 22,
                locRotation: cached.rotation,
            };
        }
        const loc = renderer.getLocIdsAtTileAllLevels(tileX, tileY).find((candidate) => {
            if (candidate.level !== plane || ((candidate.typeRot ?? -1) & 0x3f) !== 22) {
                return false;
            }
            const base = client.locTypeLoader.load(candidate.id);
            const type = base?.transforms
                ? base.transform(client.varManager, client.locTypeLoader)
                : base;
            return type?.mapFunctionId === icon.elementId;
        });
        if (!loc) {
            mapIconLocs.set(icon, null);
            return undefined;
        }
        const rotation = loc.typeRot === undefined ? undefined : (loc.typeRot >>> 6) & 3;
        mapIconLocs.set(icon, { locId: loc.id, rotation });
        return {
            kind: "loc",
            locId: loc.id,
            tileX,
            tileY,
            plane,
            locModelType: 22,
            locRotation: rotation,
        };
    };
    const ensureMapIconGroundOverlay = (
        renderer: TerrainHost,
    ): MapIconGroundOverlay | undefined => {
        if (!renderer.overlayManager || !renderer.app || !renderer.sceneUniformBuffer) {
            return undefined;
        }
        if (mapIconGroundManager === renderer.overlayManager) return mapIconGroundOverlay;
        const overlay = new MapIconGroundOverlay();
        overlay.init({ app: renderer.app, sceneUniforms: renderer.sceneUniformBuffer });
        renderer.overlayManager.add(overlay);
        mapIconGroundManager = renderer.overlayManager;
        mapIconGroundOverlay = overlay;
        return overlay;
    };
    const drawMapIcons = (): void => {
        mapIconFrame = undefined;
        const state = plugin.getState();
        if (!state.config.showMapIcons || !state.config.active) {
            mapIconGroundOverlay?.setEntries([]);
            mapIconTargets.clear();
            return;
        }
        const renderer = terrainHost(client);
        if (renderer) {
            const entries: MapIconGroundEntry[] = [];
            const targets = new Map<string, LocHighlightTarget>();
            const maxPlane = state.config.renderAllHeightLevels ? 3 : state.config.heightLevel;
            const cullTile = renderer.getRenderCullTile();
            const renderDistance = renderer.getFrameRenderDistanceTiles();
            for (let plane = 0; plane <= maxPlane; plane++) {
                for (let i = 0; i < renderer.mapManager.visibleMapCount; i++) {
                    const map = renderer.mapManager.visibleMaps[i];
                    if (
                        !renderer.isMapWithinRenderDistance(
                            map,
                            cullTile.x,
                            cullTile.y,
                            renderDistance,
                            0,
                        )
                    ) {
                        continue;
                    }
                    const icons = renderer.getMinimapIcons(map.mapX, map.mapY, plane) ?? [];
                    const baseX = map.getRenderBaseWorldX?.() ?? map.mapX * 64;
                    const baseY = map.getRenderBaseWorldY?.() ?? map.mapY * 64;
                    for (const icon of icons) {
                        const tileX = (baseX + icon.localX) | 0;
                        const tileY = (baseY + icon.localY) | 0;
                        const target = resolveMapIconTarget(renderer, icon, tileX, tileY, plane);
                        const sprite = getMapIconSprite(icon.spriteId);
                        if (!target || !sprite) continue;
                        entries.push({ spriteId: icon.spriteId, sprite, tileX, tileY, plane });
                        targets.set(`${tileX}:${tileY}:${plane}`, target);
                    }
                }
            }
            mapIconTargets = targets;
            ensureMapIconGroundOverlay(renderer)?.setEntries(entries);
        }
        mapIconFrame = requestAnimationFrame(drawMapIcons);
    };
    const syncMapIconLoop = (): void => {
        const state = plugin.getState();
        if (state.config.showMapIcons && state.config.active) {
            if (mapIconFrame === undefined) mapIconFrame = requestAnimationFrame(drawMapIcons);
            return;
        }
        if (mapIconFrame !== undefined) cancelAnimationFrame(mapIconFrame);
        mapIconFrame = undefined;
        mapIconGroundOverlay?.setEntries([]);
        mapIconTargets.clear();
    };
    const selectTileRange = (start: EditModeTile, end: EditModeTile) => {
        clearSelectionHighlight();
        const limit = EDITOR_SELECTION_MAX_SPAN - 1;
        const endX = Math.max(start.tileX - limit, Math.min(start.tileX + limit, end.tileX));
        const endY = Math.max(start.tileY - limit, Math.min(start.tileY + limit, end.tileY));
        const minX = Math.min(start.tileX, endX);
        const maxX = Math.max(start.tileX, endX);
        const minY = Math.min(start.tileY, endY);
        const maxY = Math.max(start.tileY, endY);
        client.tileHighlightManager.configure(
            EDITOR_SELECTION_TILE_SLOT,
            0xffffff,
            2,
            12,
            0,
        );
        for (let x = minX; x <= maxX; x++) {
            for (let y = minY; y <= maxY; y++) {
                client.tileHighlightManager.set(
                    packWorldMapCoord({ x, y, plane: start.plane }),
                    EDITOR_SELECTION_TILE_SLOT,
                    EDITOR_SELECTION_TILE_GROUP,
                );
            }
        }
        return {
            kind: "ground" as const,
            ...start,
            locId: -1,
            locName: "",
            tileEndX: endX,
            tileEndY: endY,
        };
    };
    const resolveEditScenePick = (renderer: TerrainHost) => {
        const x = client.inputManager.mouseX;
        const y = client.inputManager.mouseY;
        if (
            editorPickCache?.renderer === renderer &&
            editorPickCache.frame === renderer.currentFrameCount &&
            editorPickCache.x === x &&
            editorPickCache.y === y
        ) {
            return editorPickCache.pick;
        }
        const ray = renderer.screenToRay(x, y);
        const hit =
            ray && renderer.sceneRaycaster
                ? raycastEditScene(
                      renderer.sceneRaycaster as SceneRaycaster,
                      ray,
                      renderer.getPlayerRawPlane(),
                  )
                : undefined;
        let pick: { tile: EditModeTile; target?: InteractHighlightTarget } | undefined;
        if (hit?.tileX !== undefined && hit.tileY !== undefined) {
            if (hit.interactType === InteractType.NPC && hit.npcServerId !== undefined) {
                const target = renderer.resolveNpcHighlightTargetFromServerId(hit.npcServerId);
                pick = {
                    tile: {
                        tileX: hit.tileX,
                        tileY: hit.tileY,
                        plane: target?.plane ?? renderer.getPlayerRawPlane(),
                    },
                    target,
                };
            } else if (hit.interactType === InteractType.LOC) {
                const playerPlane = renderer.getPlayerRawPlane();
                const loc = renderer
                    .getLocIdsAtTileAllLevels(hit.tileX, hit.tileY)
                    .filter(({ id }) => id === hit.interactId)
                    .sort(
                        (a, b) =>
                            Math.abs(a.level - playerPlane) - Math.abs(b.level - playerPlane),
                    )[0];
                if (loc) {
                    const typeRot = loc.typeRot;
                    pick = {
                        tile: { tileX: hit.tileX, tileY: hit.tileY, plane: loc.level },
                        target: {
                            kind: "loc",
                            locId: hit.interactId,
                            tileX: hit.tileX,
                            tileY: hit.tileY,
                            plane: loc.level,
                            locModelType: typeRot === undefined ? undefined : typeRot & 0x3f,
                            locRotation: typeRot === undefined ? undefined : (typeRot >>> 6) & 3,
                        },
                    };
                }
            }
        }
        if (!pick && plugin.getConfig().showMapIcons) {
            const tile = renderer.computeTileAt(x, y);
            const plane = plugin.getConfig().heightLevel;
            const iconTarget = tile && mapIconTargets.get(`${tile.tileX}:${tile.tileY}:${plane}`);
            if (iconTarget) {
                pick = {
                    tile: { tileX: iconTarget.tileX, tileY: iconTarget.tileY, plane },
                    target: iconTarget,
                };
            }
        }
        editorPickCache = { renderer, frame: renderer.currentFrameCount, x, y, pick };
        return pick;
    };
    const resolvePointerTarget = () => {
        const renderer = terrainHost(client);
        return { renderer, target: renderer && resolveEditScenePick(renderer)?.target };
    };
    const ensureBuildingHighlightRenderer = (renderer: TerrainHost): void => {
        if (buildingHighlightRenderer === renderer) return;
        buildingHighlightRenderer = renderer;
        const getBaseTargets = renderer.getInteractHighlightDrawTargets.bind(renderer);
        renderer.getInteractHighlightDrawTargets = () => {
            const targets = getBaseTargets() as InteractHighlightDrawTarget[];
            const editHighlight =
                buildingModelHighlight ??
                pointerModelHighlight ??
                placementModelHighlight ??
                buildingSelectionHighlight;
            if (editHighlight) targets.splice(0, targets.length, editHighlight);
            else if (previewLoc) targets.length = 0;
            return targets;
        };
    };
    const ensureHeightLevelRenderer = (renderer: TerrainHost): void => {
        if (heightLevelRenderer === renderer) return;
        heightLevelRenderer = renderer;
        const getBasePlane = renderer.getPlayerRawPlane.bind(renderer);
        const getBaseRoofPlaneLimit = renderer.getRoofPlaneLimit.bind(renderer);
        const shouldRenderNpc = renderer.shouldRenderNpcFromMap.bind(renderer);
        const shouldRenderPlayer = renderer.shouldRenderPlayerIndex.bind(renderer);
        const drawBase = renderer.drawWithRoofPlaneFilter.bind(renderer);
        const visiblePlaneRanges: PlaneDrawRange[] = [];
        const isEditing = () => {
            const state = plugin.getState();
            return state.config.enabled && (state.config.active || state.scenePreview);
        };
        renderer.getPlayerRawPlane = () =>
            isEditing() ? plugin.getConfig().heightLevel : getBasePlane();
        renderer.getRoofPlaneLimit = () =>
            isEditing()
                ? plugin.getConfig().renderAllHeightLevels
                    ? 3
                    : plugin.getConfig().heightLevel
                : getBaseRoofPlaneLimit();
        renderer.shouldRenderNpcFromMap = (map, ecsId) =>
            shouldRenderNpc(map, ecsId) &&
            (plugin.getConfig().renderAllHeightLevels ||
                !isEditing() ||
                (client.npcEcs.getLevel(ecsId) | 0) <= plugin.getConfig().heightLevel);
        renderer.shouldRenderPlayerIndex = (ecsId) =>
            shouldRenderPlayer(ecsId) &&
            (plugin.getConfig().renderAllHeightLevels ||
                !isEditing() ||
                (client.playerEcs.getLevel(ecsId) | 0) <= plugin.getConfig().heightLevel);
        renderer.drawWithRoofPlaneFilter = (drawCall, drawRanges, drawRangePlanes, limit) => {
            const config = plugin.getConfig();
            if (!isEditing() || config.renderAllHeightLevels || !drawRangePlanes) {
                drawBase(drawCall, drawRanges, drawRangePlanes, limit);
                return;
            }
            visiblePlaneRanges.length = 0;
            for (let i = 0; i < drawRanges.length; i++) {
                if ((drawRangePlanes[i] | 0) <= config.heightLevel) {
                    visiblePlaneRanges.push(drawRanges[i]);
                }
            }
            drawBase(drawCall, visiblePlaneRanges, undefined, 3);
        };
    };
    const analyseBuilding = (tile: EditModeTile) => {
        const renderer = terrainHost(client);
        if (!renderer) return undefined;
        const building = detectRectangularBuilding(
            tile.tileX,
            tile.tileY,
            (x, y) => renderer.getLocIdsAtTileAllLevels(x, y),
            (id) => {
                const type = client.locTypeLoader.load(id);
                return !!type && isDoorLocType(type);
            },
        );
        if (!building) return undefined;

        ensureBuildingHighlightRenderer(renderer);
        const trianglePoints: Array<readonly [number, number, number]> = [];
        const seen = new Set<string>();
        let objectCount = 0;
        let wallCount = 0;
        let doorCount = 0;
        let roofCount = 0;
        let decorationCount = 0;
        const roofTiles = new Set(building.tiles.map(({ x, y }) => `${x}:${y}`));
        const perimeterTiles = new Set(
            building.tiles
                .filter(({ x, y }) =>
                    [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].some(
                        ([nextX, nextY]) => !roofTiles.has(`${nextX}:${nextY}`),
                    ),
                )
                .map(({ x, y }) => `${x}:${y}`),
        );
        const continuesOutside = (
            id: number,
            level: number,
            x: number,
            y: number,
        ): boolean => {
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    if ((!dx && !dy) || roofTiles.has(`${x + dx}:${y + dy}`)) continue;
                    if (
                        renderer.getLocIdsAtTileAllLevels(x + dx, y + dy).some((candidate) => {
                            const type = (candidate.typeRot ?? -1) & 0x3f;
                            return (
                                candidate.id === id &&
                                candidate.level === level &&
                                (type <= 3 || type === 9)
                            );
                        })
                    ) {
                        return true;
                    }
                }
            }
            return false;
        };
        for (let plane = building.minPlane; plane <= building.maxPlane; plane++) {
            for (const { x, y } of building.structureTiles) {
                for (const loc of renderer.getLocIdsAtTileAllLevels(x, y)) {
                    if (loc.level !== plane || loc.typeRot === undefined) continue;
                    const modelType = loc.typeRot & 0x3f;
                    const wallLike = modelType <= 3 || modelType === 9;
                    const locType = wallLike ? client.locTypeLoader.load(loc.id) : undefined;
                    const door = !!locType && isDoorLocType(locType);
                    if (perimeterTiles.has(`${x}:${y}`) && (modelType === 10 || modelType === 22)) {
                        continue;
                    }
                    if (
                        wallLike &&
                        loc.id !== building.wallId &&
                        !door &&
                        perimeterTiles.has(`${x}:${y}`) &&
                        continuesOutside(loc.id, loc.level, x, y)
                    ) {
                        continue;
                    }
                    if (
                        !roofTiles.has(`${x}:${y}`) &&
                        !wallLike &&
                        !(modelType >= 4 && modelType <= 8)
                    ) {
                        continue;
                    }
                    const key = `${loc.id}:${x}:${y}:${plane}:${loc.typeRot}`;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    objectCount++;
                    if (door) doorCount++;
                    else if (wallLike) wallCount++;
                    else if (modelType >= 4 && modelType <= 8) decorationCount++;
                    else if (modelType >= 12 && modelType <= 21) roofCount++;
                    const points = renderer.buildHighlightTrianglePoints({
                        kind: "loc",
                        locId: loc.id,
                        tileX: x,
                        tileY: y,
                        plane,
                        locModelType: modelType,
                        locRotation: (loc.typeRot >>> 6) & 3,
                    });
                    if (points) trianglePoints.push(...points);
                }
            }
        }
        return {
            building,
            highlight: trianglePoints.length
                ? ({ trianglePoints, color: 0xffffff, alpha: 0.45 } as InteractHighlightDrawTarget)
                : undefined,
            objectCount,
            wallCount,
            doorCount,
            roofCount,
            decorationCount,
        };
    };
    const setBuildingTileFallback = (building: DetectedBuilding, slot: number): void => {
        client.tileHighlightManager.configure(slot, 0xffffff, 2, 12, 0);
        for (let plane = building.minPlane; plane <= building.maxPlane; plane++) {
            for (const { x, y } of building.tiles) {
                client.tileHighlightManager.set(packWorldMapCoord({ x, y, plane }), slot, slot);
            }
        }
    };

    plugin.attach({
        getCanvas: () => client.renderer?.canvas as HTMLCanvasElement | undefined,
        getCameraTile: () => ({
            tileX: Math.round(client.camera.getPosX()),
            tileY: Math.round(client.camera.getPosZ()),
            plane: plugin.getConfig().heightLevel,
        }),
        getPointerTile: () => {
            const renderer = terrainHost(client);
            if (renderer) ensureHeightLevelRenderer(renderer);
            const scenePick =
                renderer && plugin.getConfig().tool === "select"
                    ? resolveEditScenePick(renderer)
                    : undefined;
            if (scenePick) return scenePick.tile;
            // Fresh terrain fallback: hoveredTile can lag a frame after camera movement.
            const tile =
                renderer?.computeTileAt?.(client.inputManager.mouseX, client.inputManager.mouseY) ??
                client.hoveredTile;
            if (!tile) return undefined;
            return {
                tileX: tile.tileX | 0,
                tileY: tile.tileY | 0,
                plane: plugin.getConfig().heightLevel,
            };
        },
        previewPointer: (tile) => {
            clearPointerPreview();
            configureInteractHighlight();
            const { renderer, target } = resolvePointerTarget();
            if (renderer && target) {
                ensureBuildingHighlightRenderer(renderer);
                const trianglePoints = renderer.buildHighlightTrianglePoints(target);
                if (trianglePoints && trianglePoints.length >= 3) {
                    pointerModelHighlight = { trianglePoints, color: 0xffffff, alpha: 0.45 };
                    return;
                }
            }
            client.tileHighlightManager.configure(
                EDITOR_HOVER_TILE_SLOT,
                0xffffff,
                2,
                12,
                0,
            );
            client.tileHighlightManager.set(
                packWorldMapCoord({ x: tile.tileX, y: tile.tileY, plane: tile.plane }),
                EDITOR_HOVER_TILE_SLOT,
                EDITOR_HOVER_TILE_GROUP,
            );
        },
        previewBuilding: (tile) => {
            const tileKey = `${tile.tileX}:${tile.tileY}:${tile.plane}`;
            if (buildingPreviewTileKey === tileKey) return;
            clearPointerPreview();
            const analysis = analyseBuilding(tile);
            if (!analysis) return;
            buildingPreviewTileKey = tileKey;
            configureInteractHighlight();
            buildingModelHighlight = analysis.highlight;
            if (!analysis.highlight) setBuildingTileFallback(analysis.building, EDITOR_HOVER_TILE_SLOT);
        },
        selectBuilding: (tile) => {
            clearSelectionHighlight();
            const analysis = analyseBuilding(tile);
            if (!analysis) return undefined;
            configureInteractHighlight();
            const building = analysis.building;
            buildingSelectionHighlight = analysis.highlight;
            if (!analysis.highlight) {
                setBuildingTileFallback(building, EDITOR_SELECTION_TILE_SLOT);
            }
            const width = building.maxX - building.minX + 1;
            const depth = building.maxY - building.minY + 1;
            const floors = Math.max(1, building.maxPlane - building.minPlane);
            return {
                kind: "building" as const,
                tileX: building.minX,
                tileY: building.minY,
                plane: building.minPlane,
                tileEndX: building.maxX,
                tileEndY: building.maxY,
                planeEnd: building.maxPlane,
                locId: -1,
                locName: "",
                buildingWidth: width,
                buildingDepth: depth,
                buildingFloors: floors,
                buildingTileCount: building.tiles.length * floors,
                buildingShape: building.shape,
                buildingObjectCount: analysis.objectCount,
                buildingWallCount: analysis.wallCount,
                buildingDoorCount: analysis.doorCount,
                buildingRoofCount: analysis.roofCount,
                buildingDecorationCount: analysis.decorationCount,
                buildingOtherCount:
                    analysis.objectCount -
                    analysis.wallCount -
                    analysis.doorCount -
                    analysis.roofCount -
                    analysis.decorationCount,
                buildingWallId: building.wallId,
            };
        },
        clearPointerPreview,
        getPointerLoc: () => {
            const entry = client.menuEntries.find(
                (candidate) => candidate.targetType === MenuTargetType.LOC,
            );
            return entry ? { locId: entry.targetId | 0, locName: entry.targetName } : undefined;
        },
        selectPointer: (tile) => {
            clearSelectionHighlight();
            const { renderer, target } = resolvePointerTarget();
            if (renderer && target) {
                configureInteractHighlight();
                renderer.interactHighlightActiveTarget = target;
                renderer.interactHighlightActiveFromInteraction = false;
                renderer.interactHighlightClickTick = -1;
                if (target.kind === "loc") {
                    return {
                        kind: "loc" as const,
                        tileX: target.tileX,
                        tileY: target.tileY,
                        plane: target.plane,
                        locId: target.locId,
                        locName: client.locTypeLoader.load(target.locId)?.name ?? "",
                    };
                }
                const npcTile = renderer.getNpcWorldTile(target.ecsId);
                return {
                    kind: "npc" as const,
                    tileX: npcTile.x,
                    tileY: npcTile.y,
                    plane: target.plane,
                    locId: target.npcTypeId,
                    locName:
                        client.npcTypeLoader.load(target.npcTypeId)?.name ?? "",
                };
            }

            return selectTileRange(tile, tile);
        },
        afterNextSceneFrame: (callback) => {
            if (typeof requestAnimationFrame !== "function") {
                callback();
                return;
            }
            const frame = terrainHost(client)?.currentFrameCount;
            let attempts = 0;
            const wait = (): void => {
                if (terrainHost(client)?.currentFrameCount !== frame || ++attempts >= 3) callback();
                else requestAnimationFrame(wait);
            };
            requestAnimationFrame(wait);
        },
        selectTileRange,
        clearSelectionHighlight,
        setPlacementPreview: (kind, id, tile, shape, rotation) => {
            clearPlacementPreview();
            if (kind === "npc") {
                previewNpc =
                    spawnEditorNpc(client, id, tile, rotation, EDITOR_NPC_PREVIEW_SERVER_ID) !==
                    undefined;
                return;
            }

            const renderer = terrainHost(client);
            if (!renderer) return;
            previewLoc = {
                kind: "place",
                locId: id,
                ...tile,
                shape,
                rotation,
            };
            ensureBuildingHighlightRenderer(renderer);
            const trianglePoints = renderer.buildHighlightTrianglePoints({
                kind: "loc",
                locId: id,
                tileX: tile.tileX,
                tileY: tile.tileY,
                plane: tile.plane,
                locModelType: shape,
                locRotation: rotation,
            });
            if (trianglePoints && trianglePoints.length >= 3) {
                placementModelHighlight = { trianglePoints, color: 0xffffff, alpha: 0.45 };
            }
        },
        clearPlacementPreview,
        onLocAddChange: (locId, tile, level, shape, rotation) => {
            const renderer = terrainHost(client);
            renderer?.pendingLocUpdates.add(renderer.getMapIdForWorldTile(tile.x, tile.y));
            client.onLocAddChange(locId, tile, level, shape, rotation);
        },
        onLocDel: (tile, level, shape, rotation) => {
            const renderer = terrainHost(client);
            renderer?.pendingLocUpdates.add(renderer.getMapIdForWorldTile(tile.x, tile.y));
            client.onLocDel(tile, level, shape, rotation);
        },
        getLocName: (locId) => client.locTypeLoader?.load(locId)?.name ?? "",
        getNpcName: (npcTypeId) => client.npcTypeLoader?.load(npcTypeId)?.name ?? "",
        search: async (kind, query) => {
            const loader = (
                kind === "npc"
                    ? client.npcTypeLoader
                    : kind === "item"
                      ? client.objTypeLoader
                      : client.locTypeLoader
            ) as unknown as NamedTypeLoader | undefined;
            if (!loader) return [];
            return filterIndex(await getNameIndex(kind, loader), query);
        },
        describeDefinition: (kind, id) => describeDefinition(client, kind, id),
        listShops: () => loadShops(client),
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
            if (!enabled) return;
            // Logged out the camera still holds the title-screen angles and sits
            // 26 tiles up with nothing framed, which reads as a skewed world.
            frameCameraOnTile(
                client,
                {
                    tileX: Math.round(client.camera.getPosX()),
                    tileY: Math.round(client.camera.getPosZ()),
                    plane: plugin.getConfig().heightLevel,
                },
                true,
            );
        },
        setHeightLevel: () => {
            const renderer = terrainHost(client);
            if (renderer) ensureHeightLevelRenderer(renderer);
        },
        setRenderAllHeightLevels: () => {
            const renderer = terrainHost(client);
            if (renderer) ensureHeightLevelRenderer(renderer);
        },
        isLoggedIn: () => client.isLoggedIn(),
        jumpCameraToTile: (tile) => {
            frameCameraOnTile(client, tile, false);
        },
        rotateCamera: (deltaX, deltaY) => {
            const camera = client.camera;
            camera.updateYaw(camera.yaw, deltaX * 0.9);
            camera.updatePitch(camera.pitch, deltaY * 0.9);
        },
        cancelPendingClick: () => {
            const input = client.inputManager;
            input.clickMode1 = 0;
            input.clickMode2 = 0;
            input.clickMode3 = 0;
            input.saveClickX = -1;
            input.saveClickY = -1;
            // Drop the click cross too; the editor is not the game.
            ClientState.mouseCrossColor = 0;
            ClientState.mouseCrossState = 100;
        },
        levelCamera: () => {
            frameCameraOnTile(
                client,
                {
                    tileX: Math.round(client.camera.getPosX()),
                    tileY: Math.round(client.camera.getPosZ()),
                    plane: plugin.getConfig().heightLevel,
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
            despawnEditorNpc(client, serverId);
        },
    });

    plugin.subscribe(syncMapIconLoop);

    // Dev builds always offer the editor: the welcome screen's "Edit Mode"
    // button is the way in, and Ctrl+E arms it while logged in.
    plugin.setConfig({ enabled: true });
    return plugin;
}

/**
 * Terrain edits go straight into the renderer's override map and then force a
 * full map-square reload, the same route applyGamemodeWorldLocs takes.
 */
type TerrainHost = {
    currentFrameCount: number;
    app?: PicoApp;
    sceneUniformBuffer?: UniformBuffer;
    overlayManager?: { add(overlay: MapIconGroundOverlay): unknown };
    mapManager: {
        visibleMapCount: number;
        visibleMaps: Array<{
            mapX: number;
            mapY: number;
            getRenderBaseWorldX?(): number;
            getRenderBaseWorldY?(): number;
        }>;
    };
    screenToRay(mouseX: number, mouseY: number): Ray | null;
    computeTileAt(
        mouseX: number,
        mouseY: number,
    ): { tileX: number; tileY: number; plane: number } | undefined;
    sceneRaycaster: Pick<SceneRaycaster, "raycast"> | null;
    getPlayerRawPlane(): number;
    getRenderCullTile(): { x: number; y: number };
    getFrameRenderDistanceTiles(): number;
    isMapWithinRenderDistance(
        map: unknown,
        tileX: number,
        tileY: number,
        renderDistanceTiles: number,
        renderDistancePadTiles: number,
    ): boolean;
    getMinimapIcons(mapX: number, mapY: number, level?: number): MinimapIcon[] | undefined;
    sampleHeightAtExactPlane(worldX: number, worldY: number, plane: number): number;
    getRoofPlaneLimit(): number;
    shouldRenderNpcFromMap(map: unknown, ecsId: number): boolean;
    shouldRenderPlayerIndex(ecsId: number): boolean;
    drawWithRoofPlaneFilter(
        drawCall: unknown,
        drawRanges: PlaneDrawRange[],
        drawRangePlanes: Uint8Array | undefined,
        roofPlaneLimit: number,
    ): void;
    getInteractHighlightDrawTargets(): ReadonlyArray<InteractHighlightDrawTarget>;
    buildHighlightTrianglePoints(
        target: InteractHighlightTarget,
    ): ReadonlyArray<readonly [number, number, number]> | undefined;
    getLocIdsAtTileAllLevels(
        tileX: number,
        tileY: number,
    ): Array<{ id: number; level: number; typeRot?: number }>;
    interactHighlightActiveTarget?: InteractHighlightTarget;
    interactHighlightHoverTarget?: InteractHighlightTarget;
    interactHighlightActiveFromInteraction: boolean;
    interactHighlightClickTick: number;
    clearInteractHighlightActiveTarget(): void;
    clearInteractHighlightHoverTarget(): void;
    resolveInteractHighlightTargetFromEntry(
        entry:
            | {
                  targetType?: MenuTargetType;
                  targetId?: number;
                  mapX?: number;
                  mapY?: number;
              }
            | undefined,
        fallbackTile?: EditModeTile,
    ): InteractHighlightTarget | undefined;
    resolveNpcHighlightTargetFromServerId(serverId: number): InteractHighlightTarget | undefined;
    getNpcWorldTile(ecsId: number): { x: number; y: number };
    terrainOverrides: Map<
        string,
        { underlay?: number; overlay?: number; shape?: number; rotation?: number }
    >;
    pendingLocUpdates: Set<number>;
    getMapIdForWorldTile(x: number, y: number): number;
    scheduleLocReload(mapX: number, mapY: number): void;
};

type PlaneDrawRange = [number, number, number];

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
    forcedServerId?: number,
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

    const serverId = forcedServerId ?? nextEditorNpcServerId++;
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

function despawnEditorNpc(client: OsrsClient, serverId: number): void {
    (client as unknown as { despawnNpcBinary(serverId: number): void }).despawnNpcBinary(serverId);
}
