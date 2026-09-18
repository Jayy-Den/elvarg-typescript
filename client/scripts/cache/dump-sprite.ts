import fs from "fs";

import { SpriteLoader } from "../../rs/sprite/SpriteLoader";
import { CacheSystem } from "../../rs/cache/CacheSystem";
import { loadCache, loadCacheInfos, loadCacheList } from "./load-util";

const caches = loadCacheInfos();
const cacheInfo = loadCacheList(caches).latest;
const loaded = loadCache(cacheInfo);
const cacheSystem = CacheSystem.fromFiles(cacheInfo, loaded.files);
const index = cacheSystem.getIndex(8 /* sprites */);

const ids = process.argv.slice(2).map((s) => parseInt(s, 10));
for (const id of ids) {
    try {
        const spr = SpriteLoader.loadIntoIndexedSprite(index, id);
        if (!spr) {
            console.log(`sprite ${id}: UNDEFINED (loadFromIndex returned false)`);
            continue;
        }
        void 0;
        console.log(
            `sprite ${id}: ${spr.width}x${spr.height} sub=${spr.subWidth}x${spr.subHeight} ` +
                `offset=${spr.xOffset},${spr.yOffset} palette=${spr.palette?.length} ` +
                `pixels=${spr.pixels?.length} alpha=${spr.alpha ? spr.alpha.length : "none"}`,
        );
        if (spr.palette) {
            const cols: string[] = [];
            const seen = new Set<number>();
            for (let i = 0; i < spr.pixels!.length; i++) {
                const c = spr.pixels![i];
                if (seen.has(c)) continue;
                seen.add(c);
                cols.push(`${c}=#${(spr.palette[c] ?? 0).toString(16).padStart(6, "0")}`);
            }
            console.log(`  colors: ${cols.join(" ")}`);
        }
        // Dump ALL frames in the archive
        const all = SpriteLoader.loadIntoIndexedSprites(index, id);
        if (all) {
            all.forEach((s, i) =>
                console.log(`  frame[${i}]: ${s.width}x${s.height} sub=${s.subWidth}x${s.subHeight} colors=${new Set(s.pixels!).size}`),
            );
        }
        // Count distinct palette colors actually referenced
        if (spr.pixels && spr.palette) {
            const used = new Set<number>();
            for (let i = 0; i < spr.pixels.length; i++) used.add(spr.pixels[i]);
            console.log(`  distinct colors used: ${used.size}`);
            // Save raw pixel dump for inspection
            const buf = Buffer.alloc(spr.width * spr.height * 4);
            for (let i = 0; i < spr.width * spr.height; i++) {
                const color = spr.pixels[i] ?? 0;
                const rgb = color === 0 ? 0x00ff00 : spr.palette[color] ?? 0;
                buf[i * 4] = (rgb >> 16) & 0xff;
                buf[i * 4 + 1] = (rgb >> 8) & 0xff;
                buf[i * 4 + 2] = rgb & 0xff;
                buf[i * 4 + 3] = 255;
            }
            fs.writeFileSync(`C:/tmp/sprite${id}.rgba`, buf);
            console.log(`  wrote C:/tmp/sprite${id}.rgba (${spr.width}x${spr.height})`);

            // ASCII map (luminance ramp) so tile structure / borders are visible
            if (process.env.ASCII === "1") {
                const ramp = " .:-=+*#%@";
                for (let y = 0; y < spr.height; y++) {
                    let line = String(y).padStart(3, " ") + " ";
                    for (let x = 0; x < spr.width; x++) {
                        const color = spr.pixels[y * spr.width + x] ?? 0;
                        if (color === 0) {
                            line += "_";
                            continue;
                        }
                        const rgb = spr.palette[color] ?? 0;
                        const lum =
                            0.299 * ((rgb >> 16) & 0xff) +
                            0.587 * ((rgb >> 8) & 0xff) +
                            0.114 * (rgb & 0xff);
                        line += ramp[Math.max(0, Math.min(9, Math.floor(lum / 26)))];
                    }
                    console.log(line);
                }
                // Edge column / row palette indices
                const colIdx = (x: number) =>
                    [...new Set(Array.from({ length: spr.height }, (_, y) => spr.pixels[y * spr.width + x]))]
                        .map((c) => `${c}:#${(spr.palette[c] ?? 0).toString(16).padStart(6, "0")}`)
                        .join(" ");
                console.log(`  col0: ${colIdx(0)}`);
                console.log(`  col${spr.width - 1}: ${colIdx(spr.width - 1)}`);
            }
        }
    } catch (e) {
        console.log(`sprite ${id}: ERROR ${e}`);
    }
}


