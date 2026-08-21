import { useCallback, useSyncExternalStore } from "react";

import type { OsrsClient } from "../../OsrsClient";
import { LOC_SHAPE_NORMAL, type EditModeTool } from "./types";

const TOOLS: ReadonlyArray<{ id: EditModeTool; label: string }> = [
    { id: "select", label: "Select" },
    { id: "place", label: "Place" },
    { id: "delete", label: "Delete" },
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
    const locName = plugin.getLocName(config.locId);

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

            <label className="rl-sidebar-field">
                <span>Loc id{locName ? ` - ${locName}` : ""}</span>
                <input
                    type="number"
                    min={0}
                    value={config.locId}
                    onChange={(event) => plugin.setConfig({ locId: Number(event.target.value) })}
                />
            </label>

            <div className="rl-sidebar-row">
                <label className="rl-sidebar-field">
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
                    <span>Rotation (R)</span>
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
            <p className="rl-sidebar-panel-copy">
                {config.edits.length} stored edit{config.edits.length === 1 ? "" : "s"}. Clearing
                forgets them; reload the page to restore deleted cache locs.
            </p>
        </div>
    );
}
