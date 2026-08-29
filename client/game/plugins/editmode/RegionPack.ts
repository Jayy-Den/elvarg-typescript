import type { EditModeEdit } from "./types";

const MAP_SIZE = 64;
const PLANE_COUNT = 4;

type Loc = {
    id: number;
    x: number;
    y: number;
    plane: number;
    shape: number;
    rotation: number;
};

function bytes(data: Uint8Array | Int8Array): Uint8Array {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function readUnsignedSmart(data: Uint8Array, cursor: { offset: number }): number {
    if (cursor.offset >= data.length) throw new Error("Truncated region object data");
    const first = data[cursor.offset++];
    if (first < 128) return first;
    if (cursor.offset >= data.length) throw new Error("Truncated region object data");
    return ((first << 8) | data[cursor.offset++]) - 0x8000;
}

function readSmart3(data: Uint8Array, cursor: { offset: number }): number {
    let value = 0;
    let part: number;
    do {
        part = readUnsignedSmart(data, cursor);
        value += part;
    } while (part === 32767);
    return value;
}

function decodeLocs(data: Uint8Array): Loc[] {
    const cursor = { offset: 0 };
    const locs: Loc[] = [];
    let id = -1;
    while (cursor.offset < data.length) {
        const idDelta = readSmart3(data, cursor);
        if (idDelta === 0) break;
        id += idDelta;
        let position = 0;
        while (true) {
            const positionDelta = readUnsignedSmart(data, cursor);
            if (positionDelta === 0) break;
            position += positionDelta - 1;
            if (cursor.offset >= data.length) throw new Error("Truncated region object data");
            const attributes = data[cursor.offset++];
            locs.push({
                id,
                x: (position >> 6) & 0x3f,
                y: position & 0x3f,
                plane: position >> 12,
                shape: attributes >> 2,
                rotation: attributes & 3,
            });
        }
    }
    return locs;
}

function writeUnsignedSmart(output: number[], value: number): void {
    if (value < 0 || value > 32767) throw new Error(`Invalid unsigned smart: ${value}`);
    if (value < 128) output.push(value);
    else output.push((value + 0x8000) >> 8, value & 0xff);
}

function writeSmart3(output: number[], value: number): void {
    while (value >= 32767) {
        writeUnsignedSmart(output, 32767);
        value -= 32767;
    }
    writeUnsignedSmart(output, value);
}

function encodeLocs(locs: Loc[]): Uint8Array {
    locs.sort(
        (a, b) =>
            a.id - b.id ||
            ((a.plane << 12) | (a.x << 6) | a.y) -
                ((b.plane << 12) | (b.x << 6) | b.y) ||
            a.shape - b.shape ||
            a.rotation - b.rotation,
    );
    const output: number[] = [];
    let previousId = -1;
    for (let index = 0; index < locs.length; ) {
        const id = locs[index].id;
        writeSmart3(output, id - previousId);
        previousId = id;
        let previousPosition = 0;
        while (index < locs.length && locs[index].id === id) {
            const loc = locs[index++];
            const position = (loc.plane << 12) | (loc.x << 6) | loc.y;
            writeUnsignedSmart(output, position - previousPosition + 1);
            output.push((loc.shape << 2) | (loc.rotation & 3));
            previousPosition = position;
        }
        writeUnsignedSmart(output, 0);
    }
    writeSmart3(output, 0);
    return Uint8Array.from(output);
}

function applyLocEdits(
    data: Uint8Array,
    edits: readonly EditModeEdit[],
    mapX: number,
    mapY: number,
): Uint8Array {
    let locs = decodeLocs(data);
    for (const edit of edits) {
        if (edit.kind !== "place" && edit.kind !== "delete") continue;
        if ((edit.tileX >> 6) !== mapX || (edit.tileY >> 6) !== mapY) continue;
        const x = edit.tileX & 0x3f;
        const y = edit.tileY & 0x3f;
        locs = locs.filter(
            (loc) =>
                loc.x !== x ||
                loc.y !== y ||
                loc.plane !== edit.plane ||
                loc.shape !== edit.shape,
        );
        if (edit.kind === "place" && edit.locId > 0) {
            locs.push({
                id: edit.locId,
                x,
                y,
                plane: edit.plane,
                shape: edit.shape,
                rotation: edit.rotation,
            });
        }
    }
    return encodeLocs(locs);
}

function writeTerrainValue(output: number[], value: number, wide: boolean): void {
    if (wide) output.push((value >> 8) & 0xff, value & 0xff);
    else output.push(value & 0xff);
}

function patchTerrain(
    data: Uint8Array,
    edits: readonly EditModeEdit[],
    mapX: number,
    mapY: number,
    wide: boolean,
): Uint8Array {
    const overrides = new Map<string, EditModeEdit>();
    for (const edit of edits) {
        if (
            edit.kind === "terrain" &&
            (edit.tileX >> 6) === mapX &&
            (edit.tileY >> 6) === mapY
        ) {
            overrides.set(`${edit.plane}:${edit.tileX & 0x3f}:${edit.tileY & 0x3f}`, edit);
        }
    }
    if (overrides.size === 0) return data.slice();

    const width = wide ? 2 : 1;
    const output: number[] = [];
    let offset = 0;
    const readValue = (): number => {
        if (offset + width > data.length) throw new Error("Truncated region terrain data");
        const value = wide ? (data[offset] << 8) | data[offset + 1] : data[offset];
        offset += width;
        return value;
    };

    for (let plane = 0; plane < PLANE_COUNT; plane++) {
        for (let x = 0; x < MAP_SIZE; x++) {
            for (let y = 0; y < MAP_SIZE; y++) {
                const edit = overrides.get(`${plane}:${x}:${y}`);
                const tileParts: Uint8Array[] = [];
                let terminator: Uint8Array;
                const tileStart = offset;
                while (true) {
                    const partStart = offset;
                    const opcode = readValue();
                    if (opcode === 0) {
                        terminator = data.subarray(partStart, offset);
                        break;
                    }
                    if (opcode === 1) {
                        if (offset >= data.length) throw new Error("Truncated region terrain data");
                        offset++;
                        terminator = data.subarray(partStart, offset);
                        break;
                    }
                    if (opcode <= 49) readValue();
                    if (!edit || opcode > 49) tileParts.push(data.subarray(partStart, offset));
                }
                if (!edit) {
                    output.push(...data.subarray(tileStart, offset));
                    continue;
                }
                for (const part of tileParts) output.push(...part);
                writeTerrainValue(output, 2 + edit.shape * 4 + (edit.rotation & 3), wide);
                writeTerrainValue(output, edit.locId, wide);
                output.push(...terminator);
            }
        }
    }
    output.push(...data.subarray(offset));
    return Uint8Array.from(output);
}

export function buildRegionPack(
    regionId: number,
    objectArchiveId: number,
    terrainArchiveId: number,
    objectData: Uint8Array | Int8Array,
    terrainData: Uint8Array | Int8Array,
    edits: readonly EditModeEdit[],
    wideTerrain: boolean,
): Uint8Array {
    const mapX = regionId >> 8;
    const mapY = regionId & 0xff;
    if (
        regionId < 0 ||
        regionId > 0xffff ||
        objectArchiveId < 0 ||
        terrainArchiveId < 0
    ) {
        throw new Error("The active region is missing from the cache");
    }
    const objects = applyLocEdits(bytes(objectData), edits, mapX, mapY);
    const terrain = patchTerrain(bytes(terrainData), edits, mapX, mapY, wideTerrain);
    const pack = new Uint8Array(28 + objects.length + terrain.length);
    const view = new DataView(pack.buffer);
    view.setInt32(0, 1);
    view.setInt32(4, objectArchiveId);
    view.setInt32(8, terrainArchiveId);
    view.setInt32(12, mapX);
    view.setInt32(16, mapY);
    view.setInt32(20, objects.length);
    pack.set(objects, 24);
    view.setInt32(24 + objects.length, terrain.length);
    pack.set(terrain, 28 + objects.length);
    return pack;
}
