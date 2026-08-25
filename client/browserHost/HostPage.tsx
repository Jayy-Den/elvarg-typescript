import { useCallback, useEffect, useRef, useState } from "react";
import type { FileSystemTree, WebContainerProcess } from "@webcontainer/api";
import ts from "typescript";

import { getWebRtcRelayConfig } from "../config/clientEnv";
import { BrowserWorldConnector } from "./BrowserWorldConnector";
import "./host.css";

type RuntimeSnapshot = {
    version: number;
    worldSource: string;
    tree: FileSystemTree;
};

const relayDefaults = getWebRtcRelayConfig();
const initialWorldId = `browser-${Math.random().toString(36).slice(2, 8)}`;

function compileWorld(source: string): string {
    const result = ts.transpileModule(source, {
        fileName: "World.ts",
        reportDiagnostics: true,
        compilerOptions: {
            target: ts.ScriptTarget.ES2020,
            module: ts.ModuleKind.CommonJS,
            experimentalDecorators: true,
            downlevelIteration: true,
        },
    });
    const errors = result.diagnostics?.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error) ?? [];
    if (errors.length > 0) {
        throw new Error(errors.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")).join("\n"));
    }
    return result.outputText;
}

export default function HostPage() {
    const [worldSource, setWorldSource] = useState("");
    const [worldId, setWorldId] = useState(initialWorldId);
    const [worldName, setWorldName] = useState("Browser World");
    const [token, setToken] = useState("");
    const [signalUrl, setSignalUrl] = useState(relayDefaults?.signalUrl ?? "ws://127.0.0.1:8787");
    const [iceServers, setIceServers] = useState(JSON.stringify(relayDefaults?.iceServers ?? []));
    const [status, setStatus] = useState("loading runtime snapshot");
    const [logs, setLogs] = useState<string[]>([]);
    const [playerCount, setPlayerCount] = useState(0);
    const [peerCount, setPeerCount] = useState(0);
    const [memory, setMemory] = useState<string>();
    const [busy, setBusy] = useState(false);
    const snapshotRef = useRef<RuntimeSnapshot | undefined>(undefined);
    const containerRef = useRef<import("@webcontainer/api").WebContainer | undefined>(undefined);
    const processRef = useRef<WebContainerProcess | undefined>(undefined);
    const connectorRef = useRef<BrowserWorldConnector | undefined>(undefined);
    const installedRef = useRef(false);
    const mountedRef = useRef(false);
    const operationRef = useRef(0);
    const playerPollRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

    const addLog = useCallback((message: string) => {
        const ansiColor = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
        const lines = message.replace(ansiColor, "").split(/\r?\n/).filter(Boolean);
        if (lines.length === 0) return;
        setLogs((current) => [...current, ...lines].slice(-300));
    }, []);

    const stopWorld = useCallback(() => {
        operationRef.current++;
        if (playerPollRef.current) clearInterval(playerPollRef.current);
        playerPollRef.current = undefined;
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
        fetch(`${publicUrl}/browser-host/runtime.json`)
            .then(async (response) => {
                if (!response.ok) throw new Error(`runtime snapshot returned HTTP ${response.status}`);
                return response.json() as Promise<RuntimeSnapshot>;
            })
            .then((snapshot) => {
                if (cancelled) return;
                if (snapshot.version !== 1 || !snapshot.worldSource || !snapshot.tree) {
                    throw new Error("runtime snapshot has an unsupported format");
                }
                snapshotRef.current = snapshot;
                setWorldSource(snapshot.worldSource);
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
            if (playerPollRef.current) clearInterval(playerPollRef.current);
            connectorRef.current?.stop();
            processRef.current?.kill();
            containerRef.current?.teardown();
        };
    }, [addLog]);

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
            const parsedIceServers = JSON.parse(iceServers);
            if (!Array.isArray(parsedIceServers)) throw new Error("ICE servers must be a JSON array");
            if (!/^[A-Za-z0-9._-]{1,64}$/.test(worldId)) throw new Error("World ID is invalid");
            if (!worldName.trim() || worldName.length > 64) throw new Error("World name is invalid");
            if (!token.trim()) throw new Error("Forum world token is required");
            const relayUrl = new URL(signalUrl);
            if (relayUrl.protocol !== "ws:" && relayUrl.protocol !== "wss:") {
                throw new Error("Relay URL must use ws:// or wss://");
            }
            compileWorld(worldSource);

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

            await container.fs.writeFile("dist/game/World.js", compileWorld(worldSource));
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
                    if (playerPollRef.current) clearInterval(playerPollRef.current);
                    playerPollRef.current = undefined;
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
                iceServers: parsedIceServers,
                onLog: addLog,
                onStatus: setStatus,
                onPeerCount: setPeerCount,
            });
            connectorRef.current = connector;
            connector.start();
            const refreshPlayers = async () => {
                try {
                    const statusUrl = new URL("/browser-host-status", gameServerUrl);
                    const response = await fetch(statusUrl);
                    const value = Number((await response.json()).playerCount);
                    if (operation !== operationRef.current || !Number.isInteger(value) || value < 0) return;
                    setPlayerCount(value);
                    connector.setPlayerCount(value);
                } catch {}
            };
            await refreshPlayers();
            playerPollRef.current = setInterval(() => void refreshPlayers(), 5000);
            setBusy(false);
        } catch (error) {
            if (operation !== operationRef.current) return;
            if (playerPollRef.current) clearInterval(playerPollRef.current);
            playerPollRef.current = undefined;
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
                    <p>This temporary world exists only while this tab stays open and awake.</p>
                </div>
                <a className="host-link" href="/" target="_blank" rel="noreferrer">Open Client</a>
            </header>

            <section className="host-settings" aria-label="World settings">
                <label>World ID<input value={worldId} onChange={(event) => setWorldId(event.target.value)} disabled={running || busy} /></label>
                <label>World name<input value={worldName} onChange={(event) => setWorldName(event.target.value)} disabled={running || busy} /></label>
                <label>Forum token<input type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} disabled={running || busy} /></label>
                <label>Relay WebSocket<input value={signalUrl} onChange={(event) => setSignalUrl(event.target.value)} disabled={running || busy} /></label>
                <label className="host-wide">ICE servers JSON<input value={iceServers} onChange={(event) => setIceServers(event.target.value)} disabled={running || busy} /></label>
            </section>

            <section className="host-toolbar">
                <button type="button" onClick={() => void startWorld()} disabled={busy || running || !snapshotRef.current}>Start</button>
                <button type="button" onClick={stopWorld} disabled={!busy && !running}>Stop</button>
                <button type="button" onClick={() => void restartWorld()} disabled={!running}>Restart &amp; apply World.ts</button>
                <span>Status: <strong>{status}</strong></span>
                <span>Players: <strong>{playerCount}</strong></span>
                <span>WebRTC peers: <strong>{peerCount}</strong></span>
                <button type="button" onClick={() => void measureMemory()}>Measure memory</button>
                <span>{memory ?? ("measureUserAgentSpecificMemory" in performance ? "Not measured" : "Memory measurement unavailable")}</span>
            </section>

            <section className="host-workspace">
                <label className="host-panel">
                    <span>World.ts (existing imports only; restart to apply)</span>
                    <textarea value={worldSource} onChange={(event) => setWorldSource(event.target.value)} spellCheck={false} />
                </label>
                <div className="host-panel">
                    <span>Server log</span>
                    <pre aria-live="polite">{logs.join("\n") || "No output yet."}</pre>
                </div>
            </section>
        </main>
    );
}
