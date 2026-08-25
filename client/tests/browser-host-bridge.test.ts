import assert from "node:assert/strict";
import {
    bridgeBinaryTransports,
    MAX_GAME_MESSAGE_BYTES,
    MAX_QUEUED_BYTES,
    type BinaryTransport,
} from "../browserHost/BinaryBridge";
import { BrowserWorldConnector } from "../browserHost/BrowserWorldConnector";
import { DEFAULT_MY_SERVER_PLUGIN } from "../browserHost/MyServerPlugin";
import { fetchInterfaceDefinition, getContentApiBase } from "../network/serverConnection/contentApi";
import { state } from "../network/serverConnection/state";

class FakeTransport implements BinaryTransport {
    bufferedAmount = 0;
    bufferedAmountLowThreshold = 0;
    sent: ArrayBuffer[] = [];
    closed = false;
    private listeners = new Map<string, Set<(event: any) => void>>();

    constructor(public readyState: string | number) {}

    send(data: ArrayBuffer): void {
        this.sent.push(data);
    }

    close(): void {
        this.closed = true;
        this.readyState = "closed";
    }

    addEventListener(type: string, listener: (event: any) => void): void {
        const listeners = this.listeners.get(type) ?? new Set();
        listeners.add(listener);
        this.listeners.set(type, listeners);
    }

    removeEventListener(type: string, listener: (event: any) => void): void {
        this.listeners.get(type)?.delete(listener);
    }

    emit(type: string, event: any = {}): void {
        for (const listener of this.listeners.get(type) ?? []) listener(event);
    }
}

{
    const pluginModule: any = { exports: {} };
    new Function("module", DEFAULT_MY_SERVER_PLUGIN)(pluginModule);
    let onLogin: any;
    pluginModule.exports.register({ onPlayerLogin: (hook: any) => { onLogin = hook; } });
    const messages: string[] = [];
    onLogin({ player: { getPacketSender: () => ({ sendMessage: (message: string) => messages.push(message) }) } });
    assert.equal(pluginModule.exports.name, "MyServer");
    assert.deepEqual(messages, ["Hello world!"]);
}

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
        assert.deepEqual(requested, ["/browser-host/interfaces/30003.json"]);
    } finally {
        globalThis.fetch = originalFetch;
        state.lastUrl = originalUrl;
        state.webRtcConfig = originalConfig;
    }
})();

{
    const rtc = new FakeTransport("connecting");
    const server = new FakeTransport(1);
    bridgeBinaryTransports(rtc, server);
    server.emit("message", { data: Uint8Array.of(1, 2, 3) });
    assert.equal(rtc.sent.length, 0, "welcome frame waits for RTC");
    rtc.readyState = "open";
    rtc.emit("open");
    assert.deepEqual(Array.from(new Uint8Array(rtc.sent[0])), [1, 2, 3]);
}

{
    const rtc = new FakeTransport("open");
    const server = new FakeTransport(1);
    bridgeBinaryTransports(rtc, server);
    rtc.emit("message", { data: Uint8Array.of(4, 5, 6) });
    assert.deepEqual(Array.from(new Uint8Array(server.sent[0])), [4, 5, 6], "RTC frames reach a numeric-state WebSocket");
}

{
    const rtc = new FakeTransport("open");
    const server = new FakeTransport("open");
    bridgeBinaryTransports(rtc, server);
    rtc.emit("message", { data: new Uint8Array(MAX_GAME_MESSAGE_BYTES + 1) });
    assert.equal(rtc.closed && server.closed, true, "oversized frame pair-closes both transports");
}

{
    const rtc = new FakeTransport("connecting");
    const server = new FakeTransport("open");
    bridgeBinaryTransports(rtc, server);
    for (let bytes = 0; bytes <= MAX_QUEUED_BYTES; bytes += MAX_GAME_MESSAGE_BYTES) {
        server.emit("message", { data: new Uint8Array(MAX_GAME_MESSAGE_BYTES) });
    }
    assert.equal(rtc.closed && server.closed, true, "queue overflow pair-closes both transports");
}

{
    const originalWebSocket = globalThis.WebSocket;
    const sockets: FakeSignalSocket[] = [];
    class FakeSignalSocket {
        static readonly CONNECTING = 0;
        static readonly OPEN = 1;
        readyState = FakeSignalSocket.CONNECTING;
        sent: string[] = [];
        private listeners = new Map<string, Set<(event: any) => void>>();

        constructor(public readonly url: string) {
            sockets.push(this);
        }

        addEventListener(type: string, listener: (event: any) => void): void {
            const listeners = this.listeners.get(type) ?? new Set();
            listeners.add(listener);
            this.listeners.set(type, listeners);
        }

        send(data: string): void {
            this.sent.push(data);
        }

        close(): void {}

        emit(type: string, event: any = {}): void {
            for (const listener of this.listeners.get(type) ?? []) listener(event);
        }
    }

    try {
        globalThis.WebSocket = FakeSignalSocket as any;
        const statuses: string[] = [];
        const connector = new BrowserWorldConnector({
            signalUrl: "ws://localhost:8787",
            gameServerUrl: "http://localhost:43594",
            worldId: "test-world",
            worldName: "Test World",
            token: "  dev-token  ",
            iceServers: [],
            onLog: () => {},
            onStatus: (status) => statuses.push(status),
            onPeerCount: () => {},
        });
        connector.start();
        sockets[0].readyState = FakeSignalSocket.OPEN;
        sockets[0].emit("open");
        assert.equal(JSON.parse(sockets[0].sent[0]).token, "dev-token", "registration trims token whitespace");
        sockets[0].emit("message", { data: JSON.stringify({ type: "error", message: "registration_rejected" }) });
        sockets[0].emit("close");
        assert.equal(statuses.at(-1), "relay rejected Server token", "auth rejection remains visible");
        assert.equal(sockets.length, 1, "auth rejection does not reconnect");
    } finally {
        globalThis.WebSocket = originalWebSocket;
    }
}

void contentApiTest
    .then(() => console.log("browser host bridge: ok"))
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
