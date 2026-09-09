import type { WidgetActionRouterDeps } from "../WidgetActionRouter";
import { MUSIC_GROUP_ID, MUSIC_JUKEBOX_CHILD_ID } from "../../../common/ui/music";

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
 * track name, so resolve it through the music-tracks index (name hash lookup)
 * and play it locally with a short fade. The "now playing" line is updated
 * through the same text widget the region system uses.
 */
export function handleMusicTabAction(
    deps: WidgetActionRouterDeps,
    widget: { uid: number; text?: string; parentUid?: number } | undefined,
    _event: { option?: string; opIndex?: number; slot?: number },
    groupId: number,
    _childId: number,
): boolean {
    if ((groupId | 0) !== MUSIC_GROUP_ID) return false;

    const client = (typeof window !== "undefined" ? (window as any).__osrsClient : undefined) as
        | { musicSystem?: { findTrackIdByName(name: string): number; playSong(...args: unknown[]): void } }
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

    client.musicSystem.playSong(trackId, 0, 150, 0, 250);
    updateNowPlaying(deps, songName);
    return true;
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
