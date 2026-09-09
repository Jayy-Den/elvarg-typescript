import assert from "node:assert/strict";

import { ClickMode, InputManager } from "../game/InputManager";

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
    input.setFirstPersonEnabled(true);
    input.setFirstPersonReticlePosition(320, 240);

    input.clickMode3 = ClickMode.LEFT;
    assert.equal(input.leftClickX, 320);
    assert.equal(input.leftClickY, 240);

    input.clickMode3 = ClickMode.RIGHT;
    assert.equal(input.pickX, 320);
    assert.equal(input.pickY, 240);

    input.clickMode3 = ClickMode.NONE;
    assert.equal(input.leftClickX, -1);
    assert.equal(input.pickX, -1);

    const alt = {
        code: "AltLeft",
        keyCode: 18,
        altKey: true,
        preventDefault() {},
        repeat: false,
    } as KeyboardEvent;
    (input as any).onKeyDown(alt);
    assert.equal(input.isFirstPersonCursorMode(), true, "Alt should release the cursor");
    (input as any).onKeyDown(alt);
    assert.equal(input.isFirstPersonReticleActive(), true, "Alt should restore the reticle");
} finally {
    Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: originalDocument,
    });
}

console.log("first-person reticle input ok");
