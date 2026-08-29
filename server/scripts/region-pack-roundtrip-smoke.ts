// Verifies the client editor's .pack encoder produces a file the server accepts,
// which is the seam /host relies on: export in the editor, load on restart.
import assert = require("assert");
import fs = require("fs");
import os = require("os");
import path = require("path");
import { CachePipeline } from "../src/main/typescript/elvarg/game/cache/CachePipeline";
import { CacheMaps } from "../src/main/typescript/elvarg/game/cache/CacheMaps";
import { MapRegionReplacementManager } from "../src/main/typescript/elvarg/game/collision/MapRegionReplacementManager";
import { buildRegionPack } from "../../client/game/plugins/editmode/RegionPack";

const REGION_ID = 12343;

async function main() {
    await CachePipeline.initialize();
    MapRegionReplacementManager.replaceMapRegion(REGION_ID, "data/regions/12343.pack");
    const source = MapRegionReplacementManager.getReplacementMapData(REGION_ID)!;
    const files = CacheMaps.getArchiveIds(REGION_ID)!;

    const rebuilt = buildRegionPack(
        REGION_ID,
        files.objectFile,
        files.terrainFile,
        source.objectData!,
        source.terrainData,
        [
            {
                kind: "place",
                locId: 1276,
                tileX: (REGION_ID >> 8) * 64 + 32,
                tileY: (REGION_ID & 0xff) * 64 + 32,
                plane: 0,
                shape: 10,
                rotation: 0,
            },
        ],
        true,
    );

    const packPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pack-")), "12343.pack");
    fs.writeFileSync(packPath, rebuilt);
    const result = MapRegionReplacementManager.replaceMapRegion(REGION_ID, packPath);
    assert.equal(result.regionId, REGION_ID);
    assert(result.objectCount > 0, "expected the rebuilt pack to keep its objects");
    const reloaded = MapRegionReplacementManager.getReplacementMapData(REGION_ID)!;
    assert.deepEqual(
        Array.from(reloaded.terrainData),
        Array.from(source.terrainData),
        "unedited terrain must survive the editor round trip",
    );
    console.info(`region pack round trip ok: ${JSON.stringify(result)}`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
