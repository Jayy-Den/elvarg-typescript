/**
 * Scan all cs2 scripts for sethide-family ops (cc_sethide / if_sethide /
 * server-sethide variants) whose int operand is exactly (601 << 16) | W for the
 * sidebar content hosts W in 116..129, or widget-ids matching via the
 * (group,widget) two-int form. Reports script ids + operand context so we can
 * find which script drives the sidebar content visibility.
 */
import { IndexType } from "../../rs/cache/IndexType";
import { CacheSystem } from "../../rs/cache/CacheSystem";
import { parseScriptFromBytes } from "../../rs/cs2/Script";
import { loadOpcodeDbOsrs } from "../../rs/cs2/OpcodeDb";
import { loadCache, loadCacheInfos, loadCacheList } from "./load-util";

const caches = loadCacheInfos();
const cacheInfo = loadCacheList(caches).latest;
const loaded = loadCache(cacheInfo);
const cacheSystem = CacheSystem.fromFiles(cacheInfo, loaded.files);
const index = cacheSystem.getIndex(IndexType.DAT2.clientScript);
const db = loadOpcodeDbOsrs("");

const hideOps = new Set<number>();
const opNames: Record<number, string> = {};
for (const name of ["cc_sethide", "if_sethide", "cc_sethidetrue", "cc_sethidefalse", "if_sethidetrue", "if_sethidefalse"]) {
    const inst = (db as any).findByName ? (db as any).findByName(name) : undefined;
    if (inst) { hideOps.add(inst.opcode); opNames[inst.opcode] = name; }
}
console.error(`hide opcodes: ${Object.entries(opNames).map(([o, n]) => `${n}=${o}`).join(", ")}`);

const archiveCount = index.getArchiveCount();
let scanned = 0;
const hits: string[] = [];

const HOSTS = new Set<number>();
for (let w = 116; w <= 129; w++) HOSTS.add((601 << 16) | w);

for (let id = 0; id < archiveCount; id++) {
    let arch: any;
    try { arch = index.getArchive(id); } catch { continue; }
    if (!arch) continue;
    let file: any;
    try { file = arch.getFile(0); } catch { continue; }
    if (!file || !file.data) continue;
    let script;
    try { script = parseScriptFromBytes(id, file.data, cacheSystem.decodeProfile); } catch { continue; }
    scanned++;
    const { instructions, intOperands } = script;
    for (let pc = 0; pc < instructions.length; pc++) {
        if (!hideOps.has(instructions[pc])) continue;
        const a = intOperands[pc];
        // form 1: single packed uid operand
        if (HOSTS.has(a)) { hits.push(`script ${id} pc=${pc} ${opNames[instructions[pc]]} packed=${a}`); continue; }
        // form 2: two-int (group, widget) — peek at neighbors
        for (const [g, w] of [[601, 116], [601, 122], [601, 117], [601, 119]]) {
            if ((a === g && intOperands[pc + 1] === w) || (a === w && pc > 0 && intOperands[pc - 1] === g)) {
                hits.push(`script ${id} pc=${pc} ${opNames[instructions[pc]]} pair=${g},${w}`);
            }
        }
    }
}
console.log(`scanned ${scanned} scripts; hits: ${hits.length}`);
for (const h of hits.slice(0, 60)) console.log(h);
