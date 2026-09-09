import assert from "node:assert/strict";

import { Camera } from "../game/Camera";
import { ClickMode, InputManager } from "../game/InputManager";
import { FirstPersonPlugin } from "../game/plugins/firstperson/FirstPersonPlugin";

const originalDocument = globalThis.document;
let pointerLockElement: HTMLElement | undefined;
const element = {
    requestPointerLock: () => {
        pointerLockElement = element as HTMLElement;
    },
} as HTMLElement;
Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
        get pointerLockElement() {
            return pointerLockElement;
        },
        exitPointerLock: () => {
            pointerLockElement = undefined;
        },
    },
});

try {
    const input = new InputManager();
    input.element = element;
    pointerLockElement = element;
    input.setInteractionPointerOverride(320, 240);

    input.clickMode3 = ClickMode.LEFT;
    assert.equal(input.leftClickX, 320);
    assert.equal(input.leftClickY, 240);

    input.clickMode3 = ClickMode.RIGHT;
    assert.equal(input.pickX, 320);
    assert.equal(input.pickY, 240);

    input.clickMode3 = ClickMode.NONE;
    assert.equal(input.leftClickX, -1);
    assert.equal(input.pickX, -1);

    input.clearInteractionPointerOverride();
    input.clickMode3 = ClickMode.LEFT;
    input.saveClickX = 12;
    assert.equal(input.leftClickX, 12, "clearing an override should restore physical clicks");

    const client = {
        camera: new Camera(0, 0, 0, 256, 512),
        inputManager: input,
        renderSelf: true,
        followPlayerCamera: false,
    };
    const plugin = new FirstPersonPlugin(client);
    plugin.onKeyDown({ code: "F4", repeat: false } as KeyboardEvent);
    input.keys.set("ArrowUp", true);
    plugin.handleCameraKeys({ camera: client.camera, input, deltaTime: 100 });
    assert.ok((client.camera.getViewPitchOverride() ?? 0) < 0, "F4 up must be inverted");
    plugin.onKeyDown({ code: "AltLeft", repeat: false } as KeyboardEvent);
    plugin.updateInteractionPointer(client.camera);
    assert.equal(input.hasInteractionPointerOverride(), false, "Alt should release world targeting");
    assert.equal(input.enablePointerLock, false, "Alt should keep double-clicks from hiding the cursor");
    plugin.onKeyDown({ code: "AltLeft", repeat: false } as KeyboardEvent);
    plugin.updateInteractionPointer(client.camera);
    assert.equal(input.hasInteractionPointerOverride(), true, "Alt should restore world targeting");
    assert.equal(input.enablePointerLock, true, "relocking should restore pointer lock support");
} finally {
    Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: originalDocument,
    });
}

console.log("first-person reticle input ok");
