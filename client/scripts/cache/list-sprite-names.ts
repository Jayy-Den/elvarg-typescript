import { CacheSystem } from "../../rs/cache/CacheSystem";
import { IndexType } from "../../rs/cache/IndexType";
import { loadCache, loadCacheInfos, loadCacheList } from "./load-util";

const caches = loadCacheInfos();
const cacheInfo = loadCacheList(caches).latest;
const loaded = loadCache(cacheInfo);
const cacheSystem = CacheSystem.fromFiles(cacheInfo, loaded.files);
const index = cacheSystem.getIndex(IndexType.DAT2.sprites);

const filter = process.argv[2] ? new RegExp(process.argv[2], "i") : null;
const ids = index.getArchiveIds();
let shown = 0;
for (const id of ids) {
    let name: string | undefined;
    const arch: any = index.getArchive(id);
    try {
        name = arch?.name ?? arch?.getName?.();
    } catch {
        name = undefined;
    }
    if (!name) continue;
    if (filter && !filter.test(name)) continue;
    console.log(`${id}\t${name}`);
    shown++;
    if (shown > 400) break;
}
console.log(`total shown ${shown} of ${ids.length}`);
