import { MenuTargetType } from "../../../rs/MenuEntry";
import type { OsrsClient } from "../../OsrsClient";
import { createBrowserEditModePluginPersistence } from "./BrowserEditModePluginPersistence";
import { EditModePlugin } from "./EditModePlugin";

/** Wires the editor to the running client. Dev builds only - see OsrsClient. */
export function installEditMode(client: OsrsClient): EditModePlugin {
    const plugin = new EditModePlugin(
        createBrowserEditModePluginPersistence("osrs.plugin.edit_mode.v1"),
    );

    plugin.attach({
        getCanvas: () => client.renderer?.canvas as HTMLCanvasElement | undefined,
        getPointerTile: () => {
            const renderer = client.renderer as unknown as
                | {
                      computeTileAt?: (
                          x: number,
                          y: number,
                      ) => { tileX: number; tileY: number; plane: number } | undefined;
                  }
                | undefined;
            // hoveredTile is only maintained while the hover overlay is on, so
            // fall back to picking the tile under the pointer ourselves.
            const tile =
                client.hoveredTile ??
                renderer?.computeTileAt?.(client.inputManager.mouseX, client.inputManager.mouseY);
            if (!tile) return undefined;
            return { tileX: tile.tileX | 0, tileY: tile.tileY | 0, plane: (tile.plane ?? 0) | 0 };
        },
        getPointerLoc: () => {
            const entry = client.menuEntries.find(
                (candidate) => candidate.targetType === MenuTargetType.LOC,
            );
            return entry ? { locId: entry.targetId | 0, locName: entry.targetName } : undefined;
        },
        onLocAddChange: (locId, tile, level, shape, rotation) => {
            client.onLocAddChange(locId, tile, level, shape, rotation);
        },
        onLocDel: (tile, level, shape, rotation) => {
            client.onLocDel(tile, level, shape, rotation);
        },
        getLocName: (locId) => client.locTypeLoader?.load(locId)?.name ?? "",
    });

    return plugin;
}
