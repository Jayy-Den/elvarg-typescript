import assert from "node:assert/strict";

(globalThis as any).self = globalThis;
const {
    requestBrowserHostWorldDefinition,
    parseBrowserHostShops,
    parseBrowserHostWorldDefinition,
    parseEditModeWorldDefinition,
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

const parsedWorld = {
    spawn: { x: 3089, y: 3524, z: 0 },
    zones: [{ minX: 1, maxX: 2, minY: 3, maxY: 4, z: 0, tags: ["pvp"] }],
    disabledPlugins: ["PvpMode"],
    experienceMultiplier: 5,
};
for (const tags of [[], ["pvp"], ["pvp", "multi-combat"]]) {
    const world = { ...parsedWorld, zones: [{ tags }, ...parsedWorld.zones] };
    const parsed = parseBrowserHostWorldDefinition(JSON.stringify(world));
    assert.deepEqual(parsed, world, "Global rules must not reject the spawn or be lost on save");
    assert.deepEqual(parseBrowserHostWorldDefinition(JSON.stringify(parsed)), world);
}
for (const zone of [{ minX: 1, tags: ["pvp"] }, { tags: ["unknown"] }, { ...parsedWorld.zones[0], tags: [] }]) {
    assert.throws(() => parseEditModeWorldDefinition({ ...parsedWorld, zones: [zone] }));
}
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
                        contents: JSON.stringify({ spawn: { x: 3089, y: 3524, z: 2 }, zones: [{ tags: [] }] }),
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
    assert.deepEqual(definition.spawn, { x: 3089, y: 3524, z: 2 });
    assert.deepEqual(sent, [{ message: { type: WORLD_DEFINITION_REQUEST_MESSAGE }, origin: "https://host.rsps.test" }]);
    assert.equal(listeners.size, 0, "reply listener is removed after the host responds");
    (globalThis as any).window = originalWindow;
    console.log("Browser-host world-definition handshake passed");
});
