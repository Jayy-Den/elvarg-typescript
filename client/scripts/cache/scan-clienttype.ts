import { CacheSystem } from "../../rs/cache/CacheSystem";
import { IndexType } from "../../rs/cache/IndexType";
import { parseScriptFromBytes } from "../../rs/cs2/Script";
import { loadCache, loadCacheInfos, loadCacheList } from "./load-util";

const CLIENTTYPE = 6519;

const caches = loadCacheInfos();
const cacheInfo = loadCacheList(caches).latest;
const loaded = loadCache(cacheInfo);
const cacheSystem = CacheSystem.fromFiles(cacheInfo, loaded.files);
const index = cacheSystem.getIndex(IndexType.DAT2.clientScript);

const archiveIds = index.getArchiveIds();
let hits = 0;
for (const id of archiveIds) {
    let script;
    try {
        const arch = index.getArchive(id);
        const file = arch.getFile(0);
        if (!file) continue;
        script = parseScriptFromBytes(id, file.data, cacheSystem.decodeProfile);
    } catch {
        continue;
    }
    const instr = script.instructions;
    for (let i = 0; i < instr.length; i++) {
        if (instr[i] !== CLIENTTYPE) continue;
        // print a small window of following instructions
        const win: string[] = [];
        for (let j = i + 1; j < Math.min(i + 5, instr.length); j++) {
            win.push(`${instr[j]}:${script.intOperands[j]}`);
        }
        console.log(`script ${id} [${i}] clienttype -> ${win.join(" ")}`);
        hits++;
    }
}
console.log(`total clienttype uses: ${hits}`);
