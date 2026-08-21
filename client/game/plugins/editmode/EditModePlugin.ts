import {
    LOC_SHAPE_NORMAL,
    type EditModeEdit,
    type EditModeHost,
    type EditModePlaceKind,
    type EditModePluginConfig,
    type EditModePluginPersistence,
    type EditModePluginState,
    type EditModeSearchResult,
    type EditModeSelection,
    type EditModeTool,
} from "./types";

type EditModePluginListener = () => void;

const DEFAULT_CONFIG: EditModePluginConfig = Object.freeze({
    enabled: false,
    active: false,
    tool: "select" as EditModeTool,
    placeKind: "loc" as EditModePlaceKind,
    locId: 0,
    npcId: 0,
    shape: LOC_SHAPE_NORMAL,
    rotation: 0,
    edits: [] as EditModeEdit[],
});

const TOOLS: ReadonlySet<string> = new Set<EditModeTool>(["select", "place", "delete"]);
const PLACE_KINDS: ReadonlySet<string> = new Set<EditModePlaceKind>(["loc", "npc"]);

/** Keys spawned NPCs by the edit that created them, so undo can despawn them. */
function npcKey(edit: EditModeEdit): string {
    return `${edit.tileX},${edit.tileY},${edit.plane},${edit.locId}`;
}

function toInt(value: unknown, fallback: number, min: number, max: number): number {
    const numeric = Math.floor(Number(value));
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(min, Math.min(max, numeric));
}

export class EditModePlugin {
    private readonly listeners = new Set<EditModePluginListener>();
    private readonly persistence?: EditModePluginPersistence;
    private host?: EditModeHost;
    private capturing = false;
    private config: EditModePluginConfig;
    private state: EditModePluginState;
    private selection?: EditModeSelection;
    private search: EditModePluginState["search"] = { query: "", loading: false, results: [] };
    private searchToken = 0;
    private readonly spawnedNpcs = new Map<string, number>();
    private version = 0;

    constructor(persistence?: EditModePluginPersistence) {
        this.persistence = persistence;
        this.config = this.sanitizeConfig(persistence?.load());
        this.state = { config: this.config, search: this.search, version: this.version };
    }

    subscribe(listener: EditModePluginListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    getState(): EditModePluginState {
        return this.state;
    }

    getConfig(): EditModePluginConfig {
        return this.state.config;
    }

    attach(host: EditModeHost): void {
        this.host = host;
        this.syncListeners();
    }

    setConfig(nextConfig: Partial<EditModePluginConfig>): void {
        this.config = this.sanitizeConfig({ ...this.config, ...nextConfig });
        this.syncListeners();
        this.commit();
    }

    /** Cache name for a loc id, "" when the cache is not loaded yet. */
    getLocName(locId: number): string {
        try {
            return this.host?.getLocName(locId) ?? "";
        } catch {
            return "";
        }
    }

    /** Cache name for an NPC type id, "" when the cache is not loaded yet. */
    getNpcName(npcTypeId: number): string {
        try {
            return this.host?.getNpcName(npcTypeId) ?? "";
        } catch {
            return "";
        }
    }

    /** Runs a cache name/id search for the current place kind. */
    searchCache(query: string): void {
        const host = this.host;
        this.search = { query, loading: host !== undefined && query.trim().length > 0, results: [] };
        this.commit();
        if (!host || !this.search.loading) return;

        const token = ++this.searchToken;
        void host
            .search(this.config.placeKind, query)
            .then((results) => {
                if (token !== this.searchToken) return;
                this.search = { query, loading: false, results };
                this.commit();
            })
            .catch(() => {
                if (token !== this.searchToken) return;
                this.search = { query, loading: false, results: [] };
                this.commit();
            });
    }

    /** Selects a search result as the id the place tool will drop. */
    useSearchResult(id: number): void {
        this.setConfig(this.config.placeKind === "npc" ? { npcId: id } : { locId: id });
    }

    rotate(): void {
        this.setConfig({ rotation: (this.config.rotation + 1) & 0x3 });
    }

    /** Re-applies every stored edit to the scene, e.g. after a login or map reload. */
    reapply(): void {
        for (const edit of this.config.edits) {
            this.dispatch(edit);
        }
    }

    /**
     * Reverts the most recent loc placement or NPC spawn. Deletes are not
     * revertible - the loc suppression lives in the renderer's override map
     * until the page reloads.
     * ponytail: undo skips deletes, wire a real override-clear if that bites.
     */
    undo(): boolean {
        const edits = this.config.edits;
        let index = -1;
        for (let i = edits.length - 1; i >= 0; i--) {
            if (edits[i].kind !== "delete") {
                index = i;
                break;
            }
        }
        if (index === -1) return false;

        const edit = edits[index];
        this.revert(edit);
        this.setConfig({ edits: edits.filter((_, i) => i !== index) });
        return true;
    }

    clearEdits(): void {
        for (const edit of this.config.edits) {
            if (edit.kind === "npc") this.revert(edit);
        }
        this.setConfig({ edits: [] });
    }

    private revert(edit: EditModeEdit): void {
        if (edit.kind === "npc") {
            const key = npcKey(edit);
            const serverId = this.spawnedNpcs.get(key);
            if (serverId !== undefined) {
                this.host?.despawnNpc(serverId);
                this.spawnedNpcs.delete(key);
            }
            return;
        }
        if (edit.kind === "place") {
            this.host?.onLocDel(
                { x: edit.tileX, y: edit.tileY },
                edit.plane,
                edit.shape,
                edit.rotation,
            );
        }
    }

    /** Applies the active tool at the tile under the pointer. */
    applyAtPointer(): void {
        const host = this.host;
        const tile = host?.getPointerTile();
        if (!host || !tile) return;

        if (this.config.tool === "select") {
            const loc = host.getPointerLoc();
            this.selection = loc ? { ...tile, ...loc } : { ...tile, locId: -1, locName: "" };
            this.commit();
            return;
        }

        const placingNpc = this.config.tool === "place" && this.config.placeKind === "npc";
        const edit: EditModeEdit = {
            kind: this.config.tool !== "place" ? "delete" : placingNpc ? "npc" : "place",
            locId: placingNpc
                ? this.config.npcId
                : this.config.tool === "place"
                  ? this.config.locId
                  : 0,
            tileX: tile.tileX,
            tileY: tile.tileY,
            plane: tile.plane,
            shape: this.config.shape,
            rotation: this.config.rotation,
        };
        this.dispatch(edit);
        this.setConfig({ edits: [...this.config.edits, edit] });
    }

    private dispatch(edit: EditModeEdit): void {
        const host = this.host;
        if (!host) return;

        if (edit.kind === "npc") {
            const key = npcKey(edit);
            const existing = this.spawnedNpcs.get(key);
            if (existing !== undefined) host.despawnNpc(existing);
            const serverId = host.spawnNpc(
                edit.locId,
                { tileX: edit.tileX, tileY: edit.tileY, plane: edit.plane },
                edit.rotation,
            );
            if (serverId !== undefined) this.spawnedNpcs.set(key, serverId);
            return;
        }

        const tile = { x: edit.tileX, y: edit.tileY };
        if (edit.kind === "place") {
            host.onLocAddChange(edit.locId, tile, edit.plane, edit.shape, edit.rotation);
        } else {
            host.onLocDel(tile, edit.plane, edit.shape, edit.rotation);
        }
    }

    private readonly onMouseDown = (event: MouseEvent): void => {
        if (event.button !== 0 || event.target !== this.host?.getCanvas()) return;
        event.preventDefault();
        event.stopPropagation();
        this.applyAtPointer();
    };

    private readonly onKeyDown = (event: KeyboardEvent): void => {
        const target = event.target as HTMLElement | null;
        if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
        if (event.key === "r" || event.key === "R") {
            event.preventDefault();
            this.rotate();
        } else if (event.key === "Escape") {
            this.setConfig({ active: false });
        }
    };

    private syncListeners(): void {
        if (typeof window === "undefined") return;
        const shouldCapture = this.config.enabled && this.config.active && this.host !== undefined;
        if (shouldCapture === this.capturing) return;
        this.capturing = shouldCapture;

        if (shouldCapture) {
            window.addEventListener("mousedown", this.onMouseDown, true);
            window.addEventListener("keydown", this.onKeyDown, true);
        } else {
            window.removeEventListener("mousedown", this.onMouseDown, true);
            window.removeEventListener("keydown", this.onKeyDown, true);
        }
    }

    private sanitizeConfig(
        input: Partial<EditModePluginConfig> | undefined,
    ): EditModePluginConfig {
        const edits = Array.isArray(input?.edits) ? input.edits : DEFAULT_CONFIG.edits;
        return {
            enabled: input?.enabled ?? DEFAULT_CONFIG.enabled,
            active: (input?.enabled ?? DEFAULT_CONFIG.enabled) && (input?.active ?? false),
            tool: TOOLS.has(input?.tool as string) ? (input?.tool as EditModeTool) : "select",
            placeKind: PLACE_KINDS.has(input?.placeKind as string)
                ? (input?.placeKind as EditModePlaceKind)
                : DEFAULT_CONFIG.placeKind,
            locId: toInt(input?.locId, DEFAULT_CONFIG.locId, 0, 0xffff),
            npcId: toInt(input?.npcId, DEFAULT_CONFIG.npcId, 0, 0xffff),
            shape: toInt(input?.shape, DEFAULT_CONFIG.shape, 0, 22),
            rotation: toInt(input?.rotation, DEFAULT_CONFIG.rotation, 0, 3),
            edits: edits
                .filter(
                    (edit) =>
                        edit &&
                        (edit.kind === "place" || edit.kind === "delete" || edit.kind === "npc"),
                )
                .map((edit) => ({
                    kind: edit.kind,
                    locId: toInt(edit.locId, 0, 0, 0xffff),
                    tileX: toInt(edit.tileX, 0, 0, 0xffff),
                    tileY: toInt(edit.tileY, 0, 0, 0xffff),
                    plane: toInt(edit.plane, 0, 0, 3),
                    shape: toInt(edit.shape, LOC_SHAPE_NORMAL, 0, 22),
                    rotation: toInt(edit.rotation, 0, 0, 3),
                })),
        };
    }

    private commit(): void {
        this.version++;
        this.state = {
            config: this.config,
            selection: this.selection,
            search: this.search,
            version: this.version,
        };
        this.persistence?.save(this.config);
        for (const listener of this.listeners) {
            try {
                listener();
            } catch (err) {
                console.log("[edit-mode-plugin] listener failed", err);
            }
        }
    }
}
