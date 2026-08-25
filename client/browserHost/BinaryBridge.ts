export const MAX_GAME_MESSAGE_BYTES = 4096;
export const MAX_QUEUED_BYTES = 64 * 1024;

export type BinaryTransport = {
    readyState: string | number;
    bufferedAmount: number;
    bufferedAmountLowThreshold?: number;
    send(data: ArrayBuffer): void;
    close(): void;
    addEventListener(type: string, listener: (event: any) => void): void;
    removeEventListener(type: string, listener: (event: any) => void): void;
};

type BridgeOptions = {
    onOpen?: () => void;
    onClose?: () => void;
    onError?: (error: Error) => void;
};

type Queue = { frames: ArrayBuffer[]; bytes: number };

function isOpen(transport: BinaryTransport): boolean {
    return transport.readyState === "open" || transport.readyState === 1;
}

function binaryFrame(data: unknown): ArrayBuffer | undefined {
    if (data instanceof ArrayBuffer) return data.slice(0);
    if (!ArrayBuffer.isView(data)) return undefined;
    const copy = new Uint8Array(data.byteLength);
    copy.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    return copy.buffer;
}

export function bridgeBinaryTransports(
    left: BinaryTransport,
    right: BinaryTransport,
    options: BridgeOptions = {},
): { close: () => void } {
    const toLeft: Queue = { frames: [], bytes: 0 };
    const toRight: Queue = { frames: [], bytes: 0 };
    let closed = false;
    let opened = false;
    let retry: ReturnType<typeof setTimeout> | undefined;

    left.bufferedAmountLowThreshold = MAX_QUEUED_BYTES / 2;
    right.bufferedAmountLowThreshold = MAX_QUEUED_BYTES / 2;

    const close = () => {
        if (closed) return;
        closed = true;
        if (retry) clearTimeout(retry);
        for (const [transport, listeners] of [[left, leftListeners], [right, rightListeners]] as const) {
            for (const [type, listener] of listeners) transport.removeEventListener(type, listener);
            try { transport.close(); } catch {}
        }
        options.onClose?.();
    };

    const fail = (message: string) => {
        options.onError?.(new Error(message));
        close();
    };

    const transportFailure = (side: "peer" | "game") => (event: Event & { error?: Error; message?: string }) => {
        const detail = event.error?.message ?? event.message;
        fail(`Binary bridge ${side} transport failed${detail ? `: ${detail}` : ""}`);
    };

    const schedule = () => {
        if (retry || closed) return;
        retry = setTimeout(() => {
            retry = undefined;
            flush();
        }, 10);
    };

    const pump = (target: BinaryTransport, queue: Queue) => {
        while (
            isOpen(target) &&
            target.bufferedAmount < MAX_QUEUED_BYTES &&
            queue.frames.length > 0
        ) {
            const frame = queue.frames.shift()!;
            queue.bytes -= frame.byteLength;
            try {
                target.send(frame);
            } catch {
                fail("Binary bridge send failed");
                return;
            }
        }
        if (queue.frames.length > 0) schedule();
    };

    const flush = () => {
        if (closed) return;
        pump(left, toLeft);
        pump(right, toRight);
        if (!opened && isOpen(left) && isOpen(right)) {
            opened = true;
            options.onOpen?.();
        }
    };

    const forward = (target: BinaryTransport, queue: Queue, raw: unknown) => {
        const frame = binaryFrame(raw);
        if (!frame) {
            fail("Binary bridge rejected a non-binary message");
            return;
        }
        if (frame.byteLength > MAX_GAME_MESSAGE_BYTES) {
            fail(`Binary bridge rejected a message over ${MAX_GAME_MESSAGE_BYTES} bytes`);
            return;
        }
        if (queue.bytes + frame.byteLength > MAX_QUEUED_BYTES) {
            fail(`Binary bridge queue exceeded ${MAX_QUEUED_BYTES} bytes`);
            return;
        }
        queue.frames.push(frame);
        queue.bytes += frame.byteLength;
        flush();
    };

    const leftListeners = [
        ["message", (event: MessageEvent) => forward(right, toRight, event.data)],
        ["open", flush],
        ["bufferedamountlow", flush],
        ["close", close],
        ["error", transportFailure("peer")],
    ] as const;
    const rightListeners = [
        ["message", (event: MessageEvent) => forward(left, toLeft, event.data)],
        ["open", flush],
        ["bufferedamountlow", flush],
        ["close", close],
        ["error", transportFailure("game")],
    ] as const;
    for (const [type, listener] of leftListeners) left.addEventListener(type, listener);
    for (const [type, listener] of rightListeners) right.addEventListener(type, listener);
    flush();

    return { close };
}
