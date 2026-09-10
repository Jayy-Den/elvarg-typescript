import { CachePipeline } from "./CachePipeline";
import { CacheIndexDat2 } from "./codec/rs/cache/CacheIndex";
import { ConfigType } from "./codec/rs/cache/ConfigType";
import { IndexType } from "./codec/rs/cache/IndexType";
import { ByteBuffer } from "./codec/rs/io/ByteBuffer";

/**
 * OSRS stores interface metadata in "DB tables" (config archive 39 for tables,
 * 38 for rows). The music/jukebox list lives in table 44:
 *
 *   column 0 -> song title (string)
 *   column 2 -> unlock hint (string)
 *   column 3 -> song list id (the jukebox row id; the unlock varp is id + 20)
 *   column 4 -> audio track id (index-6 music archive)
 *
 * The vanilla client recolors jukebox rows from varps 20..844 (song list id + 20);
 * 1 = unlocked. This module decodes the table server-side so the server can send
 * honest unlock state at login instead of the client papering over locked rows.
 */

// Script var type ids that decode as strings; everything else is an int payload.
const STRING_TYPES = new Set([36, 42]);

type ColumnValueSet = {
    columnId: number;
    types: number[];
    values: (string | number)[];
};

class DecodedRow {
    tableId = -1;
    readonly columns = new Map<number, ColumnValueSet>();

    constructor(readonly id: number) {}

    getColumn(columnId: number): ColumnValueSet | undefined {
        return this.columns.get(columnId);
    }
}

function decodeScriptVarValue(type: number, buffer: ByteBuffer): string | number {
    if (STRING_TYPES.has(type)) {
        return buffer.readString();
    }
    return buffer.readInt();
}

function decodeColumnFields(buffer: ByteBuffer, types: number[]): (string | number)[] {
    const fieldCount = buffer.readUnsignedShortSmart();
    const out: (string | number)[] = new Array(fieldCount * types.length);
    for (let field = 0; field < fieldCount; field++) {
        for (let i = 0; i < types.length; i++) {
            out[field * types.length + i] = decodeScriptVarValue(types[i], buffer);
        }
    }
    return out;
}

function loadDbRow(id: number, buffer: ByteBuffer): DecodedRow {
    const row = new DecodedRow(id);
    while (buffer.remaining > 0) {
        const opcode = buffer.readUnsignedByte();
        if (opcode === 0) {
            break;
        }
        if (opcode === 3) {
            buffer.readUnsignedByte(); // column count (implicit in the loop terminator)
            for (
                let columnId = buffer.readUnsignedByte();
                columnId !== 255;
                columnId = buffer.readUnsignedByte()
            ) {
                const typeCount = buffer.readUnsignedByte();
                const types: number[] = new Array(typeCount);
                for (let i = 0; i < typeCount; i++) {
                    types[i] = buffer.readUnsignedShortSmart();
                }
                row.columns.set(columnId, {
                    columnId,
                    types,
                    values: decodeColumnFields(buffer, types),
                });
            }
        } else if (opcode === 4) {
            row.tableId = buffer.readVarInt2();
        } else {
            // Unknown opcode - stop parsing to avoid misalignment.
            break;
        }
    }
    return row;
}

export type SongMeta = {
    /** DB row id in table 44 */
    rowId: number;
    /** Jukebox display title */
    title: string;
    /** Song list id from column 3 (unlock varp = id + MusicUnlocks.FIRST_SONG_VARP) */
    songListId: number;
    /** Playable audio track id from column 4 (index-6 music archive) */
    trackId: number;
    /** Unlock hint from column 2 (how this song is normally unlocked) */
    hint: string;
};

export class DbMusicTable {
    private static songs?: Map<string, SongMeta>;
    private static bySongListId?: Map<number, SongMeta>;

    private static ensureLoaded(): void {
        if (this.songs) return;

        this.songs = new Map();
        this.bySongListId = new Map();
        try {
            const store = CachePipeline.getStore();
            const configs = CacheIndexDat2.fromStore(IndexType.DAT2.configs, store);

            // Rows for table 44 live in the dbRow config archive (type 38);
            // each file is one row carrying its tableId.
            const rowArchive = configs.getArchive(ConfigType.OSRS.dbRow);
            if (!rowArchive) return;

            // The whole dbRow archive is decompressed once by getArchive(); read
            // every file from that in-memory copy. Calling configs.getFile() per
            // file here would re-read/re-decompress the full archive per file -
            // an O(n^2) synchronous stall that blocks the event loop on first
            // login (observed as a pegged core with a dead WS listener).
            const filesMap = (rowArchive as unknown as {
                _files?: Map<number, { id: number; getDataAsBuffer(): ByteBuffer }>;
            })._files;
            if (!filesMap) return;

            for (const file of filesMap.values()) {
                const row = loadDbRow(file.id, file.getDataAsBuffer());
                if (row.tableId !== 44) continue;

                const titleCol = row.getColumn(0);
                const listCol = row.getColumn(3);
                const trackCol = row.getColumn(4);
                const hintCol = row.getColumn(2);
                const songListId = listCol?.values[0];
                const trackId = trackCol?.values[0];
                if (typeof songListId !== "number" || typeof trackId !== "number") continue;

                const meta: SongMeta = {
                    rowId: row.id,
                    title: typeof titleCol?.values[0] === "string" ? (titleCol.values[0] as string) : "",
                    songListId,
                    trackId,
                    hint: typeof hintCol?.values[0] === "string" ? (hintCol.values[0] as string) : "",
                };
                if (meta.title) this.songs.set(meta.title, meta);
                this.bySongListId.set(meta.songListId, meta);
            }
            // One-shot diagnostics line: proves the decode worked (or why not).
            console.log(`[music-unlocks] decoded ${this.bySongListId.size} songs from DB table 44`);
        } catch (err) {
            // Missing/corrupt cache must never break gameplay - unlock state is
            // cosmetic. Log and continue with an empty table.
            console.warn("[music-unlocks] failed to decode DB table 44:", err);
        }
    }

    static getSongs(): Map<string, SongMeta> {
        this.ensureLoaded();
        return this.songs ?? new Map();
    }

    /**
     * Every decoded song row, keyed by song list id. Rows that share a title
     * (e.g. re-releases) appear once per song list id here, while getSongs()
     * keeps only the last per title.
     */
    static getAllSongMetas(): SongMeta[] {
        this.ensureLoaded();
        return [...(this.bySongListId?.values() ?? [])];
    }

    static getBySongListId(songListId: number): SongMeta | undefined {
        this.ensureLoaded();
        return this.bySongListId?.get(songListId);
    }

    static get count(): number {
        this.ensureLoaded();
        return this.bySongListId?.size ?? 0;
    }
}
