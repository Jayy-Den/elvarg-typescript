import assert from "node:assert/strict";

// PicoGL expects a browser global when SceneRaycaster imports WebGLMapSquare.
(globalThis as any).self = globalThis;
const { SceneRaycaster } = require("../game/scene/SceneRaycaster");

const modelLoader = { missCount: 0 };
const raycaster = new SceneRaycaster({}, { modelLoader });
let attempts = 0;
raycaster.getInteractLocModelLoader = () => ({
    getModelAnimated: () => {
        if (++attempts === 1) {
            return undefined;
        }
        return {
            verticesCount: 3,
            verticesX: new Int32Array([0, 128, 0]),
            verticesY: new Int32Array([0, 0, -128]),
            verticesZ: new Int32Array(3),
            faceCount: 1,
            indices1: new Int32Array([0]),
            indices2: new Int32Array([1]),
            indices3: new Int32Array([2]),
        };
    },
});

assert.equal(raycaster.getLocModelMesh({ id: 405 }, 10, 1), undefined, "do not cache a pending model as absent");
const mesh = raycaster.getLocModelMesh({ id: 405 }, 10, 1);
assert.equal(mesh?.faceCount, 1, "retry the object mesh after its model downloads");
assert.equal(raycaster.getLocModelMesh({ id: 405 }, 10, 1), mesh);
assert.equal(attempts, 2, "reuse successfully loaded geometry");

let typeAttempts = 0;
raycaster.osrsClient.locTypeLoader = {
    load: () => {
        if (++typeAttempts === 1) throw new Error("pending");
        return { id: 405 };
    },
};
assert.equal(raycaster.getResolvedLocType(405), undefined, "do not cache a pending definition as absent");
assert.equal(raycaster.getResolvedLocType(405)?.id, 405);
console.log("Scene raycaster streaming regression passed");
