import assert from "node:assert/strict";

import { EditModePlugin } from "../game/plugins/editmode/EditModePlugin";
import type { EditModePluginConfig } from "../game/plugins/editmode/types";

type Call = [string, ...unknown[]];

const calls: Call[] = [];
let saved: EditModePluginConfig | undefined;

const plugin = new EditModePlugin({
    load: () => ({ enabled: true, locId: 1276, shape: 10, rotation: 0 }),
    save: (config) => {
        saved = config;
    },
});

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
    tileX: 3222,
    tileY: 3218,
    plane: 0,
    locId: 1276,
    locName: "Tree",
});

// Place spawns the loc and stores the edit.
plugin.setConfig({ tool: "place" });
plugin.rotate();
plugin.applyAtPointer();
assert.deepEqual(calls, [["add", 1276, { x: 3222, y: 3218 }, 0, 10, 1]]);
assert.equal(saved?.edits.length, 1);
assert.deepEqual(saved?.edits[0], {
    kind: "place",
    locId: 1276,
    tileX: 3222,
    tileY: 3218,
    plane: 0,
    shape: 10,
    rotation: 1,
});

// Re-applying replays stored edits (used after a login or map reload).
calls.length = 0;
plugin.reapply();
assert.deepEqual(calls, [["add", 1276, { x: 3222, y: 3218 }, 0, 10, 1]]);

// Undo removes the placement from the scene and from storage.
calls.length = 0;
assert.equal(plugin.undo(), true);
assert.deepEqual(calls, [["del", { x: 3222, y: 3218 }, 0, 10, 1]]);
assert.equal(saved?.edits.length, 0);
assert.equal(plugin.undo(), false);

// Delete records a delete edit with no loc id.
calls.length = 0;
plugin.setConfig({ tool: "delete" });
plugin.applyAtPointer();
assert.deepEqual(calls, [["del", { x: 3222, y: 3218 }, 0, 10, 1]]);
assert.equal(saved?.edits[0].locId, 0);

plugin.clearEdits();
assert.equal(saved?.edits.length, 0);

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

// Search results feed the id the place tool uses.
async function searchTests(): Promise<void> {
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
