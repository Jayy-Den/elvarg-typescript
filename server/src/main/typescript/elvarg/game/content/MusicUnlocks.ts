import { DbMusicTable, SongMeta } from "../cache/DbMusicTable";

/**
 * Song unlock state for the jukebox (music tab).
 *
 * The vanilla client recolors jukebox rows from varps 20..844, where varp
 * (songListId + 20) = 1 means "song unlocked" and 0 = locked/red. Song list ids
 * come from DB table 44 column 3 (see DbMusicTable).
 *
 * This fork unlocks every song for every account: the server pushes the full
 * unlock varp set at login (and on-demand via ::musicunlock), and the client's
 * "Unlocked: X / Y" counter reads the real varps instead of a hardcoded label.
 */

export const MUSIC_UNLOCK_FIRST_VARP = 2000;
/*
 * Why the base is 2000 and not the vanilla 20: the vanilla mapping
 * (varp = songListId + 20) collides with client-state varps this client's own
 * init scripts rewrite after login (weapon/special interfaces own ids like
 * 439/440; volumes own 168/169). Those overwrites silently un-unlock 8 songs
 * (observed: varps 302,162,335,439,365,440,165,212 holding 0x7fffffff and
 * friends). Both ends of this protocol are this fork's, so the unlock block
 * lives above every client-state varp (2000+) where nothing else writes.
 */

/** Group consecutive song list ids into [startId, endId] ranges for compact sending. */
function compressRanges(songListIds: number[]): Array<[number, number]> {
    const sorted = [...songListIds].sort((a, b) => a - b);
    const ranges: Array<[number, number]> = [];
    for (const id of sorted) {
        const last = ranges[ranges.length - 1];
        if (last && id === last[1] + 1) {
            last[1] = id;
        } else {
            ranges.push([id, id]);
        }
    }
    return ranges;
}

export class MusicUnlocks {
    /** Send the full "every song unlocked" varp set to a player. */
    public static sendAllUnlocked(player: any): void {
        const sender = player.getPacketSender?.();
        if (!sender?.sendConfig) return;

        // Iterate the songListId-keyed map: rows that share a title but have
        // different song list ids each need their own varp, so the title-keyed
        // map (deduped for lookup) would silently skip a few songs.
        const metas = DbMusicTable.getAllSongMetas();
        if (metas.length === 0) return;
        for (const meta of metas) {
            sender.sendConfig(MUSIC_UNLOCK_FIRST_VARP + meta.songListId, 1);
        }
    }

    /** Number of distinct unlock varps this server tracks (diagnostics). */
    public static get unlockCount(): number {
        return DbMusicTable.count;
    }

    /** Unlock a single song by title (used by ::musicunlock). Returns false if unknown. */
    public static unlockByTitle(player: any, title: string): SongMeta | undefined {
        const meta = DbMusicTable.getSongs().get(title);
        if (!meta) return undefined;
        player.getPacketSender().sendConfig(MUSIC_UNLOCK_FIRST_VARP + meta.songListId, 1);
        return meta;
    }

    /** Range helper kept for tests/debugging. */
    public static compressRanges = compressRanges;
}
