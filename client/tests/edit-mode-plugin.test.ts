import assert from "node:assert/strict";

import { EditModePlugin } from "../game/plugins/editmode/EditModePlugin";
import { detectRectangularBuilding } from "../game/plugins/editmode/BuildingDetector";
import {
    parseEditModeWorldDefinition,
    raycastEditScene,
} from "../game/plugins/editmode/install";
import { InteractType } from "../render/InteractType";
import type { EditModePluginConfig } from "../game/plugins/editmode/types";
import { buildMapIconGroundVertices } from "../game/plugins/editmode/MapIconGroundOverlay";
import { buildRegionPack } from "../game/plugins/editmode/RegionPack";
import { buildZoneGroundGeometry } from "../game/plugins/editmode/ZoneGroundOverlay";

type Call = [string, ...unknown[]];

const parsedWorld = parseEditModeWorldDefinition({
    spawn: { x: 3089, y: 3524, z: 0 },
    zones: [
        { minX: 1, maxX: 2, minY: 3, maxY: 3, z: 0, tags: ["pvp"] },
    ],
});
assert.equal(parsedWorld.zones[0].tags[0], "pvp");
assert.throws(() =>
    parseEditModeWorldDefinition({
        spawn: { x: 0, y: 0, z: 0 },
        zones: [{ minX: 0, maxX: 1, minY: 0, maxY: 1, z: 0, tags: ["safe"] }],
    }),
);
const zoneGeometry = buildZoneGroundGeometry(
    [
        { minX: 1, maxX: 2, minY: 3, maxY: 3, plane: 0, colorRgb: 0xff0000, alpha: 0.07 },
        { minX: 1, maxX: 2, minY: 3, maxY: 3, plane: 0, colorRgb: 0xff0000, alpha: 0.07 },
    ],
    () => 0,
);
assert.equal(zoneGeometry.positions.length, 2 * 6 * 3, "overlapping same-tag zones render once");
assert.equal(zoneGeometry.colors.length, 2 * 6 * 4);
assert.ok(Math.abs(zoneGeometry.positions[1] + 0.05) < 0.000001, "zone overlays clear the terrain");

{
    const regionId = (48 << 8) | 55;
    const terrain = new Uint8Array(4 * 64 * 64 * 2);
    const objects = Uint8Array.of(101, 67, 40, 0, 0);
    const pack = buildRegionPack(
        regionId,
        40000,
        39999,
        objects,
        terrain,
        [
            {
                kind: "delete",
                locId: 0,
                tileX: 48 * 64 + 1,
                tileY: 55 * 64 + 2,
                plane: 0,
                shape: 10,
                rotation: 0,
            },
            {
                kind: "place",
                locId: 200,
                tileX: 48 * 64 + 3,
                tileY: 55 * 64 + 4,
                plane: 0,
                shape: 10,
                rotation: 2,
            },
            {
                kind: "terrain",
                locId: 2,
                tileX: 48 * 64 + 2,
                tileY: 55 * 64 + 3,
                plane: 1,
                shape: 1,
                rotation: 3,
            },
        ],
        true,
    );
    const view = new DataView(pack.buffer);
    assert.deepEqual(
        [
            view.getInt32(0),
            view.getInt32(4),
            view.getInt32(8),
            view.getInt32(12),
            view.getInt32(16),
        ],
        [1, 40000, 39999, 48, 55],
    );
    const objectLength = view.getInt32(20);
    assert.deepEqual(
        Array.from(pack.subarray(24, 24 + objectLength)),
        [128, 201, 128, 197, 42, 0, 0],
    );
    const terrainStart = 28 + objectLength;
    assert.equal(view.getInt32(24 + objectLength), terrain.length + 4);
    const editedTileOffset = (1 * 64 * 64 + 2 * 64 + 3) * 2;
    assert.deepEqual(
        Array.from(
            pack.subarray(terrainStart + editedTileOffset, terrainStart + editedTileOffset + 6),
        ),
        [0, 9, 0, 2, 0, 0],
    );
}

const buildingLocs = new Map<string, Array<{ id: number; level: number; typeRot: number }>>();
for (let x = 10; x <= 13; x++) {
    for (let y = 20; y <= 22; y++) {
        buildingLocs.set(`${x}:${y}`, [{ id: 500, level: x === 11 || x === 12 ? 2 : 1, typeRot: 12 }]);
    }
}
const addBuildingLoc = (x: number, y: number, id: number, typeRot: number): void => {
    const key = `${x}:${y}`;
    const locs = buildingLocs.get(key) ?? [];
    locs.push({ id, level: 0, typeRot });
    buildingLocs.set(key, locs);
};
for (let y = 20; y <= 22; y++) {
    addBuildingLoc(10, y, 100, 0);
    addBuildingLoc(13, y, 100, 2 << 6);
}
for (let x = 10; x <= 13; x++) {
    addBuildingLoc(x, 20, 100, 3 << 6);
    addBuildingLoc(x, 22, 100, 1 << 6);
}
addBuildingLoc(9, 21, 200, 2 << 6);
addBuildingLoc(9, 20, 100, 2 << 6);
const buildingBounds = (building: ReturnType<typeof detectRectangularBuilding>) =>
    building && {
        minX: building.minX,
        maxX: building.maxX,
        minY: building.minY,
        maxY: building.maxY,
        minPlane: building.minPlane,
        maxPlane: building.maxPlane,
        wallId: building.wallId,
        shape: building.shape,
        tiles: building.tiles.length,
    };
const expectedRectangle = {
    minX: 10,
    maxX: 13,
    minY: 20,
    maxY: 22,
    minPlane: 0,
    maxPlane: 2,
    wallId: 100,
    shape: "Rectangle",
    tiles: 12,
};
assert.deepEqual(
    buildingBounds(
        detectRectangularBuilding(11, 21, (x, y) => buildingLocs.get(`${x}:${y}`) ?? []),
    ),
    expectedRectangle,
);
const topMiddle = buildingLocs.get("11:22") ?? [];
buildingLocs.set(
    "11:22",
    topMiddle.filter((loc) => loc.id !== 100 || loc.typeRot !== (1 << 6)),
);
assert.deepEqual(
    buildingBounds(
        detectRectangularBuilding(11, 21, (x, y) => buildingLocs.get(`${x}:${y}`) ?? []),
    ),
    expectedRectangle,
);
buildingLocs.delete("11:21");
assert.equal(
    detectRectangularBuilding(11, 21, (x, y) => buildingLocs.get(`${x}:${y}`) ?? []),
    undefined,
);

const naveLocs = new Map<string, Array<{ id: number; level: number; typeRot: number }>>();
const addNaveLoc = (x: number, y: number, id: number, level: number, typeRot: number): void => {
    const key = `${x}:${y}`;
    const locs = naveLocs.get(key) ?? [];
    locs.push({ id, level, typeRot });
    naveLocs.set(key, locs);
};
for (let x = 0; x < 3; x++) {
    addNaveLoc(x, 0, 500, 1, 12);
    addNaveLoc(x, 5, 500, 2, 12);
}
for (let y = 0; y <= 5; y++) {
    addNaveLoc(0, y, 100, 0, 0);
    addNaveLoc(2, y, 100, 0, 2 << 6);
}
assert.equal(
    detectRectangularBuilding(1, 0, (x, y) => naveLocs.get(`${x}:${y}`) ?? [])?.tiles.length,
    18,
);
for (let x = 0; x < 3; x++) addNaveLoc(x, 0, 100, 0, 3 << 6);
assert.equal(
    detectRectangularBuilding(1, 0, (x, y) => naveLocs.get(`${x}:${y}`) ?? []),
    undefined,
);

const irregularLocs = new Map<string, Array<{ id: number; level: number; typeRot: number }>>();
const irregularRoof = new Set(["0:0", "1:0", "2:0", "0:1", "0:2"]);
const addIrregularLoc = (x: number, y: number, id: number, level: number, typeRot: number): void => {
    const key = `${x}:${y}`;
    const locs = irregularLocs.get(key) ?? [];
    locs.push({ id, level, typeRot });
    irregularLocs.set(key, locs);
};
for (const key of irregularRoof) {
    const [x, y] = key.split(":").map(Number);
    addIrregularLoc(x, y, 500, key === "0:1" ? 2 : 1, 12);
    for (const [nextX, nextY, rotation] of [
        [x - 1, y, 0],
        [x, y + 1, 1],
        [x + 1, y, 2],
        [x, y - 1, 3],
    ]) {
        if (!irregularRoof.has(`${nextX}:${nextY}`)) addIrregularLoc(x, y, 100, 0, rotation << 6);
    }
}
const corner = irregularLocs.get("2:0") ?? [];
irregularLocs.set(
    "2:0",
    corner.filter(
        ({ id, typeRot }) => id !== 100 || (typeRot !== (2 << 6) && typeRot !== (3 << 6)),
    ),
);
addIrregularLoc(2, 0, 100, 0, 9);
addIrregularLoc(-1, 0, 100, 0, 1 << 6);
const irregular = detectRectangularBuilding(
    0,
    1,
    (x, y) => irregularLocs.get(`${x}:${y}`) ?? [],
);
assert.equal(irregular?.shape, "Irregular");
assert.equal(irregular?.tiles.length, 5);
assert.equal(irregular?.maxPlane, 2);
assert.equal(irregular?.structureTiles.some(({ x }) => x === -1), false);
irregularLocs.set(
    "2:0",
    (irregularLocs.get("2:0") ?? []).filter(({ id, typeRot }) => id !== 100 || typeRot !== 9),
);
assert.equal(
    detectRectangularBuilding(0, 1, (x, y) => irregularLocs.get(`${x}:${y}`) ?? []),
    undefined,
);
for (const [x, y, id] of [[0, 0, 101], [2, 0, 102], [0, 2, 103], [1, 1, 104]]) {
    addIrregularLoc(x, y, id, 0, 3);
}
assert.equal(
    detectRectangularBuilding(0, 1, (x, y) => irregularLocs.get(`${x}:${y}`) ?? [])?.tiles.length,
    5,
);

// A roof-shaped bridge/tightrope with walls beneath but no circumference is not a building.
const bridgeRoofLocs = new Map<string, Array<{ id: number; level: number; typeRot: number }>>();
for (let x = 0; x < 10; x++) {
    for (let y = 0; y < 3; y++) bridgeRoofLocs.set(`${x}:${y}`, [{ id: 500, level: 2, typeRot: 17 }]);
}
for (let y = 0; y < 3; y++) {
    bridgeRoofLocs.get(`0:${y}`)!.push({ id: 100, level: 0, typeRot: 0 });
    bridgeRoofLocs.get(`9:${y}`)!.push({ id: 100, level: 0, typeRot: 2 << 6 });
}
assert.equal(
    detectRectangularBuilding(5, 1, (x, y) => bridgeRoofLocs.get(`${x}:${y}`) ?? []),
    undefined,
);

const normalLocFilter = () => false;
let raycastOptions: { basePlane?: number; maxDistance?: number } | undefined;
const editRaycaster = {
    isLocTypeInteractive: normalLocFilter,
    raycast: (_ray: unknown, options: { basePlane?: number; maxDistance?: number }) => {
        raycastOptions = options;
        return editRaycaster.isLocTypeInteractive({})
            ? [{ t: 1, interactType: InteractType.LOC, interactId: 100, mapId: 0 }]
            : [];
    },
};
assert.equal(raycastEditScene(editRaycaster as any, {} as any)?.interactId, 100);
assert.equal(editRaycaster.isLocTypeInteractive, normalLocFilter);
assert.equal(raycastOptions?.basePlane, undefined);
assert.equal(raycastOptions?.maxDistance, 4096);
raycastEditScene(editRaycaster as any, {} as any, 2);
assert.equal(raycastOptions?.basePlane, 2);

assert.deepEqual(
    [...buildMapIconGroundVertices({ tileX: 10, tileY: 20, plane: 2 }, () => 0.015)],
    [10, 0, 20, 11, 0, 20, 11, 0, 21, 10, 0, 20, 11, 0, 21, 10, 0, 21],
);

const calls: Call[] = [];
let saved: EditModePluginConfig | undefined;

const plugin = new EditModePlugin({
    load: () => ({ enabled: true, locId: 1276, shape: 10, rotation: 0 }),
    save: (config) => {
        saved = config;
    },
});
assert.equal(plugin.getConfig().heightLevel, 0);
assert.equal(plugin.getConfig().renderAllHeightLevels, true);
assert.equal(plugin.getConfig().showMapIcons, false);
assert.equal(plugin.getConfig().showPvpZones, false);
assert.equal(plugin.getConfig().showMultiCombatZones, false);

const cacheNames = [
    { id: 1276, name: "Tree" },
    { id: 3, name: "Goblin" },
    { id: 3106, name: "Goblin guard" },
];

let nextNpcServerId = 60000;

plugin.attach({
    getCanvas: () => undefined,
    getPointerTile: () => ({ tileX: 3222, tileY: 3218, plane: 0 }),
    getPointerLoc: () => ({ locId: 1276, locName: "Tree" }),
    selectPointer: (tile) => ({
        kind: "loc",
        ...tile,
        locId: 1276,
        locName: "Tree",
        shape: 22,
        rotation: 2,
    }),
    getLocName: (locId) => (locId === 1276 ? "Tree" : ""),
    getNpcName: (npcTypeId) => (npcTypeId === 3 ? "Goblin" : ""),
    search: async (_kind, query) =>
        cacheNames.filter((entry) => entry.name.toLowerCase().includes(query.toLowerCase())),
    spawnNpc: (npcTypeId, tile, rotation) => {
        calls.push(["spawnNpc", npcTypeId, tile, rotation]);
        return nextNpcServerId++;
    },
    despawnNpc: (serverId) => calls.push(["despawnNpc", serverId]),
    onLocAddChange: (...args) => calls.push(["add", ...args]),
    onLocDel: (...args) => calls.push(["del", ...args]),
    setTerrainOverlay: (...args) => calls.push(["terrain", ...args]),
    clearTerrainOverride: (...args) => calls.push(["clearTerrain", ...args]),
    setFreeCamera: (enabled) => calls.push(["freeCamera", enabled]),
    jumpCameraToTile: (tile) => calls.push(["jump", tile]),
    cancelPendingClick: () => calls.push(["cancelClick"]),
    setScenePreview: (enabled) => calls.push(["scenePreview", enabled]),
    isLoggedIn: () => false,
    listInterfaceGroups: () => [548, 161, 162],
    openInterface: (groupId) => calls.push(["openInterface", groupId]),
    describeInterface: (groupId) =>
        groupId === 161
            ? [{ uid: 1, fileId: 0, type: 0, x: 0, y: 0, width: 100, height: 20, text: "hp" }]
            : [],
});

// Select records what is under the pointer without touching the scene.
plugin.setConfig({ tool: "select" });
plugin.applyAtPointer();
assert.equal(calls.length, 0);
assert.deepEqual(plugin.getState().selection, {
    kind: "loc",
    tileX: 3222,
    tileY: 3218,
    plane: 0,
    locId: 1276,
    locName: "Tree",
    shape: 22,
    rotation: 2,
});

// The selection panel's duplicate action arms the same object for placement.
plugin.duplicateSelection();
assert.equal(plugin.getConfig().tool, "place");
assert.equal(plugin.getConfig().locId, 1276);
assert.equal(plugin.getConfig().shape, 22);
assert.equal(plugin.getConfig().rotation, 2);

// Place spawns the loc and stores the edit.
plugin.setConfig({ tool: "place" });
plugin.rotate();
plugin.applyAtPointer();
assert.deepEqual(calls, [["add", 1276, { x: 3222, y: 3218 }, 0, 22, 3]]);
assert.equal(saved?.edits.length, 1);
assert.deepEqual(saved?.edits[0], {
    kind: "place",
    locId: 1276,
    tileX: 3222,
    tileY: 3218,
    plane: 0,
    shape: 22,
    rotation: 3,
});

// Re-applying replays stored edits (used after a login or map reload).
calls.length = 0;
plugin.reapply();
assert.deepEqual(calls, [["add", 1276, { x: 3222, y: 3218 }, 0, 22, 3]]);

// Undo removes the placement from the scene and from storage.
calls.length = 0;
assert.equal(plugin.undo(), true);
assert.deepEqual(calls, [["del", { x: 3222, y: 3218 }, 0, 22, 3]]);
assert.equal(saved?.edits.length, 0);
assert.equal(plugin.undo(), false);

// Delete records a delete edit with no loc id.
calls.length = 0;
plugin.setConfig({ tool: "delete" });
plugin.applyAtPointer();
assert.deepEqual(calls, [["del", { x: 3222, y: 3218 }, 0, 22, 3]]);
assert.equal(saved?.edits[0].locId, 0);

plugin.clearEdits();
assert.equal(saved?.edits.length, 0);

// Selected object actions preserve the shape/rotation that the picker found.
plugin.setConfig({ tool: "select" });
plugin.applyAtPointer();
calls.length = 0;
plugin.rotateSelection();
assert.deepEqual(calls, [
    ["del", { x: 3222, y: 3218 }, 0, 22, 2],
    ["add", 1276, { x: 3222, y: 3218 }, 0, 22, 3],
]);
assert.equal(plugin.getState().selection?.rotation, 3);
calls.length = 0;
plugin.deleteSelection();
assert.deepEqual(calls, [["del", { x: 3222, y: 3218 }, 0, 22, 3]]);
plugin.clearEdits();

// NPC placement spawns through the host and undo despawns the same id.
calls.length = 0;
plugin.setConfig({ tool: "place", placeKind: "npc", npcId: 3, rotation: 0 });
plugin.applyAtPointer();
assert.deepEqual(calls, [["spawnNpc", 3, { tileX: 3222, tileY: 3218, plane: 0 }, 0]]);
assert.equal(saved?.edits[0].kind, "npc");
assert.equal(saved?.edits[0].locId, 3);

calls.length = 0;
assert.equal(plugin.undo(), true);
assert.deepEqual(calls, [["despawnNpc", 60000]]);
assert.equal(saved?.edits.length, 0);

// Terrain tool paints the configured overlay on the pointer tile.
plugin.clearEdits();
calls.length = 0;
plugin.setConfig({ tool: "terrain", overlayId: 2 });
plugin.applyAtPointer();
assert.deepEqual(calls, [["terrain", { tileX: 3222, tileY: 3218, plane: 0 }, 2, 0, 0]]);

// Path tool needs two clicks: the first only records the start.
plugin.clearEdits();
calls.length = 0;
plugin.setConfig({ tool: "path" });
plugin.applyAtPointer();
assert.equal(calls.length, 0);
assert.deepEqual(plugin.getState().pathStart, { tileX: 3222, tileY: 3218, plane: 0 });

// Second click paints the run; the fake host always reports the same tile, so
// drive the end tile through a host that walks three tiles east.
const pathPlugin = new EditModePlugin();
let pathPointer = { tileX: 10, tileY: 10, plane: 0 };
const pathCalls: Call[] = [];
pathPlugin.attach({
    getCanvas: () => undefined,
    getPointerTile: () => pathPointer,
    getPointerLoc: () => undefined,
    getLocName: () => "",
    getNpcName: () => "",
    search: async () => [],
    spawnNpc: () => 1,
    despawnNpc: () => {},
    onLocAddChange: () => {},
    onLocDel: () => {},
    setTerrainOverlay: (tile, overlay, shape, rotation) =>
        pathCalls.push(["terrain", tile.tileX, tile.tileY, overlay, shape, rotation]),
    clearTerrainOverride: (tile) => pathCalls.push(["clearTerrain", tile.tileX, tile.tileY]),
    setFreeCamera: () => {},
    jumpCameraToTile: () => {},
    cancelPendingClick: () => {},
    setScenePreview: () => {},
    isLoggedIn: () => false,
    listInterfaceGroups: () => [],
    openInterface: () => {},
    describeInterface: () => [],
});
pathPlugin.setConfig({ tool: "path", overlayId: 2 });
pathPlugin.applyAtPointer();
pathPointer = { tileX: 13, tileY: 10, plane: 0 };
pathPlugin.applyAtPointer();

const painted = pathCalls.filter((call) => call[0] === "terrain");
const paintedTiles = painted.map((call) => `${call[1]},${call[2]}`);
// The four tiles of the run, plus the end caps the generator adds.
for (const tile of ["10,10", "11,10", "12,10", "13,10"]) {
    assert.ok(paintedTiles.includes(tile), `expected ${tile} to be painted`);
}
assert.ok(painted.every((call) => call[3] === 2), "every tile uses the configured overlay");
assert.equal(pathPlugin.getState().pathStart, undefined);

// Undo removes the last painted tile and clears its override.
pathCalls.length = 0;
const paintedCount = pathPlugin.getConfig().edits.length;
assert.equal(pathPlugin.undo(), true);
assert.equal(pathPlugin.getConfig().edits.length, paintedCount - 1);
assert.equal(pathCalls[0][0], "clearTerrain");

// Leaving edit mode hands the camera back to the player.
calls.length = 0;
plugin.setConfig({ enabled: true, active: true });
plugin.setFreeCamera(true);
assert.deepEqual(calls.at(-1), ["freeCamera", true]);
plugin.setConfig({ active: false });
assert.deepEqual(calls.at(-1), ["freeCamera", false]);
assert.equal(plugin.getState().freeCamera, false);

// Navigation and the interface browser go through the host.
calls.length = 0;
plugin.jumpToTile(3100, 3200, 1);
assert.deepEqual(calls.at(-1), ["jump", { tileX: 3100, tileY: 3200, plane: 1 }]);

plugin.refreshInterfaces();
assert.deepEqual(plugin.getState().interfaces.groups, [161, 162, 548]);
plugin.openInterface(161);
assert.deepEqual(calls.at(-1), ["openInterface", 161]);
assert.equal(plugin.getState().interfaces.selected, 161);
assert.equal(plugin.getState().interfaces.widgets[0].text, "hp");

// Armed on the login screen: clicks and keys must pass through to the client,
// there is no scene to edit yet. (host.isLoggedIn() is false in this fake.)
plugin.setConfig({ enabled: true, active: true });
calls.length = 0;
plugin.setConfig({ tool: "place", placeKind: "loc", locId: 1276 });
plugin.applyAtPointer();
assert.equal(calls.length, 1, "applyAtPointer stays callable from the panel");
calls.length = 0;
assert.equal(plugin.handlesCanvasInput(), false, "no canvas capture without a scene");
plugin.clearEdits();
plugin.setConfig({ active: false, tool: "select", placeKind: "npc" });

// A restored session never starts armed.
const restoredArmed = new EditModePlugin({
    load: () => ({ enabled: true, active: true }),
    save: () => {},
});
assert.equal(restoredArmed.getConfig().active, false);

// Entering the preview arms the tools, so Esc has something to exit.
plugin.setConfig({ enabled: true, active: false });
plugin.setScenePreview(true);
assert.equal(plugin.getConfig().active, true);
plugin.setScenePreview(false);
plugin.setConfig({ active: false });

// The pre-login scene preview detaches the camera with it, and both are
// handed back when edit mode stops.
plugin.setConfig({ enabled: true, active: true });
plugin.setFreeCamera(false);
calls.length = 0;
plugin.setScenePreview(true);
assert.deepEqual(calls, [
    ["scenePreview", true],
    ["freeCamera", true],
]);
assert.equal(plugin.getState().scenePreview, true);
assert.equal(plugin.getState().freeCamera, true);

calls.length = 0;
plugin.setConfig({ active: false });
assert.deepEqual(calls, [
    ["scenePreview", false],
    ["freeCamera", false],
]);
assert.equal(plugin.getState().scenePreview, false);

// Switching the plugin off also hands the camera back, even if world-click
// capture was never turned on.
plugin.setConfig({ enabled: true, active: false });
calls.length = 0;
plugin.setFreeCamera(true);
plugin.setConfig({ enabled: false });
assert.deepEqual(calls.at(-1), ["freeCamera", false]);
assert.equal(plugin.getState().freeCamera, false);

// Disabled by default, and never active without being enabled.
const fresh = new EditModePlugin();
assert.equal(fresh.getConfig().enabled, false);
assert.equal(fresh.getConfig().active, false);

// Persisted junk is clamped rather than trusted.
const restored = new EditModePlugin({
    load: () => ({
        enabled: true,
        active: true,
        tool: "nonsense" as never,
        rotation: 99,
        edits: [{ kind: "place", locId: -5, tileX: 1, tileY: 2, plane: 9, shape: 999, rotation: 7 }],
    }),
    save: () => {},
});
assert.equal(restored.getConfig().tool, "select");
assert.equal(restored.getConfig().rotation, 3);
assert.deepEqual(restored.getConfig().edits[0], {
    kind: "place",
    locId: 0,
    tileX: 1,
    tileY: 2,
    plane: 3,
    shape: 22,
    rotation: 3,
});

// An armed placement follows the pointer, refreshes on rotation, and is
// removed before the permanent scene edit is applied.
const previewCalls: Call[] = [];
const windowListeners: Array<[string, (...args: any[]) => void, unknown]> = [];
(globalThis as any).window = {
    addEventListener: (type: string, listener: (...args: any[]) => void, options?: unknown) =>
        windowListeners.push([type, listener, options]),
    removeEventListener: () => {},
};
const fakeCanvas = {} as HTMLCanvasElement;
let previewPointer = { tileX: 3200, tileY: 3201, plane: 0 };
let sceneFrameCallback: (() => void) | undefined;
const previewPlugin = new EditModePlugin();
previewPlugin.attach({
    getCanvas: () => fakeCanvas,
    getPointerTile: () => previewPointer,
    getPointerLoc: () => undefined,
    selectPointer: (tile) => {
        previewCalls.push(["selectPointer", tile]);
        return { kind: "npc", ...tile, locId: 3, locName: "Goblin" };
    },
    previewPointer: (tile) => previewCalls.push(["previewPointer", tile]),
    previewBuilding: (tile) => previewCalls.push(["previewBuilding", tile]),
    selectBuilding: (tile) => {
        previewCalls.push(["selectBuilding", tile]);
        return {
            kind: "building",
            tileX: 3200,
            tileY: 3200,
            plane: 0,
            tileEndX: 3204,
            tileEndY: 3203,
            planeEnd: 1,
            locId: -1,
            locName: "",
            buildingWidth: 5,
            buildingDepth: 4,
            buildingFloors: 2,
            buildingTileCount: 40,
            buildingObjectCount: 18,
        };
    },
    clearPointerPreview: () => previewCalls.push(["clearPointerPreview"]),
    selectTileRange: (start, end) => {
        previewCalls.push(["selectTileRange", start, end]);
        return {
            kind: "ground",
            ...start,
            tileEndX: end.tileX,
            tileEndY: end.tileY,
            locId: -1,
            locName: "",
        };
    },
    afterNextSceneFrame: (callback) => {
        sceneFrameCallback = callback;
    },
    setPlacementPreview: (...args) => previewCalls.push(["preview", ...args]),
    clearPlacementPreview: () => previewCalls.push(["clearPreview"]),
    onLocAddChange: (...args) => previewCalls.push(["add", ...args]),
    onLocDel: () => {},
    getLocName: () => "",
    getNpcName: () => "",
    search: async () => [],
    spawnNpc: () => undefined,
    despawnNpc: () => {},
    setTerrainOverlay: () => {},
    clearTerrainOverride: () => {},
    setFreeCamera: () => {},
    setScenePreview: () => {},
    isLoggedIn: () => true,
    jumpCameraToTile: () => {},
    rotateCamera: (x, y) => previewCalls.push(["rotateCamera", x, y]),
    cancelPendingClick: () => {},
    levelCamera: () => {},
    listInterfaceGroups: () => [],
    openInterface: () => {},
    describeInterface: () => [],
});
previewPlugin.setConfig({ enabled: true, active: true, tool: "place", locId: 1276 });
assert.equal(
    windowListeners.find(([type]) => type === "mousedown")?.[2],
    undefined,
    "editor mouse hooks must bubble after the canvas records its click",
);
assert.equal(previewCalls[0][0], "preview");
previewPlugin.rotate();
assert.deepEqual(
    previewCalls.map((call) => call[0]),
    ["preview", "clearPreview", "preview"],
);
previewPlugin.applyAtPointer();
assert.deepEqual(
    previewCalls.slice(-2).map((call) => call[0]),
    ["clearPreview", "add"],
);
previewPlugin.setConfig({ tool: "select" });
previewPlugin.applyAtPointer();
assert.equal(previewCalls.at(-1)?.[0], "selectPointer");
assert.deepEqual(previewPlugin.getState().selection, {
    kind: "npc",
    tileX: 3200,
    tileY: 3201,
    plane: 0,
    locId: 3,
    locName: "Goblin",
});

const emitWindow = (type: string, event: Record<string, unknown>) => {
    for (const [, listener] of windowListeners.filter(([eventType]) => eventType === type)) {
        listener(event);
    }
};
const rotationBeforeShortcut = previewPlugin.getConfig().rotation;
emitWindow("keydown", {
    key: "r",
    ctrlKey: false,
    target: null,
    preventDefault: () => {},
    stopPropagation: () => {},
});
assert.equal(previewPlugin.getConfig().rotation, (rotationBeforeShortcut + 1) & 3);
emitWindow("keydown", {
    key: "x",
    ctrlKey: false,
    target: null,
    preventDefault: () => {},
    stopPropagation: () => {},
});
assert.equal(previewPlugin.getConfig().rotation, (rotationBeforeShortcut + 1) & 3);

emitWindow("mousedown", {
    button: 0,
    target: fakeCanvas,
    clientX: 10,
    clientY: 10,
});
previewPointer = { tileX: 3202, tileY: 3203, plane: 0 };
emitWindow("mousemove", { target: fakeCanvas, clientX: 20, clientY: 20 });
emitWindow("mouseup", { button: 0 });
assert.equal(previewCalls.at(-1)?.[0], "selectTileRange");
assert.equal(previewPlugin.getState().selection?.tileEndX, 3202);
assert.equal(previewPlugin.getState().selection?.tileEndY, 3203);

emitWindow("mousedown", {
    button: 2,
    target: fakeCanvas,
    clientX: 20,
    clientY: 20,
    preventDefault: () => {},
});
emitWindow("mousemove", { target: fakeCanvas, clientX: 24, clientY: 17 });
emitWindow("mouseup", { button: 2 });
assert.deepEqual(previewCalls.at(-1), ["rotateCamera", 4, -3]);
sceneFrameCallback?.();
assert.equal(previewCalls.at(-1)?.[0], "previewPointer");

emitWindow("mousedown", {
    button: 0,
    target: fakeCanvas,
    clientX: 24,
    clientY: 17,
});
emitWindow("mouseup", { button: 0 });
assert.notEqual(previewCalls.at(-1)?.[0], "selectPointer");
sceneFrameCallback?.();
assert.equal(previewCalls.at(-1)?.[0], "selectPointer");
emitWindow("keydown", { key: "Shift", target: null });
assert.equal(previewCalls.at(-1)?.[0], "previewBuilding");
emitWindow("mousedown", {
    button: 0,
    target: fakeCanvas,
    clientX: 24,
    clientY: 17,
});
emitWindow("mouseup", { button: 0 });
emitWindow("keyup", { key: "Shift", target: null });
assert.equal(previewCalls.at(-1)?.[0], "previewPointer");
sceneFrameCallback?.();
assert.equal(previewCalls.at(-1)?.[0], "selectBuilding");
assert.equal(previewPlugin.getState().selection?.kind, "building");
assert.equal(previewPlugin.getState().selection?.buildingTileCount, 40);
emitWindow("mousemove", { target: {}, clientX: 25, clientY: 18 });
assert.equal(previewCalls.at(-1)?.[0], "clearPointerPreview");
delete (globalThis as any).window;

// Search results feed the id the place tool uses.
async function searchTests(): Promise<void> {
    const worldPlugin = new EditModePlugin();
    worldPlugin.attach({ loadWorldDefinition: async () => parsedWorld } as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(worldPlugin.getState().world.definition?.zones.length, 1);

    let resolveWorld: (world: typeof parsedWorld) => void = () => undefined;
    let previewStarts = 0;
    let previewSpawn: { tileX: number; tileY: number; plane: number } | undefined;
    const gatedPlugin = new EditModePlugin();
    gatedPlugin.attach({
        getPointerTile: () => undefined,
        loadWorldDefinition: () =>
            new Promise<typeof parsedWorld>((resolve) => {
                resolveWorld = resolve;
            }),
        setScenePreview: (_enabled, spawn) => {
            previewStarts++;
            previewSpawn = spawn;
        },
        setFreeCamera: () => {},
    } as any);
    gatedPlugin.setConfig({ enabled: true });
    gatedPlugin.setScenePreview(true);
    assert.equal(previewStarts, 0, "preview waits for the world definition");
    resolveWorld(parsedWorld);
    await Promise.resolve();
    gatedPlugin.setScenePreview(true);
    assert.equal(previewStarts, 1);
    assert.deepEqual(previewSpawn, { tileX: 3089, tileY: 3524, plane: 0 });

    await new Promise<void>((resolve) => {
        const unsubscribe = plugin.subscribe(() => {
            if (plugin.getState().search.loading) return;
            unsubscribe();
            resolve();
        });
        plugin.searchCache("goblin");
    });
    assert.deepEqual(
        plugin.getState().search.results.map((result) => result.id),
        [3, 3106],
    );
    plugin.useSearchResult(3106);
    assert.equal(plugin.getConfig().npcId, 3106);
}

void searchTests().then(() => {
    console.log("Edit Mode plugin tests passed");
});
