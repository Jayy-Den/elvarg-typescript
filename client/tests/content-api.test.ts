import assert from "node:assert/strict";
import { fetchInterfaceDefinition, getContentApiBase } from "../network/serverConnection/contentApi";
import { state } from "../network/serverConnection/state";

const contentApiTest = (async () => {
    const originalFetch = globalThis.fetch;
    const originalUrl = state.lastUrl;
    const originalConfig = state.webRtcConfig;
    const requested: string[] = [];
    try {
        state.lastUrl = "wss://worlds.rsps.app";
        state.webRtcConfig = { signalUrl: state.lastUrl, worldId: "browser-test", iceServers: [] };
        globalThis.fetch = (async (url: string | URL | Request) => {
            requested.push(String(url));
            return {
                ok: true,
                status: 200,
                json: async () => ({ groupId: 30003, widgets: [] }),
            } as Response;
        }) as typeof fetch;
        assert.equal(getContentApiBase(), undefined, "the signalling relay is not a content server");
        assert.equal((await fetchInterfaceDefinition(30003))?.groupId, 30003);
        assert.match(requested[0], /^\/browser-host\/interfaces\/30003\.json\?v=\d+$/);
    } finally {
        globalThis.fetch = originalFetch;
        state.lastUrl = originalUrl;
        state.webRtcConfig = originalConfig;
    }
})();

void contentApiTest.catch((error) => { console.error(error); process.exitCode = 1; });
