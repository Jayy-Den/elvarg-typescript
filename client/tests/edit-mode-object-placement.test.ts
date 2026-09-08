import assert from "node:assert/strict";

import { EditModePlugin } from "../game/plugins/editmode/EditModePlugin";
import { LocPlacementPreviewOverlay } from "../game/plugins/editmode/LocPlacementPreviewOverlay";

const plugin = new EditModePlugin();
plugin.setConfig({ shape: 9, rotation: 3 });
(plugin as any).search = { kind: "loc", query: "", loading: false, results: [] };
plugin.useSearchResult(100);

assert.equal(plugin.getConfig().shape, 10, "fresh cache objects use the normal loc shape");
assert.equal(plugin.getConfig().rotation, 0, "fresh cache objects start unrotated");

const reopened = new EditModePlugin({
    load: () => ({ heightLevel: 1 }),
    save: () => {},
});
assert.equal(reopened.getConfig().heightLevel, 0, "reopened editors start on ground level");

const preview = new LocPlacementPreviewOverlay() as any;
preview.previewVertShader = "ready";
preview.mainFragShader = "ready";
preview.key = "1:10:0";
preview.opaque = { vertexBuffer: {}, indexBuffer: {}, array: {}, program: {}, drawCall: {} };
preview.setPreviews({} as any, {} as any, [{ locId: 2, x: 0, y: 0, plane: 0, shape: 10, rotation: 0 }]);
assert.equal(preview.opaque, undefined, "switching objects never leaves the previous model visible");
assert.equal(preview.key, "2:10:0");

let modelArgs: number[] = [];
const diagonalPreview = new LocPlacementPreviewOverlay() as any;
Object.assign(diagonalPreview, {
    app: {},
    sceneUniforms: {},
    waterMask: {},
    previewVertShader: "ready",
    mainFragShader: "ready",
    previews: [{ locId: 2, x: 0, y: 0, plane: 0, shape: 11, rotation: 3 }],
});
diagonalPreview.rebuild(
    {
        textureLoader: {},
        locTypeLoader: { load: () => ({ transforms: undefined }) },
        varManager: {},
    },
    {
        textureArray: {},
        textureMaterials: {},
        waterTextures: {},
        getInteractLocModelLoader: () => ({
            getModelAnimated: (_type: unknown, shape: number, rotation: number) => {
                modelArgs = [shape, rotation];
                return undefined;
            },
        }),
    },
);
assert.deepEqual(modelArgs, [10, 7], "diagonal duplicates use the cache's normal model variant");

let cleared = 0;
const selectionPlugin = new EditModePlugin();
selectionPlugin.attach({
    getPointerTile: () => undefined,
    clearPlacementPreview: () => cleared++,
} as any);
cleared = 0;
selectionPlugin.setConfig({ tool: "place" });
selectionPlugin.setConfig({ tool: "select" });
assert.ok(cleared > 0, "returning to selection always clears renderer placement state");
console.log("Edit Mode object placement defaults passed");
