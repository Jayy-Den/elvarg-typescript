import assert from "node:assert/strict";

(globalThis as any).self = globalThis;
const {
    requestBrowserHostWorldDefinition,
    parseBrowserHostShops,
} = require("../game/plugins/editmode/install");
const {
    WORLD_DEFINITION_MESSAGE,
    WORLD_DEFINITION_REQUEST_MESSAGE,
} = require("../game/plugins/editmode/hostProtocol/worldDefinitionMessage");

assert.deepEqual(
    parseBrowserHostShops(JSON.stringify([{
        id: 1,
        name: "General Store",
        currency: "COINS",
        defaultRestockTicks: 10,
        originalStock: [{ id: 995, amount: 1, price: 1 }],
    }])),
    [{
        id: 1,
        name: "General Store",
        currency: "COINS",
        defaultRestockTicks: 10,
        originalStock: [{ id: 995, amount: 1, price: 1 }],
    }],
);
assert.throws(() => parseBrowserHostShops('[{"id":1,"name":"Bad","originalStock":[{"id":0,"amount":1}]}]'));

const originalWindow = globalThis.window;
const listeners = new Set<(event: MessageEvent) => void>();
const sent: Array<{ message: unknown; origin: string }> = [];
const host = {
    closed: false,
    postMessage(message: unknown, origin: string) {
        sent.push({ message, origin });
        queueMicrotask(() => {
            for (const listener of listeners) {
                listener({
                    origin: "https://host.rsps.test",
                    source: host,
                    data: {
                        type: WORLD_DEFINITION_MESSAGE,
                        contents: JSON.stringify({ spawn: { x: 3222, y: 3218, z: 0 }, zones: [] }),
                    },
                } as MessageEvent);
            }
        });
    },
};
(globalThis as any).window = {
    location: {
        origin: "https://client.rsps.test",
        search: "?browser-host-client=1&browser-host-origin=https%3A%2F%2Fhost.rsps.test",
    },
    opener: null,
    parent: host,
    setTimeout,
    clearTimeout,
    addEventListener: (_name: string, listener: (event: MessageEvent) => void) => listeners.add(listener),
    removeEventListener: (_name: string, listener: (event: MessageEvent) => void) => listeners.delete(listener),
};

void requestBrowserHostWorldDefinition().then((definition: { spawn: unknown }) => {
    assert.deepEqual(definition.spawn, { x: 3222, y: 3218, z: 0 });
    assert.deepEqual(sent, [{ message: { type: WORLD_DEFINITION_REQUEST_MESSAGE }, origin: "https://host.rsps.test" }]);
    assert.equal(listeners.size, 0, "reply listener is removed after the host responds");
    (globalThis as any).window = originalWindow;
    console.log("Browser-host world-definition handshake passed");
});
