import { useCallback, useEffect, useRef, useState } from "react";
import type { FileSystemTree, WebContainerProcess } from "@webcontainer/api";

import { getWebRtcRelayConfig } from "../config/clientEnv";
import { BrowserWorldConnector } from "./BrowserWorldConnector";
import { DEFAULT_MY_SERVER_PLUGIN } from "./MyServerPlugin";
import { REGION_PACK_MESSAGE, type RegionPackMessage } from "./regionPackMessage";
import "./host.css";

type RuntimeSnapshot = {
    version: number;
    tree: FileSystemTree;
};

const relayDefaults = getWebRtcRelayConfig();
const signalUrl = relayDefaults?.signalUrl ?? "wss://worlds.rsps.app";
const iceServers = relayDefaults?.iceServers ?? [];
const initialWorldId = `browser-${Math.random().toString(36).slice(2, 8)}`;

export default function HostPage() {
    const [pluginSource, setPluginSource] = useState(DEFAULT_MY_SERVER_PLUGIN);
    const [worldId, setWorldId] = useState(initialWorldId);
    const [worldName, setWorldName] = useState("Browser World");
    const [token, setToken] = useState("");
    const [status, setStatus] = useState("loading runtime snapshot");
    const [logs, setLogs] = useState<string[]>([]);
    const [playerCount, setPlayerCount] = useState(0);
    const [peerCount, setPeerCount] = useState(0);
    const [memory, setMemory] = useState<string>();
    const [copyLabel, setCopyLabel] = useState("Copy");
    const [busy, setBusy] = useState(false);
    const [regionPacks, setRegionPacks] = useState<{ regionId: number; bytes: number }[]>([]);
    const snapshotRef = useRef<RuntimeSnapshot | undefined>(undefined);
    const containerRef = useRef<import("@webcontainer/api").WebContainer | undefined>(undefined);
    const processRef = useRef<WebContainerProcess | undefined>(undefined);
    const connectorRef = useRef<BrowserWorldConnector | undefined>(undefined);
    const logRef = useRef<HTMLPreElement | null>(null);
    const installedRef = useRef(false);
    const mountedRef = useRef(false);
    const operationRef = useRef(0);
    /** Exported region packs, kept so a restart (or a later Start) can re-apply them. */
    const regionPacksRef = useRef(new Map<number, Uint8Array>());

    const addLog = useCallback((message: string) => {
        const ansiColor = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
        const lines = message.replace(ansiColor, "").split(/\r?\n/).filter(Boolean);
        if (lines.length === 0) return;
        setLogs((current) => [...current, ...lines].slice(-300));
    }, []);

    useEffect(() => {
        if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
        setCopyLabel("Copy");
    }, [logs]);

    const copyLogs = async () => {
        try {
            await navigator.clipboard.writeText(logs.join("\n"));
            setCopyLabel("Copied");
        } catch {
            setCopyLabel("Copy failed");
        }
    };

    const stopWorld = useCallback(() => {
        operationRef.current++;
        connectorRef.current?.stop();
        connectorRef.current = undefined;
        processRef.current?.kill();
        processRef.current = undefined;
        setBusy(false);
        setPlayerCount(0);
        setPeerCount(0);
        setStatus("stopped");
    }, []);

    useEffect(() => {
        let cancelled = false;
        const publicUrl = process.env.PUBLIC_URL ?? "";
        fetch(`${publicUrl}/browser-host/runtime.json`, { cache: "no-store" })
            .then(async (response) => {
                if (!response.ok) throw new Error(`runtime snapshot returned HTTP ${response.status}`);
                return response.json() as Promise<RuntimeSnapshot>;
            })
            .then((snapshot) => {
                if (cancelled) return;
                if (snapshot.version !== 2 || !snapshot.tree) {
                    throw new Error("runtime snapshot has an unsupported format");
                }
                snapshotRef.current = snapshot;
                setStatus("ready");
            })
            .catch((error) => {
                if (cancelled) return;
                setStatus("snapshot unavailable");
                addLog(`${(error as Error).message}. Run \`yarn browser-host:prepare\` first.`);
            });
        return () => {
            cancelled = true;
            // eslint-disable-next-line react-hooks/exhaustive-deps
            operationRef.current++;
            connectorRef.current?.stop();
            processRef.current?.kill();
            containerRef.current?.teardown();
        };
    }, [addLog]);

    /** RegionManager reads data/regions/*.pack from the server cwd on startup. */
    const writeRegionPacks = useCallback(async (
        container: import("@webcontainer/api").WebContainer,
    ) => {
        if (regionPacksRef.current.size === 0) return;
        await container.fs.mkdir("data/regions", { recursive: true });
        for (const [regionId, data] of regionPacksRef.current) {
            await container.fs.writeFile(`data/regions/${regionId}.pack`, data);
        }
    }, []);

    useEffect(() => {
        const onMessage = (event: MessageEvent) => {
            if (event.origin !== window.location.origin) return;
            const message = event.data as RegionPackMessage | undefined;
            if (message?.type !== REGION_PACK_MESSAGE) return;
            const regionId = Number(message.regionId);
            const data = message.data;
            if (!Number.isInteger(regionId) || regionId < 0 || regionId > 0xffff ||
                !(data instanceof Uint8Array) || data.length < 28) {
                addLog("[edit] ignored a malformed region pack from the editor");
                return;
            }
            regionPacksRef.current.set(regionId, data);
            setRegionPacks(
                Array.from(regionPacksRef.current, ([id, pack]) => ({ regionId: id, bytes: pack.length }))
                    .sort((a, b) => a.regionId - b.regionId),
            );
            const container = containerRef.current;
            const write = container && mountedRef.current
                ? writeRegionPacks(container)
                : Promise.resolve();
            void write.then(
                () => addLog(`[edit] saved data/regions/${regionId}.pack (${data.length} bytes); Restart to apply`),
                (error: Error) => addLog(`[edit] could not save ${regionId}.pack: ${error.message}`),
            );
        };
        window.addEventListener("message", onMessage);
        return () => window.removeEventListener("message", onMessage);
    }, [addLog, writeRegionPacks]);

    const startWorld = async () => {
        const snapshot = snapshotRef.current;
        if (!snapshot) return;
        const operation = ++operationRef.current;
        setBusy(true);
        setLogs([]);
        try {
            if (!window.crossOriginIsolated) {
                throw new Error("/host must be served with COOP/COEP headers (localhost or HTTPS)");
            }
            if (!/^[A-Za-z0-9._-]{1,64}$/.test(worldId)) throw new Error("World ID is invalid");
            if (!worldName.trim() || worldName.length > 64) throw new Error("World name is invalid");
            if (!token.trim()) throw new Error("Forum world token is required");
            const relayUrl = new URL(signalUrl);
            if (relayUrl.protocol !== "ws:" && relayUrl.protocol !== "wss:") {
                throw new Error("Relay URL must use ws:// or wss://");
            }
            if (relayUrl.hostname === "worlds.rsps.app" && !/^[A-Za-z0-9_-]{43}$/.test(token.trim())) {
                throw new Error("Public relay requires a 43-character Server token from RSPS.app settings");
            }

            let container = containerRef.current;
            if (!container) {
                setStatus("booting WebContainer");
                const { WebContainer } = await import("@webcontainer/api");
                container = await WebContainer.boot({ coep: "require-corp", workdirName: "elvarg" });
                containerRef.current = container;
                container.on("error", (error) => addLog(`WebContainer: ${error.message}`));
            }
            if (operation !== operationRef.current) return;
            if (!mountedRef.current) {
                setStatus("mounting server runtime");
                await container.mount(snapshot.tree);
                mountedRef.current = true;
            }
            if (operation !== operationRef.current) return;
            if (!installedRef.current) {
                setStatus("installing browser-safe server dependencies");
                const install = await container.spawn("npm", ["install", "--omit=optional", "--no-audit", "--no-fund"]);
                processRef.current = install;
                void install.output.pipeTo(new WritableStream({ write: addLog })).catch(() => {});
                const exitCode = await install.exit;
                processRef.current = undefined;
                if (exitCode !== 0) throw new Error(`npm install exited with ${exitCode}`);
                installedRef.current = true;
            }
            if (operation !== operationRef.current) return;

            await writeRegionPacks(container);

            setStatus("checking MyServer plugin");
            await container.fs.writeFile("plugins/MyServer.plugin.js", pluginSource);
            const check = await container.spawn("node", ["--check", "plugins/MyServer.plugin.js"]);
            processRef.current = check;
            void check.output.pipeTo(new WritableStream({ write: addLog })).catch(() => {});
            const checkExitCode = await check.exit;
            processRef.current = undefined;
            if (checkExitCode !== 0) throw new Error("MyServer plugin has a syntax error");
            if (operation !== operationRef.current) return;

            setStatus("starting Elvarg (first cache download can take several minutes)");
            let resolveServer!: (url: string) => void;
            let rejectServer!: (error: Error) => void;
            const serverReady = new Promise<string>((resolve, reject) => {
                resolveServer = resolve;
                rejectServer = reject;
            });
            const unsubscribe = container.on("server-ready", (port, url) => {
                if (port === 43594) {
                    unsubscribe();
                    resolveServer(url);
                }
            });
            const serverProcess = await container.spawn(
                "node",
                ["dist/Server.js", "1"],
                {
                    env: {
                        BROWSER_HOST: "1",
                        WEBSOCKET_PORT: "43594",
                        BOT_RUNTIME_EVENT_LOGGING: "0",
                        BOT_RUNTIME_TELEMETRY_ENABLED: "0",
                        BOT_TASK_PROFILER_ENABLED: "0",
                    },
                },
            );
            processRef.current = serverProcess;
            void serverProcess.output.pipeTo(new WritableStream({ write: addLog })).catch(() => {});
            void serverProcess.exit.then((code) => {
                unsubscribe();
                rejectServer(new Error(`Elvarg exited with ${code}`));
                if (processRef.current === serverProcess) {
                    processRef.current = undefined;
                    connectorRef.current?.stop();
                    connectorRef.current = undefined;
                    setStatus(`server exited (${code})`);
                }
            });
            if (operation !== operationRef.current) {
                unsubscribe();
                serverProcess.kill();
                processRef.current = undefined;
                return;
            }
            const gameServerUrl = await serverReady;
            if (operation !== operationRef.current) return;

            const connector = new BrowserWorldConnector({
                signalUrl,
                gameServerUrl,
                worldId,
                worldName,
                token,
                iceServers,
                onLog: addLog,
                onStatus: setStatus,
                onPeerCount: (count) => {
                    setPeerCount(count);
                    setPlayerCount(count);
                    connectorRef.current?.setPlayerCount(count);
                },
            });
            connectorRef.current = connector;
            connector.start();
            setBusy(false);
        } catch (error) {
            if (operation !== operationRef.current) return;
            connectorRef.current?.stop();
            connectorRef.current = undefined;
            processRef.current?.kill();
            processRef.current = undefined;
            addLog((error as Error).message);
            setStatus("failed");
            setBusy(false);
        }
    };

    const restartWorld = async () => {
        stopWorld();
        await startWorld();
    };

    const measureMemory = async () => {
        const measure = (performance as Performance & {
            measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }>;
        }).measureUserAgentSpecificMemory;
        if (!measure) {
            setMemory("Unavailable in this browser");
            return;
        }
        try {
            const result = await measure.call(performance);
            setMemory(`${(result.bytes / 1024 / 1024).toFixed(1)} MiB for this page`);
        } catch (error) {
            setMemory(`Unavailable: ${(error as Error).message}`);
        }
    };

    const running = Boolean(processRef.current && connectorRef.current);

    return (
        <main className="host-page">
            <header className="host-header">
                <div>
                    <h1>Start New Server</h1>
                    <p>Keep this host window visible; background tabs throttle the server.</p>
                </div>
                <div className="host-header-actions">
                    <button type="button" onClick={() => window.open("/", "elvarg-client", "popup,width=1280,height=800")}>Open Client Window</button>
                    <button type="button" onClick={() => window.open("/?edit=1", "elvarg-editor", "popup,width=1440,height=900")}>Edit Mode</button>
                </div>
            </header>

            <section className="host-settings" aria-label="World settings">
                <label>World ID<input value={worldId} onChange={(event) => setWorldId(event.target.value)} disabled={running || busy} /></label>
                <label>World name<input value={worldName} onChange={(event) => setWorldName(event.target.value)} disabled={running || busy} /></label>
                <label>Forum Server token<input type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} disabled={running || busy} /></label>
            </section>

            <section className="host-toolbar">
                <button type="button" onClick={() => void startWorld()} disabled={busy || running || !snapshotRef.current}>Start</button>
                <button type="button" onClick={stopWorld} disabled={!busy && !running}>Stop</button>
                <button type="button" onClick={() => void restartWorld()} disabled={!running}>Restart &amp; apply MyServer</button>
                <span>Status: <strong>{status}</strong></span>
                <span>Players: <strong>{playerCount}</strong></span>
                <span>WebRTC peers: <strong>{peerCount}</strong></span>
                <button type="button" onClick={() => void measureMemory()}>Measure memory</button>
                <span>{memory ?? ("measureUserAgentSpecificMemory" in performance ? "Not measured" : "Memory measurement unavailable")}</span>
                <span>
                    Edited regions:{" "}
                    <strong>
                        {regionPacks.length === 0
                            ? "none"
                            : regionPacks.map((pack) => `${pack.regionId}.pack`).join(", ")}
                    </strong>
                </span>
            </section>

            <section className="host-workspace">
                <label className="host-panel">
                    <span>MyServer.plugin.js (restart to apply)</span>
                    <textarea value={pluginSource} onChange={(event) => setPluginSource(event.target.value)} spellCheck={false} />
                </label>
                <div className="host-panel">
                    <div className="host-panel-heading">
                        <span>Server log</span>
                        <button type="button" onClick={() => void copyLogs()} disabled={logs.length === 0}>{copyLabel}</button>
                    </div>
                    <pre ref={logRef} aria-live="polite">{logs.join("\n") || "No output yet."}</pre>
                </div>
            </section>
        </main>
    );
}
