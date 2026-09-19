/**
 * Scan all cs2 scripts for cc_settrans/if_settrans and print those whose int
 * operands include 150 (the suspicious sidebar-panel transparency) — the
 * mobile sidebar backdrop renders ~40% opaque; official mobile is opaque.
 * Cross-report scripts that ALSO contain the widget constant 113 nearby so we
 * can identify the one targeting 601:113.
 */
import { IndexType } from "../../rs/cache/IndexType";
import { CacheSystem } from "../../rs/cache/CacheSystem";
import { Opcodes, parseScriptFromBytes } from "../../rs/cs2/Script";
import { loadOpcodeDbOsrs } from "../../rs/cs2/OpcodeDb";
import { loadCache, loadCacheInfos, loadCacheList } from "./load-util";

const caches = loadCacheInfos();
const cacheInfo = loadCacheList(caches).latest;
const loaded = loadCache(cacheInfo);
const cacheSystem = CacheSystem.fromFiles(cacheInfo, loaded.files);
const index = cacheSystem.getIndex(IndexType.DAT2.clientScript);
const db = loadOpcodeDbOsrs("");

// resolve settrans opcodes from the db by name
const settransOps = new Set<number>();
for (const name of ["cc_settrans", "if_settrans"]) {
    const inst = (db as any).findByName ? (db as any).findByName(name) : undefined;
    if (inst) settransOps.add(inst.opcode);
}
console.error(`settrans opcodes: ${[...settransOps].join(", ")}`);

const archiveCount = index.getArchiveCount();
let scanned = 0;
const hits: Array<{ id: number; n150: number }> = [];

for (let id = 0; id < archiveCount; id++) {
    let arch: any;
    try {
        arch = index.getArchive(id);
    } catch {
        continue;
    }
    if (!arch) continue;
    let file: any;
    try {
        file = arch.getFile(0);
    } catch {
        continue;
    }
    if (!file || !file.data) continue;
    let script;
    try {
        script = parseScriptFromBytes(id, file.data, cacheSystem.decodeProfile);
    } catch {
        continue;
    }
    scanned++;
    const { instructions, intOperands } = script;
    let usesSettrans = false;
    let count150 = 0;
    for (let pc = 0; pc < instructions.length; pc++) {
        if (settransOps.has(instructions[pc])) usesSettrans = true;
    }
    if (!usesSettrans) continue;
    for (let i = 0; i < intOperands.length; i++) {
        if (intOperands[i] === 150) count150++;
    }
    if (count150 > 0) hits.push({ id, n150: count150 });
}

console.log(`scanned ${scanned} scripts`);
for (const h of hits) console.log(`script ${h.id}: int-150 x${h.n150}`);
console.log(`done, ${hits.length} hits`);
