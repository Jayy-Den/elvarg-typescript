// A world.json zone with no bounds is the fallback: its tags cover every tile on every
// plane, while bounded zones stay where they are put.
// Usage: TS_NODE_COMPILER_OPTIONS='{"target":"es2020"}' yarn ts-node ./scripts/world-zone-fallback-smoke.ts
import { strict as assert } from "assert";
import fs = require("fs");
import os = require("os");
import path = require("path");

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "world-zone-smoke-"));
fs.mkdirSync(path.join(workspace, "data", "definitions"), { recursive: true });
fs.writeFileSync(
    path.join(workspace, "data", "definitions", "world.json"),
    JSON.stringify({
        disabledPlugins: [],
        experienceMultiplier: 1,
        spawn: { x: 3089, y: 3524, z: 0 },
        zones: [
            { tags: [] },
            { tags: ["pvp"] },
            { minX: 3136, maxX: 3327, minY: 3519, maxY: 3607, z: 0, tags: ["multi-combat"] },
        ],
    })
);
// The module resolves world.json against the cwd when it is first imported.
process.chdir(workspace);

const { Location } = require("../src/main/typescript/elvarg/game/model/Location");
const {
    WORLD_ZONE_BOUNDARIES,
    getWorldDefinition,
    parseWorldZone,
    WorldDefinitionValidationError,
} = require("../src/main/typescript/elvarg/game/definition/WorldDefinition");

const inside = (tag: "pvp" | "multi-combat", x: number, y: number, z: number) =>
    WORLD_ZONE_BOUNDARIES[tag].some((boundary: any) => boundary.inside(new Location(x, y, z)));

assert.ok(inside("pvp", 3089, 3524, 0), "the fallback zone makes spawn pvp");
assert.ok(inside("pvp", 1, 1, 0), "the fallback zone reaches the far corner of the map");
assert.ok(inside("pvp", 3089, 3524, 3), "the fallback zone covers every plane");

assert.ok(inside("multi-combat", 3200, 3550, 0), "a bounded zone still applies inside it");
assert.ok(!inside("multi-combat", 3089, 3524, 0), "a bounded zone does not leak outside it");
assert.ok(!inside("multi-combat", 3200, 3550, 1), "a bounded zone stays on its own plane");

const zones = getWorldDefinition().zones;
assert.deepEqual(zones[0], { tags: [] }, "an untagged fallback zone is accepted and changes nothing");
assert.deepEqual(zones[1], { tags: ["pvp"] }, "the fallback zone round-trips without bounds");
assert.equal(WORLD_ZONE_BOUNDARIES.pvp.length, 4, "only the tagged fallback zone adds boundaries");
assert.throws(
    () => parseWorldZone({ minX: 10, maxX: 11, minY: 10, maxY: 11, z: 0, tags: [] }),
    WorldDefinitionValidationError,
    "a bounded zone still needs a tag"
);
assert.throws(
    () => parseWorldZone({ minX: 10, tags: ["pvp"] }),
    WorldDefinitionValidationError,
    "half a rectangle is still an error"
);

fs.rmSync(workspace, { recursive: true, force: true });
console.info("[world-zone-fallback-smoke] ok");
