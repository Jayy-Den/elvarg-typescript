import type { WidgetActionRouterDeps } from "../WidgetActionRouter";
import { MUSIC_GROUP_ID, MUSIC_JUKEBOX_CHILD_ID } from "../../../common/ui/music";

// OSRS music-tab row colors.
const COLOR_UNLOCKED = 0x00ff00; // green: every song is treated as unlocked

/**
 * Music tab (cache interface 239) jukebox list.
 *
 * The song list under 239:11 is built at runtime by the cache's CS2 scripts,
 * which register ops 1-5 on each dynamic row. The vanilla handler that turns a
 * row click into `playSong` is server/CS2 side and is not implemented in this
 * fork, so clicking a song did nothing - music only changed when walking into
 * a new region (server `Music.forRegion`).
 *
 * This controller closes that loop client-side: the row's display text is the
 * track title, so resolve it through the DB music-metadata table (see
 * `MusicSystem.findTrackIdByName`) and play it locally with a short fade.
 * The "now playing" line is updated through the same text widget the region
 * system uses.
 *
 * Row colors are also maintained here: the cache build script recolors rows
 * through the song-unlock varps, which this server never sends, leaving every
 * row red/locked. Instead of a varp-per-song protocol, rows are recolored from
 * the same DB metadata whenever the music tab becomes visible.
 */
export function handleMusicTabAction(
    deps: WidgetActionRouterDeps,
    widget: { uid: number; text?: string; parentUid?: number } | undefined,
    _event: { option?: string; opIndex?: number; slot?: number },
    groupId: number,
    _childId: number,
): boolean {
    if ((groupId | 0) !== MUSIC_GROUP_ID) return false;

    const client = getOsrsClient() as
        | {
              musicSystem?: {
                  findTrackIdByName(name: string): number;
                  playSong(...args: unknown[]): void;
                  volume?: number;
                  setVolume?(value: number): void;
              };
          }
        | undefined;
    if (!client?.musicSystem) return false;

    const row = resolveJukeboxRow(deps, widget);
    if (!row) return false;

    const songName = row.text;
    const trackId = client.musicSystem.findTrackIdByName(songName);
    if (trackId < 0) {
        console.warn(`[music-tab] no track named "${songName}" in the cache`);
        return true; // consumed: don't fall through to transmit-flag warnings
    }

    // Fresh accounts default to a zeroed music-volume preference, which mutes
    // the whole song pipeline. Clicking "Play" is an explicit request to hear
    // music, so raise a zero volume to a usable level first.
    const music = client.musicSystem;
    if ((music.volume ?? 1) <= 0 && typeof music.setVolume === "function") {
        music.setVolume(0.5);
    }

    client.musicSystem.playSong(trackId, 0, 150, 0, 250);
    updateNowPlaying(deps, songName);
    // The now-playing highlight lands once the song pipeline starts the track.
    scheduleMusicTabRefresh(300);
    scheduleMusicTabRefresh(2000);
    return true;
}

/**
 * The in-page client handle. `window.osrsClient` is the canonical global;
 * `__osrsClient` is kept as a legacy alias.
 */
function getOsrsClient(): unknown {
    if (typeof window === "undefined") return undefined;
    const w = window as unknown as Record<string, unknown>;
    return (w.osrsClient ?? w.__osrsClient) as unknown;
}

/**
 * Recolor jukebox rows if the music tab group is loaded. Rows default to the
 * cache's locked-red; everything resolvable through DB table 44 is unlocked,
 * and the row matching the active song renders green.
 */
export function refreshMusicTabUnlockState(): void {
    const client = getOsrsClient() as
        | {
              widgetManager?: {
                  getWidgetByUid?(uid: number): { text?: string; textColor?: number; color?: number } | undefined;
                  invalidateWidgetRender?(w: unknown): void;
              };
          }
        | undefined;
    const widgetManager = client?.widgetManager;
    if (!widgetManager?.getWidgetByUid) return;

    const root = widgetManager.getWidgetByUid((MUSIC_GROUP_ID << 16) >>> 0);
    if (!root) return; // music tab never opened this session

    // The user prefers every song rendered as unlocked/green - the mixed
    // white/red palette (from partial unlock state) looks broken.
    const jukeboxParentUid = ((MUSIC_GROUP_ID << 16) | MUSIC_JUKEBOX_CHILD_ID) | 0;
    for (let child = 0; child < 40000; child++) {
        const w = widgetManager.getWidgetByUid(((MUSIC_GROUP_ID << 16) | child) >>> 0);
        if (!w || (w as { parentUid?: number }).parentUid !== jukeboxParentUid) continue;
        if (w.textColor !== COLOR_UNLOCKED) {
            w.textColor = COLOR_UNLOCKED;
            (w as { color?: number }).color = COLOR_UNLOCKED;
            widgetManager.invalidateWidgetRender?.(w);
        }
    }
}

let refreshTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Debounced deferred refresh: the CS2 tab-switch script rebuilds the rows
 * asynchronously, so recoloring must run after that settles.
 */
export function scheduleMusicTabRefresh(delayMs = 250): void {
    if (refreshTimer !== null) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
        refreshTimer = null;
        try {
            refreshMusicTabUnlockState();
        } catch {
            // cosmetic only
        }
    }, delayMs);
}

/**
 * The clicked widget must be (or be inside) a dynamic row of the jukebox
 * container 239:11, and carry the song name as its text.
 */
function resolveJukeboxRow(
    deps: WidgetActionRouterDeps,
    widget: { uid: number; text?: string; parentUid?: number } | undefined,
): { uid: number; text: string } | undefined {
    if (!widget) return undefined;
    const widgetManager = deps.getWidgetManager();
    if (!widgetManager) return undefined;

    const jukeboxParentUid = ((MUSIC_GROUP_ID << 16) | MUSIC_JUKEBOX_CHILD_ID) | 0;

    let current: { uid: number; text?: string; parentUid?: number } | undefined = widget;
    for (let depth = 0; depth < 4 && current; depth++) {
        const text = (current.text ?? "").replace(/\s+/g, " ").trim();
        if (text && (current.parentUid ?? -1) === jukeboxParentUid) {
            return { uid: current.uid, text };
        }
        current = current.parentUid !== undefined
            ? (widgetManager.getWidgetByUid(current.parentUid) as
                  | { uid: number; text?: string; parentUid?: number }
                  | undefined)
            : undefined;
    }
    return undefined;
}

function updateNowPlaying(deps: WidgetActionRouterDeps, songName: string): void {
    try {
        // MUSIC_NOW_PLAYING_TEXT_CHILD_ID = 4. Mirrors the client's set_text
        // handling in OsrsClient: assign text, mark interaction dirty, and
        // invalidate the render. Cosmetic - failures must never break the click.
        const widgetManager = deps.getWidgetManager();
        if (!widgetManager) return;
        const w = widgetManager.getWidgetByUid(((MUSIC_GROUP_ID << 16) | 4) | 0);
        if (w) {
            w.text = songName;
            widgetManager.invalidateWidgetRender(w);
        }
    } catch {
        // ignore
    }
}
