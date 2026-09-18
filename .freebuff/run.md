# Session notes — 2026-09-18

## Fixes verified live this session (all in working tree, uncommitted)
1. **Chat wiped on filter-tab tap** — cs2 175→2823→923 reads the "chat collapsed"
   state purely from marker widget 162:135 (uid 10616871; note: 135 is the fileId,
   10616871 the uid — earlier notes saying "162:39/162:135" were the same widget).
   Marker now mirrors varc 1220 (authoritative collapse state):
   - `widgets/WidgetManager.ts` (mobile block, ~line 1653): mirror at group mount.
   - `game/widgets/WidgetActionRouter.ts`: re-mirror before any group-162 action.
   - `game/OsrsClient.ts`: `getChatCollapsed()` helper + marker sync in the
     varc-1220 end-state handler.
2. **Compass tap did nothing** — two stacked causes:
   a. CLIENTTYPE returned 2 (android); no cache script tests 2, so mobile procs
      mis-selected. Now returns 7 (`rs/cs2/handlers/ClientOps.ts`).
   b. The varbit-542/13981 display-state shim (chatbox popout gate) also answered
      script 1050's gate (`if varbit542 == 1 → return`), killing every compass
      tap. Shim now skips when `currentScriptId === 1050`
      (`rs/cs2/handlers/VarOps.ts` + `currentScriptId` added to `Cs2VmLike`).
   Verified: tap 744,14 → yaw 1500 → targetYaw 0 through the real
   InputManager → onFrameStart → handleUiInput → onOp(1050) → cam_forceangle path.
3. **Panel border** — 1px black frame on tiled sidebar backdrops (sprites 1040/897)
   in `renderWidgetTree.ts` + template copy `render/drawNodeBody.txt`
   (`MOBILE_SIDEBAR_BACKDROP_SPRITE_IDS`). Pixel-verified drawing.
4. Earlier sessions (same working tree): compass sprite fallback (archive 169)
   when GraphicsDefaults decode yields -1; tap-to-drop setting persistence
   (varbit 16111 + `settings.tapToDrop`); tiled-sprite single-quad path.

## Environment / how to run
- Client dev server: `client-supervisor.bat` (self-healing, logs to
  `logs/client-supervisor.log`), serves **http://localhost:3005** (3005, not 3000).
- Game server: `cd server && corepack yarn dev` (port 43594 ws). Logs in
  `logs/server-*.log`.
- Preview: `http://localhost:3005/?mobile=1`. Touch flag follows the URL param;
  the desktop preview needs `?mobile=1` to mount root 601.

## Login for testing
- Accounts: mobtest14/mobtest15, password `test1234`.
- 2026-09-18 (post-upstream-merge): upstream's `fix(auth): reject malformed
  password hashes` (PasswordUtil) now REJECTS anything not matching
  `^[0-9a-f]{32}:[0-9a-f]{128}$` (32-hex salt:128-hex hash). Earlier reset
  scripts wrote truncated hashes (41 chars) → login error 3 "Invalid
  username or password" with no server log. To reset: recompute
  scrypt(password, salt=randomBytes(16).hex, 64) and rewrite the WHOLE
  save_json via JSON.parse/UPDATE (json_set path `"$.x"` fails in node:sqlite).
- Accounts must not be double-flagged online or you get error 5.
- Programmatic login: set `loginState.username/password/loginIndex=2`, then
  dispatch KeyboardEvent Enter on `inputManager.element` (render loop does
  savePersistedLoginState + sendLogin on Enter). `processLoginAction({type:'login'})`
  alone only sets CONNECTING and never opens the socket.
- Error 5 on re-login = account still flagged online; use the other account or wait.
- If the client hangs at CONNECTING with an established socket but no
  registration: the socket was created before the page re-initialized (HMR or
  hidden-page reload). A clean reload fixes it (known artifact, not a code bug).

## Testing pitfalls (cost real time — don't repeat)
- The preview webview is usually **backgrounded → rAF stalls**. Click pulses sit
  in InputManager until the next frame, so synthetic taps appear dead. Verify
  with: set `inputManager.clickX/clickY/clickMode1=1`, call
  `inputManager.onFrameStart()`, then `osrsClient.handleUiInput()` manually.
- WebGL reads must target the **widgets overlay canvas**
  (`(c.widgetsOverlay ?? c.renderer.widgetsOverlay).renderCanvas`, has
  `__textureCache`), not the 3D canvas.
- `handleWidgetAction(event)` takes an **event object**
  `{ widget, option, opIndex, source }`, not `(widget, opIndex)`.
- Reference screenshots in `client/public/__refs/` are all **380x175** (not full
  phone res) — fine for colour sampling, too small for fine detail.

## Session-2 gotchas (2026-09-18, post-merge)
- Dynamic widget uids SHIFT each session: the compass tap target was
  601:32789 last session, 601:32794 (uid 39419930) this one. Find it by
  scanning `widgetManager.widgetByUid` for 601 children with fid>=0x8000 and
  onOp, or the look-direction node with `_absX`≈732/`_absY`≈2, 36×36.
- The click-pulse recipe needs im.onFrameStart() BEFORE c.handleUiInput():
  pulse → onFrameStart transfers to leftClickX/Y → handleUiInput resolves the
  hit. Compass verified again: yaw 1862 → 0.
- `_absX/_absY/_absWidth/_absHeight` are in CANVAS px (max 856x756), not
  logical 1277x1128. Welcome-screen 378:72 tap: x uses canvas scale (856/765),
  y uses 756/756 — mixing them missed the button.
- Upstream HD plugin: enable via `c.hdPlugin.setEnabled(true)` (persists to
  localStorage `xrsps.plugin.hd.enabled`). Verified on mobile root 601 with
  no errors; panel borders still draw. Grass hue matches refs (65,79,21) vs
  (48,58,1) live under aerial shadows.

## Known leftovers / next candidates
- Desktop root (161) still mounts when preview lacks `?mobile=1` — by design.
- 162:135 marker mirror lives in two call sites (mount + pre-tap); could fold
  into one invalidate hook if it grows.
- `client-dev.log`, `.freebuff/bundle*.js` snapshots are stale artifacts.
