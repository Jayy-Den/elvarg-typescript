# Browser-hosted world POC

`/host` runs one temporary Elvarg world in a desktop Chromium tab. The tab owns the Node runtime, server process, relay registration, WebRTC peers and in-memory player state. Closing, reloading or suspending that tab takes the world offline.

## Prepare and run locally

Install the repository packages, build the ignored browser runtime snapshot, then start the normal client dev server:

```sh
corepack yarn install --immutable
corepack yarn --cwd server install --immutable
corepack yarn --cwd client install --immutable
corepack yarn browser-host:prepare
corepack yarn --cwd client start
```

The final command also ensures the local OSRS cache exists so a second tab can run the normal client. Open `http://localhost:3000/host` in desktop Chrome or Edge. The dev server already supplies the COOP/COEP headers WebContainers require.

The generated `client/public/browser-host/runtime.json` is intentionally ignored. It contains compiled `server/dist`, the definitions needed by the plugin-free server and the editable `World.ts` source. Generate it after server changes; Vercel's build command generates it automatically.

On first Start, the WebContainer installs a small set of pure-JavaScript server dependencies and downloads the roughly 195 MiB OSRS cache from OpenRS2. Restart reuses both for the lifetime of the tab. `World.ts` is transpiled with the client's TypeScript package and replaces `dist/game/World.js`; only existing imports are supported, and Restart applies later edits.

## Relay and two-browser test

For the sibling local relay, use its legacy development token:

```sh
cd ../rsps-webrtc-relay
WEBRTC_REGISTRATION_TOKEN=dev-token corepack yarn start
```

Start the client with the same public relay URL baked into its world list:

```sh
REACT_APP_WEBRTC_SIGNAL_URL=ws://127.0.0.1:8787 \
REACT_APP_WEBRTC_ICE_SERVERS='[]' \
corepack yarn --cwd client start
```

In `/host`, enter a unique world ID/name, `dev-token`, `ws://127.0.0.1:8787`, and `[]`, then press Start. Wait for `online`. Press Open Client, refresh the server list, select the advertised world, log in, walk and chat. A second browser profile can join the same way and gets its own peer and local game WebSocket.

For the public relay, paste a forum-issued world token and use `wss://worlds.rsps.app` with the deployment's ICE configuration. The token stays only in React state in the host tab; it is never mounted into the WebContainer or written to browser storage.

## Limits

- Desktop Chromium is the POC target. Production hosting needs HTTPS plus `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`.
- The server uses null persistence, loads no optional plugins or player bots, and loses all players/state with the tab.
- Each gameplay message is binary and limited to 4096 bytes. The browser bridge pair-closes peers that send text, oversized messages or more than 64 KiB of queued data.
- Direct Internet reachability still depends on ICE. Add authenticated TURN only when host/srflx candidates are insufficient.
- Memory is measured only on request through `performance.measureUserAgentSpecificMemory()` when the browser exposes it.
