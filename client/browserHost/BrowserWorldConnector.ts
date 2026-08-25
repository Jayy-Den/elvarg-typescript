import {
    bridgeBinaryTransports,
    type BinaryTransport,
} from "./BinaryBridge";
import { WebContainerGameSocket } from "./WebContainerGameSocket";

type SignalDescription = { type: "offer" | "answer"; sdp: string };
type SignalCandidate = RTCIceCandidateInit;
type PeerState = {
    peer: RTCPeerConnection;
    channel?: RTCDataChannel;
    gameSocket?: BinaryTransport;
    bridge?: { close: () => void };
    pendingCandidates: SignalCandidate[];
    remoteDescriptionSet: boolean;
    connected: boolean;
    timeout: ReturnType<typeof setTimeout>;
};

export type BrowserWorldConnectorOptions = {
    signalUrl: string;
    gameServerUrl: string;
    worldId: string;
    worldName: string;
    token: string;
    iceServers: RTCIceServer[];
    onLog: (message: string) => void;
    onStatus: (status: string) => void;
    onPeerCount: (count: number) => void;
};

function signallingEndpoint(raw: string): string {
    const url = new URL(raw);
    if (url.protocol !== "ws:" && url.protocol !== "wss:") {
        throw new Error("Relay URL must use ws:// or wss://");
    }
    if (url.pathname === "/") url.pathname = "/signal";
    return url.toString();
}

export class BrowserWorldConnector {
    private signal?: WebSocket;
    private reconnectTimer?: ReturnType<typeof setTimeout>;
    private readonly peers = new Map<string, PeerState>();
    private running = false;
    private playerCount = 0;
    private readonly signalUrl: string;
    private readonly gameServerUrl: string;
    private readonly token: string;

    constructor(private readonly options: BrowserWorldConnectorOptions) {
        if (!/^[A-Za-z0-9._-]{1,64}$/.test(options.worldId)) {
            throw new Error("World ID must be 1-64 letters, numbers, dots, underscores, or dashes");
        }
        if (!options.worldName.trim() || options.worldName.length > 64) {
            throw new Error("World name must be 1-64 characters");
        }
        this.token = options.token.trim();
        if (!this.token) throw new Error("Forum world token is required");
        this.signalUrl = signallingEndpoint(options.signalUrl);
        this.gameServerUrl = new URL(options.gameServerUrl).toString();
    }

    start(): void {
        if (this.running) return;
        this.running = true;
        this.connect();
    }

    stop(): void {
        if (!this.running) return;
        this.running = false;
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = undefined;
        for (const sessionId of [...this.peers.keys()]) this.closePeer(sessionId);
        try { this.signal?.close(1000, "browser world stopped"); } catch {}
        this.signal = undefined;
        this.options.onStatus("stopped");
    }

    setPlayerCount(playerCount: number): void {
        this.playerCount = Math.max(0, Math.min(2047, Math.trunc(playerCount)));
        this.send({ type: "world-status", playerCount: this.playerCount });
    }

    private connect(): void {
        if (!this.running || this.signal?.readyState === WebSocket.OPEN || this.signal?.readyState === WebSocket.CONNECTING) return;
        this.options.onStatus("connecting to relay");
        const signal = new WebSocket(this.signalUrl);
        this.signal = signal;
        signal.addEventListener("open", () => {
            this.send({
                type: "register",
                worldId: this.options.worldId,
                name: this.options.worldName.trim(),
                playerCount: this.playerCount,
                token: this.token,
            });
        });
        signal.addEventListener("message", (event) => {
            void this.handleSignal(event.data).catch((error) => {
                this.options.onLog(`Signalling failed: ${(error as Error).message}`);
            });
        });
        signal.addEventListener("error", () => this.options.onLog("Relay WebSocket error"));
        signal.addEventListener("close", () => {
            if (signal !== this.signal) return;
            this.signal = undefined;
            for (const [sessionId, state] of this.peers) {
                if (!state.channel) this.closePeer(sessionId);
            }
            if (!this.running) return;
            this.options.onStatus("relay disconnected; retrying");
            this.reconnectTimer = setTimeout(() => this.connect(), 1000);
        });
    }

    private async handleSignal(raw: unknown): Promise<void> {
        if (typeof raw !== "string") return;
        const message = JSON.parse(raw);
        if (!message || typeof message.type !== "string") return;
        if (message.type === "registered") {
            this.options.onStatus("online");
            this.options.onLog(`World ${this.options.worldId} registered with relay`);
            return;
        }
        if (message.type === "status-request") {
            this.send({ type: "world-status", playerCount: this.playerCount });
            return;
        }
        if (message.type === "error" && typeof message.sessionId !== "string") {
            this.running = false;
            this.options.onStatus(message.message === "registration_rejected"
                ? "relay rejected Server token"
                : "relay rejected registration");
            this.options.onLog(`Relay rejected world: ${message.message ?? "unknown error"}`);
            return;
        }
        const sessionId = typeof message.sessionId === "string" ? message.sessionId : "";
        if (!sessionId) return;
        if (message.type === "session-open") {
            this.openPeer(sessionId);
            return;
        }
        const state = this.peers.get(sessionId);
        if (!state) return;
        if (message.type === "offer") {
            await this.acceptOffer(sessionId, state, message.description);
        } else if (message.type === "ice-candidate" && message.candidate) {
            if (state.remoteDescriptionSet) await state.peer.addIceCandidate(message.candidate);
            else state.pendingCandidates.push(message.candidate);
        } else if (message.type === "session-close") {
            if (!state.channel) this.closePeer(sessionId);
        } else if (message.type === "session-error") {
            this.closePeer(sessionId);
        }
    }

    private openPeer(sessionId: string): void {
        this.closePeer(sessionId);
        const peer = new RTCPeerConnection({ iceServers: this.options.iceServers });
        const state: PeerState = {
            peer,
            pendingCandidates: [],
            remoteDescriptionSet: false,
            connected: false,
            timeout: setTimeout(() => this.failSession(sessionId, "negotiation_timeout"), 30_000),
        };
        this.peers.set(sessionId, state);
        peer.onicecandidate = (event) => {
            if (event.candidate) {
                this.send({ type: "ice-candidate", sessionId, candidate: event.candidate.toJSON() });
            }
        };
        peer.ondatachannel = (event) => this.acceptDataChannel(sessionId, state, event.channel);
        peer.onconnectionstatechange = () => {
            if (peer.connectionState === "failed" || peer.connectionState === "closed") {
                this.closePeer(sessionId);
            }
        };
    }

    private async acceptOffer(sessionId: string, state: PeerState, description: SignalDescription): Promise<void> {
        if (!description || description.type !== "offer" || typeof description.sdp !== "string") {
            this.failSession(sessionId, "invalid_offer");
            return;
        }
        try {
            await state.peer.setRemoteDescription(description);
            state.remoteDescriptionSet = true;
            for (const candidate of state.pendingCandidates.splice(0)) {
                await state.peer.addIceCandidate(candidate);
            }
            const answer = await state.peer.createAnswer();
            await state.peer.setLocalDescription(answer);
            this.send({ type: "answer", sessionId, description: state.peer.localDescription });
        } catch (error) {
            this.options.onLog(`Session ${sessionId} negotiation failed: ${(error as Error).message}`);
            this.failSession(sessionId, "negotiation_failed");
        }
    }

    private acceptDataChannel(sessionId: string, state: PeerState, channel: RTCDataChannel): void {
        if (
            channel.label !== "game" ||
            !channel.ordered ||
            channel.maxRetransmits !== null ||
            channel.maxPacketLifeTime !== null
        ) {
            channel.close();
            this.failSession(sessionId, "invalid_game_channel");
            return;
        }
        try {
            const gameSocket = new WebContainerGameSocket(this.gameServerUrl);
            channel.binaryType = "arraybuffer";
            state.channel = channel;
            state.gameSocket = gameSocket;
            state.bridge = bridgeBinaryTransports(
                channel as unknown as BinaryTransport,
                gameSocket,
                {
                    onOpen: () => {
                        if (state.connected) return;
                        state.connected = true;
                        clearTimeout(state.timeout);
                        this.options.onLog(`Guest ${sessionId} connected`);
                        this.emitPeerCount();
                    },
                    onClose: () => this.closePeer(sessionId),
                    onError: (error) => this.options.onLog(`Guest ${sessionId}: ${error.message}`),
                },
            );
        } catch (error) {
            this.options.onLog(`Could not open local game socket: ${(error as Error).message}`);
            this.failSession(sessionId, "game_socket_failed");
        }
    }

    private failSession(sessionId: string, message: string): void {
        this.send({ type: "session-error", sessionId, message });
        this.closePeer(sessionId);
    }

    private closePeer(sessionId: string): void {
        const state = this.peers.get(sessionId);
        if (!state) return;
        this.peers.delete(sessionId);
        clearTimeout(state.timeout);
        state.bridge?.close();
        try { state.gameSocket?.close(); } catch {}
        try { state.channel?.close(); } catch {}
        try { state.peer.close(); } catch {}
        if (state.connected) {
            this.options.onLog(`Guest ${sessionId} disconnected`);
            this.emitPeerCount();
        }
    }

    private emitPeerCount(): void {
        this.options.onPeerCount([...this.peers.values()].filter((peer) => peer.connected).length);
    }

    private send(message: Record<string, unknown>): void {
        if (this.signal?.readyState === WebSocket.OPEN) {
            this.signal.send(JSON.stringify(message));
        }
    }
}
