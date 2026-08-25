import type { BinaryTransport } from "./BinaryBridge";

type BridgeMessage = {
    type: "open" | "message" | "sent" | "error" | "close";
    data?: ArrayBuffer;
    bytes?: number;
    message?: string;
};

export class WebContainerGameSocket extends EventTarget implements BinaryTransport {
    public readyState: string = "connecting";
    public bufferedAmount = 0;
    public bufferedAmountLowThreshold = 0;
    private readonly iframe = document.createElement("iframe");
    private readonly channel = new MessageChannel();
    private readonly timeout: ReturnType<typeof setTimeout>;
    private cleanupTimer?: ReturnType<typeof setTimeout>;
    private previewLoaded = false;
    private bridgeReady = false;
    private readonly previewMessage = (event: MessageEvent) => {
        if (event.source !== this.iframe.contentWindow || event.data !== "browser-host-ready") return;
        this.bridgeReady = true;
        window.removeEventListener("message", this.previewMessage);
        const target = this.iframe.contentWindow;
        if (!target) {
            this.fail("WebContainer preview bridge window is unavailable");
            return;
        }
        try {
            target.postMessage("browser-host-connect", event.origin, [this.channel.port2]);
        } catch (error) {
            this.fail(`WebContainer preview bridge failed: ${(error as Error).message}`);
        }
    };

    constructor(serverUrl: string) {
        super();
        const bridgeUrl = new URL(serverUrl);
        this.iframe.setAttribute("aria-hidden", "true");
        this.iframe.tabIndex = -1;
        Object.assign(this.iframe.style, {
            position: "fixed",
            width: "1px",
            height: "1px",
            left: "-10px",
            top: "-10px",
            border: "0",
            opacity: "0",
            pointerEvents: "none",
        });
        this.iframe.src = bridgeUrl.toString();
        window.addEventListener("message", this.previewMessage);
        this.iframe.addEventListener("load", () => { this.previewLoaded = true; }, { once: true });
        this.iframe.addEventListener("error", () => this.fail("WebContainer bridge page failed to load"), { once: true });
        this.channel.port1.addEventListener("message", (event) => this.receive(event.data));
        this.channel.port1.addEventListener("messageerror", () => this.fail("WebContainer bridge message failed"));
        this.channel.port1.start();
        document.body.append(this.iframe);
        this.timeout = setTimeout(() => this.fail(!this.previewLoaded
            ? "WebContainer preview did not load"
            : !this.bridgeReady
                ? "WebContainer preview loaded but its bridge script did not start"
                : "WebContainer preview bridge started but its HTTP session did not open"), 10_000);
    }

    public send(data: ArrayBuffer): void {
        if (this.readyState !== "open") throw new DOMException("WebContainer game socket is not open", "InvalidStateError");
        this.bufferedAmount += data.byteLength;
        this.channel.port1.postMessage({ type: "message", data }, [data]);
    }

    public close(): void {
        if (this.readyState === "closed") return;
        try { this.channel.port1.postMessage({ type: "close" }); } catch {}
        this.finishClose();
    }

    private receive(message: BridgeMessage): void {
        if (!message || typeof message.type !== "string") return;
        if (message.type === "close") {
            this.finishClose();
            this.cleanup();
            return;
        }
        if (this.readyState === "closed") return;
        if (message.type === "open") {
            this.readyState = "open";
            clearTimeout(this.timeout);
            this.dispatchEvent(new Event("open"));
        } else if (message.type === "message" && message.data instanceof ArrayBuffer) {
            this.dispatchEvent(new MessageEvent("message", { data: message.data }));
        } else if (message.type === "sent" && Number.isSafeInteger(message.bytes) && message.bytes! >= 0) {
            const previous = this.bufferedAmount;
            this.bufferedAmount = Math.max(0, previous - message.bytes!);
            if (previous > this.bufferedAmountLowThreshold && this.bufferedAmount <= this.bufferedAmountLowThreshold) {
                this.dispatchEvent(new Event("bufferedamountlow"));
            }
        } else if (message.type === "error") {
            this.fail(message.message ?? "WebContainer game socket failed");
        }
    }

    private fail(message: string): void {
        if (this.readyState === "closed") return;
        const event = new Event("error") as Event & { error?: Error };
        event.error = new Error(message);
        this.dispatchEvent(event);
    }

    private finishClose(): void {
        if (this.readyState === "closed") return;
        this.readyState = "closed";
        clearTimeout(this.timeout);
        this.cleanupTimer = setTimeout(() => this.cleanup(), 1000);
        this.dispatchEvent(new Event("close"));
    }

    private cleanup(): void {
        if (this.cleanupTimer) clearTimeout(this.cleanupTimer);
        this.cleanupTimer = undefined;
        window.removeEventListener("message", this.previewMessage);
        this.channel.port1.close();
        this.iframe.remove();
    }
}
