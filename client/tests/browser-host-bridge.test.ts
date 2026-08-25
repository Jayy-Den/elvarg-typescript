import assert from "node:assert/strict";
import {
    bridgeBinaryTransports,
    MAX_GAME_MESSAGE_BYTES,
    MAX_QUEUED_BYTES,
    type BinaryTransport,
} from "../browserHost/BinaryBridge";

class FakeTransport implements BinaryTransport {
    bufferedAmount = 0;
    bufferedAmountLowThreshold = 0;
    sent: ArrayBuffer[] = [];
    closed = false;
    private listeners = new Map<string, Set<(event: any) => void>>();

    constructor(public readyState: string) {}

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
    const rtc = new FakeTransport("connecting");
    const server = new FakeTransport("open");
    bridgeBinaryTransports(rtc, server);
    server.emit("message", { data: Uint8Array.of(1, 2, 3) });
    assert.equal(rtc.sent.length, 0, "welcome frame waits for RTC");
    rtc.readyState = "open";
    rtc.emit("open");
    assert.deepEqual(Array.from(new Uint8Array(rtc.sent[0])), [1, 2, 3]);
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

console.log("browser host bridge: ok");
