# TSPS - TypeScript RuneScape Private Server

A browser-based Old School RuneScape private server with a TypeScript/WebGL client and TypeScript game server.

## Packages

- [`client/`](client/) — browser client (Forked from [xRSPS](https://github.com/xrsps/xrsps-typescript))
- [`server/`](server/) — game server (Official continuation of our [Elvarg](https://github.com/RSPSApp/elvarg-rsps) fork - Ported to TypeScript)

## Quick start

Install [Node.js 22.16 or later](https://nodejs.org/en/download) first. No separate Yarn or Corepack installation is needed.

From the repository root:

```bash
npm run setup
yarn start
```

`yarn setup` installs the root tools, Elvarg server, and browser client. It is
safe to run again after pulling changes. `yarn start` launches both processes;
the client is normally available at <http://localhost:3005/play> (the dev server
must avoid port 3000, which the Freebuff desktop app reserves and evicts —
the port is defined once as `DEV_SERVER_PORT` in `client/craco.config.js`).
The app is served under the `/play` base path (`homepage` in
`client/package.json`), so the bare `http://localhost:3005/` root has no UI.
The first start downloads the game cache automatically.

Game-server output is teed to a timestamped, git-ignored file under `logs/`
(e.g. `logs/server-2026-09-09-17-57-42.log`) as well as the console, so past
boots and crashes stay inspectable.

If setup is interrupted, run `npm run setup` again.

## Publish your world

Create a server token at [RSPS.app](https://rsps.app/) under **Settings → Server tokens**, then add it to `.env` in the repository root:

```dotenv
WEBRTC_WORLD_ID=my-world
WEBRTC_WORLD_TOKEN=paste-your-token-here
```

Run `yarn start`. Your world appears in the World list once it registers. Keep the token private.

## Credits

We want to thank Astrul, Detuks and all the contributers of both the legacy Java project and the TypeScript continuation.

## Legal

This fan project is not affiliated with Jagex Ltd. Old School RuneScape and related assets and trademarks belong to their respective owners.
