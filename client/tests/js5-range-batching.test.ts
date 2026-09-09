import assert from "node:assert/strict";
import { Js5RangeClient } from "../rs/cache/js5/Js5RangeClient";
import { SparseMemoryStore } from "../rs/cache/store/SparseMemoryStore";
import { PresenceBitset } from "../rs/cache/js5/PresenceBitset";

async function main() {
    const index = new ArrayBuffer(18);
    const idx = new DataView(index);
    for (const [id, sector] of [[0, 1], [1, 150], [2, 151]]) {
        idx.setUint8(id * 6 + 2, 1);
        idx.setUint8(id * 6 + 4, sector >> 8);
        idx.setUint8(id * 6 + 5, sector & 255);
    }
    const store = new SparseMemoryStore(new ArrayBuffer(200 * 520), [index], PresenceBitset.forSectorCount(200, false));
    const originalFetch = globalThis.fetch;
    let requests = 0;
    globalThis.fetch = async (_url, options) => {
        requests++;
        const range = (options!.headers as Record<string, string>).Range;
        const [, start, end] = /bytes=(\d+)-(\d+)/.exec(range)!;
        return new Response(new Uint8Array(Number(end) - Number(start) + 1), {
            status: 206,
            headers: { "Content-Range": `bytes ${start}-${end}/${store.dataFile.byteLength}` },
        });
    };
    try {
        const client = new Js5RangeClient("https://example.test/cache", store);
        await Promise.all([client.requestGroup(0, 0), client.requestGroup(0, 2)]);
        assert.equal(requests, 1, "nearby missing groups share a single HTTP request");
        await client.requestGroup(0, 1);
        assert.equal(requests, 1, "intervening group is already downloaded");
    } finally {
        globalThis.fetch = originalFetch;
    }
    console.log("JS5 range batching tests passed");
}
void main();
