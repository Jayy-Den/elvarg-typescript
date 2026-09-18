import { CacheSystem } from "../../rs/cache/CacheSystem";
import { IndexType } from "../../rs/cache/IndexType";
import { loadCache, loadCacheInfos, loadCacheList } from "./load-util";

const caches = loadCacheInfos();
const cacheInfo = loadCacheList(caches).latest;
const loaded = loadCache(cacheInfo);
const cacheSystem = CacheSystem.fromFiles(cacheInfo, loaded.files);
const index = cacheSystem.getIndex(IndexType.DAT2.sprites);

const candidates = process.argv.slice(2);
for (const name of candidates) {
    const id = (index as any).getArchiveId(name);
    console.log(`${id >= 0 ? "FOUND" : "     "} ${String(id).padStart(5)}  ${name}`);
}
