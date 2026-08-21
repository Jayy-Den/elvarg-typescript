import { useCallback, useState, useSyncExternalStore } from "react";

import type { OsrsClient } from "../../OsrsClient";
import type { EditModePlugin } from "./EditModePlugin";
import { LOC_SHAPE_NORMAL, type EditModePlaceKind, type EditModeTool } from "./types";

const TOOLS: ReadonlyArray<{ id: EditModeTool; label: string }> = [
    { id: "select", label: "Select" },
    { id: "place", label: "Place" },
    { id: "delete", label: "Delete" },
    { id: "terrain", label: "Terrain" },
    { id: "path", label: "Path" },
];

const PLACE_KINDS: ReadonlyArray<{ id: EditModePlaceKind; label: string }> = [
    { id: "loc", label: "Loc" },
    { id: "npc", label: "NPC" },
];

// The shapes worth reaching for by hand; the rest are roof/decoration variants.
const SHAPES: ReadonlyArray<{ id: number; label: string }> = [
    { id: LOC_SHAPE_NORMAL, label: "10 - Normal" },
    { id: 0, label: "0 - Wall" },
    { id: 4, label: "4 - Wall decoration" },
    { id: 11, label: "11 - Normal diagonal" },
    { id: 22, label: "22 - Floor decoration" },
];

export default function EditModePanel({ osrsClient }: { osrsClient: OsrsClient }): JSX.Element {
    const plugin = osrsClient.editModePlugin;
    const subscribe = useCallback(
        (listener: () => void) => plugin?.subscribe(listener) ?? (() => {}),
        [plugin],
    );
    const getSnapshot = useCallback(() => plugin?.getState(), [plugin]);
    const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

    if (!plugin || !state) {
        return (
            <div className="rl-sidebar-panel-content">
                <div className="rl-sidebar-panel-title">Edit Mode</div>
                <p className="rl-sidebar-panel-copy">Loading…</p>
            </div>
        );
    }

    const config = state.config;
    const placingNpc = config.placeKind === "npc";
    const activeId = placingNpc ? config.npcId : config.locId;
    const activeName = placingNpc ? plugin.getNpcName(config.npcId) : plugin.getLocName(config.locId);

    return (
        <div className="rl-sidebar-panel-content rl-sidebar-scrollable">
            <div className="rl-sidebar-panel-title">Edit Mode</div>
            <p className="rl-sidebar-panel-copy">
                Development builds only. Edits are client-side and stored in this browser.
            </p>

            <label className="rl-sidebar-check">
                <input
                    type="checkbox"
                    checked={config.active}
                    onChange={(event) => plugin.setConfig({ active: event.target.checked })}
                />
                <span>Capture world clicks (Esc to exit)</span>
            </label>

            <label className="rl-sidebar-check">
                <input
                    type="checkbox"
                    checked={state.scenePreview}
                    onChange={(event) => plugin.setScenePreview(event.target.checked)}
                />
                <span>Scene preview (render the world on the login screen)</span>
            </label>

            <label className="rl-sidebar-check">
                <input
                    type="checkbox"
                    checked={state.freeCamera}
                    onChange={(event) => plugin.setFreeCamera(event.target.checked)}
                />
                <span>Free camera (WASD to fly, E/Q for height)</span>
            </label>

            <div className="rl-sidebar-buttons">
                {TOOLS.map((tool) => (
                    <button
                        key={tool.id}
                        type="button"
                        className={`rl-sidebar-button ${config.tool === tool.id ? "active" : ""}`}
                        onClick={() => plugin.setConfig({ tool: tool.id })}
                    >
                        {tool.label}
                    </button>
                ))}
            </div>

            {(config.tool === "terrain" || config.tool === "path") && (
                <label className="rl-sidebar-field">
                    <span>Floor overlay id</span>
                    <input
                        type="number"
                        min={0}
                        value={config.overlayId}
                        onChange={(event) =>
                            plugin.setConfig({ overlayId: Number(event.target.value) })
                        }
                    />
                </label>
            )}
            {config.tool === "path" && (
                <p className="rl-sidebar-panel-copy">
                    {state.pathStart
                        ? `Path from ${state.pathStart.tileX}, ${state.pathStart.tileY} - click the end tile (Esc cancels).`
                        : "Click the first tile of the path."}
                </p>
            )}

            <div className="rl-sidebar-buttons" hidden={config.tool !== "place"}>
                {PLACE_KINDS.map((kind) => (
                    <button
                        key={kind.id}
                        type="button"
                        className={`rl-sidebar-button ${config.placeKind === kind.id ? "active" : ""}`}
                        onClick={() => plugin.setConfig({ placeKind: kind.id })}
                    >
                        {kind.label}
                    </button>
                ))}
            </div>

            <label className="rl-sidebar-field" hidden={config.tool !== "place"}>
                <span>
                    {placingNpc ? "NPC" : "Loc"} id{activeName ? ` - ${activeName}` : ""}
                </span>
                <input
                    type="number"
                    min={0}
                    value={activeId}
                    onChange={(event) =>
                        plugin.setConfig(
                            placingNpc
                                ? { npcId: Number(event.target.value) }
                                : { locId: Number(event.target.value) },
                        )
                    }
                />
            </label>

            <label className="rl-sidebar-field" hidden={config.tool !== "place"}>
                <span>Search cache by name or id</span>
                <input
                    type="search"
                    value={state.search.query}
                    placeholder={placingNpc ? "e.g. goblin" : "e.g. yew tree"}
                    onChange={(event) => plugin.searchCache(event.target.value)}
                />
            </label>
            {state.search.loading && (
                <p className="rl-sidebar-panel-copy">Indexing the cache…</p>
            )}
            {!state.search.loading && state.search.results.length > 0 && (
                <div className="rl-sidebar-buttons rl-edit-mode-results">
                    {state.search.results.map((result) => (
                        <button
                            key={result.id}
                            type="button"
                            className={`rl-sidebar-button ${activeId === result.id ? "active" : ""}`}
                            onClick={() => plugin.useSearchResult(result.id)}
                        >
                            {result.name} ({result.id})
                        </button>
                    ))}
                </div>
            )}

            <div className="rl-sidebar-row">
                <label
                    className="rl-sidebar-field"
                    hidden={placingNpc || config.tool !== "place"}
                >
                    <span>Shape</span>
                    <select
                        value={config.shape}
                        onChange={(event) => plugin.setConfig({ shape: Number(event.target.value) })}
                    >
                        {SHAPES.map((shape) => (
                            <option key={shape.id} value={shape.id}>
                                {shape.label}
                            </option>
                        ))}
                    </select>
                </label>
                <label className="rl-sidebar-field">
                    <span>Rotation (X)</span>
                    <select
                        value={config.rotation}
                        onChange={(event) =>
                            plugin.setConfig({ rotation: Number(event.target.value) })
                        }
                    >
                        {[0, 1, 2, 3].map((rotation) => (
                            <option key={rotation} value={rotation}>
                                {rotation}
                            </option>
                        ))}
                    </select>
                </label>
            </div>

            <p className="rl-sidebar-panel-copy">
                {state.selection
                    ? state.selection.locId >= 0
                        ? `Selected ${state.selection.locName || "loc"} (${state.selection.locId}) at ${state.selection.tileX}, ${state.selection.tileY}, plane ${state.selection.plane}`
                        : `Tile ${state.selection.tileX}, ${state.selection.tileY}, plane ${state.selection.plane}`
                    : "Select tool: click a loc to inspect it."}
            </p>

            <div className="rl-sidebar-buttons">
                <button type="button" className="rl-sidebar-button" onClick={() => plugin.undo()}>
                    Undo place
                </button>
                <button type="button" className="rl-sidebar-button" onClick={() => plugin.reapply()}>
                    Re-apply
                </button>
                <button
                    type="button"
                    className="rl-sidebar-button"
                    onClick={() => plugin.clearEdits()}
                >
                    Clear
                </button>
            </div>
            <NavigateSection plugin={plugin} />
            <InterfaceSection plugin={plugin} />

            <p className="rl-sidebar-panel-copy">
                {config.edits.length} stored edit{config.edits.length === 1 ? "" : "s"}. Clearing
                forgets them; reload the page to restore deleted cache locs.
            </p>
        </div>
    );
}

function NavigateSection({ plugin }: { plugin: EditModePlugin }): JSX.Element {
    const [tile, setTile] = useState("3222, 3218");

    return (
        <>
            <label className="rl-sidebar-field">
                <span>Jump camera to tile (x, y[, plane])</span>
                <input
                    type="text"
                    value={tile}
                    onChange={(event) => setTile(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key !== "Enter") return;
                        const [x, y, plane] = tile.split(/[ ,]+/).map(Number);
                        if (Number.isFinite(x) && Number.isFinite(y)) {
                            plugin.jumpToTile(x, y, Number.isFinite(plane) ? plane : 0);
                        }
                    }}
                />
            </label>
            <p className="rl-sidebar-panel-copy">
                Press Enter to jump. Turn the free camera on first, or the follow camera pulls it
                straight back to the player.
            </p>
        </>
    );
}

function InterfaceSection({ plugin }: { plugin: EditModePlugin }): JSX.Element {
    const subscribe = useCallback((listener: () => void) => plugin.subscribe(listener), [plugin]);
    const getSnapshot = useCallback(() => plugin.getState(), [plugin]);
    const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    const [filter, setFilter] = useState("");

    const groups = state.interfaces.groups.filter(
        (groupId) => filter.trim().length === 0 || String(groupId).startsWith(filter.trim()),
    );

    return (
        <>
            <div className="rl-sidebar-panel-title">Interfaces</div>
            <div className="rl-sidebar-buttons">
                <button
                    type="button"
                    className="rl-sidebar-button"
                    onClick={() => plugin.refreshInterfaces()}
                >
                    List loaded groups
                </button>
            </div>
            {state.interfaces.groups.length > 0 && (
                <label className="rl-sidebar-field">
                    <span>Filter by group id</span>
                    <input
                        type="search"
                        value={filter}
                        onChange={(event) => setFilter(event.target.value)}
                    />
                </label>
            )}
            {groups.length > 0 && (
                <div className="rl-sidebar-buttons rl-edit-mode-results">
                    {groups.slice(0, 80).map((groupId) => (
                        <button
                            key={groupId}
                            type="button"
                            className={`rl-sidebar-button ${
                                state.interfaces.selected === groupId ? "active" : ""
                            }`}
                            onClick={() => plugin.openInterface(groupId)}
                        >
                            Open {groupId}
                        </button>
                    ))}
                </div>
            )}
            {state.interfaces.selected !== undefined && (
                <p className="rl-sidebar-panel-copy">
                    Group {state.interfaces.selected}: {state.interfaces.widgets.length} widgets.
                    {state.interfaces.widgets.slice(0, 12).map((widget) => (
                        <span key={widget.uid} className="rl-edit-mode-widget-row">
                            {widget.fileId} type {widget.type} at {widget.x},{widget.y} ({
                                widget.width
                            }
                            ×{widget.height}){widget.text ? ` "${widget.text.slice(0, 24)}"` : ""}
                        </span>
                    ))}
                </p>
            )}
        </>
    );
}
