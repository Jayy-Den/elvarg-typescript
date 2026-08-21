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

plugin.attach({
    getCanvas: () => undefined,
    getPointerTile: () => ({ tileX: 3222, tileY: 3218, plane: 0 }),
    getPointerLoc: () => ({ locId: 1276, locName: "Tree" }),
    getLocName: (locId) => (locId === 1276 ? "Tree" : ""),
    onLocAddChange: (...args) => calls.push(["add", ...args]),
    onLocDel: (...args) => calls.push(["del", ...args]),
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

console.log("Edit Mode plugin tests passed");
