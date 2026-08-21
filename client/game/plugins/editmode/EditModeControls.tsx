import { button, folder, useControls } from "leva";
import { memo, useCallback, useSyncExternalStore } from "react";

import type { OsrsClient } from "../../OsrsClient";
import type { EditModePlaceKind, EditModeTool } from "./types";

const TOOL_OPTIONS: Record<string, EditModeTool> = {
    Select: "select",
    Place: "place",
    Delete: "delete",
    Terrain: "terrain",
    Path: "path",
};

/**
 * leva calls every onChange once with `initial: true` each time the schema is
 * rebuilt (which dynamic options force). Those calls carry the schema's value,
 * not the user's intent, so honouring them writes stale state back the moment
 * the plugin changes something itself.
 */
function onUserChange<T>(apply: (value: T) => void) {
    return (value: T, _path: string, context: { initial: boolean }): void => {
        if (context.initial) return;
        apply(value);
    };
}

const KIND_OPTIONS: Record<string, EditModePlaceKind> = { Loc: "loc", NPC: "npc" };

// The shapes worth reaching for by hand; the rest are roof/decoration variants.
const SHAPE_OPTIONS: Record<string, number> = {
    "10 - Normal": 10,
    "0 - Wall": 0,
    "4 - Wall decoration": 4,
    "11 - Normal diagonal": 11,
    "22 - Floor decoration": 22,
};

/**
 * Dev-only leva folder for the edit mode plugin. Rendered from DebugControls so
 * it sits with the other developer tooling instead of the player-facing sidebar.
 */
export default memo(function EditModeControls({
    osrsClient,
}: {
    osrsClient: OsrsClient;
}): JSX.Element | null {
    const plugin = osrsClient.editModePlugin;
    const subscribe = useCallback(
        (listener: () => void) => plugin?.subscribe(listener) ?? (() => {}),
        [plugin],
    );
    const getSnapshot = useCallback(() => plugin?.getState(), [plugin]);
    const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

    const config = state?.config;
    const placingNpc = config?.placeKind === "npc";
    const activeId = (placingNpc ? config?.npcId : config?.locId) ?? 0;
    // Rebuild the folder when the lists change, but not on every keystroke -
    // that would steal focus from the search box.
    const resultKey = state?.search.results.map((result) => result.id).join(",") ?? "";
    const groupKey = state?.interfaces.groups.length ?? 0;

    useControls(
        {
            "Edit Mode": folder(
                {
                    Enabled: {
                        value: config?.enabled ?? false,
                        onChange: onUserChange((value: boolean) => {
                            plugin?.setConfig({ enabled: value, active: value && config?.active });
                        }),
                    },
                    "Scene preview": {
                        value: state?.scenePreview ?? false,
                        hint: "Render the world on the login screen",
                        onChange: onUserChange((value: boolean) => {
                            plugin?.setScenePreview(value);
                        }),
                    },
                    "Free camera": {
                        value: state?.freeCamera ?? false,
                        hint: "WASD to fly, E/Q for height",
                        onChange: onUserChange((value: boolean) => {
                            plugin?.setFreeCamera(value);
                        }),
                    },
                    "Capture clicks": {
                        value: config?.active ?? false,
                        hint: "Left click applies the tool (Esc exits)",
                        onChange: onUserChange((value: boolean) => {
                            plugin?.setConfig({ active: value });
                        }),
                    },
                    Tool: {
                        value: config?.tool ?? "select",
                        options: TOOL_OPTIONS,
                        onChange: onUserChange((value: EditModeTool) => {
                            plugin?.setConfig({ tool: value });
                        }),
                    },
                    Place: folder(
                        {
                            Kind: {
                                value: config?.placeKind ?? "loc",
                                options: KIND_OPTIONS,
                                onChange: onUserChange((value: EditModePlaceKind) => {
                                    plugin?.setConfig({ placeKind: value });
                                }),
                            },
                            Id: {
                                value: activeId,
                                step: 1,
                                min: 0,
                                onChange: onUserChange((value: number) => {
                                    plugin?.setConfig(
                                        placingNpc ? { npcId: value | 0 } : { locId: value | 0 },
                                    );
                                }),
                            },
                            Name: {
                                value: placingNpc
                                    ? (plugin?.getNpcName(activeId) ?? "")
                                    : (plugin?.getLocName(activeId) ?? ""),
                                editable: false,
                            },
                            Search: {
                                value: state?.search.query ?? "",
                                onChange: onUserChange((value: string) => {
                                    plugin?.searchCache(value);
                                }),
                            },
                            Results: {
                                value: state?.search.results[0]?.id ?? 0,
                                options: Object.fromEntries(
                                    (state?.search.results ?? []).map((result) => [
                                        `${result.name} (${result.id})`,
                                        result.id,
                                    ]),
                                ),
                                onChange: onUserChange((value: number) => {
                                    plugin?.useSearchResult(value | 0);
                                }),
                            },
                            Shape: {
                                value: config?.shape ?? 10,
                                options: SHAPE_OPTIONS,
                                onChange: onUserChange((value: number) => {
                                    plugin?.setConfig({ shape: value | 0 });
                                }),
                            },
                            Rotation: {
                                value: config?.rotation ?? 0,
                                options: [0, 1, 2, 3],
                                onChange: onUserChange((value: number) => {
                                    plugin?.setConfig({ rotation: value | 0 });
                                }),
                            },
                        },
                        { collapsed: true },
                    ),
                    Terrain: folder(
                        {
                            "Overlay id": {
                                value: config?.overlayId ?? 2,
                                step: 1,
                                min: 0,
                                onChange: onUserChange((value: number) => {
                                    plugin?.setConfig({ overlayId: value | 0 });
                                }),
                            },
                        },
                        { collapsed: true },
                    ),
                    Camera: folder(
                        {
                            "Jump to tile": { value: "3222, 3218", label: "x, y[, plane]" },
                            Jump: button((get) => {
                                const [x, y, plane] = String(get("Edit Mode.Camera.Jump to tile"))
                                    .split(/[ ,]+/)
                                    .map(Number);
                                if (Number.isFinite(x) && Number.isFinite(y)) {
                                    plugin?.jumpToTile(x, y, Number.isFinite(plane) ? plane : 0);
                                }
                            }),
                        },
                        { collapsed: true },
                    ),
                    Interfaces: folder(
                        {
                            "List groups": button(() => plugin?.refreshInterfaces()),
                            Group: {
                                value: state?.interfaces.selected ?? 0,
                                options: Object.fromEntries(
                                    (state?.interfaces.groups ?? []).map((groupId) => [
                                        String(groupId),
                                        groupId,
                                    ]),
                                ),
                                onChange: onUserChange((value: number) => {
                                    plugin?.openInterface(value | 0);
                                }),
                            },
                            Widgets: {
                                value: `${state?.interfaces.widgets.length ?? 0} in group`,
                                editable: false,
                            },
                        },
                        { collapsed: true },
                    ),
                    Edits: folder(
                        {
                            Stored: { value: config?.edits.length ?? 0, editable: false },
                            Undo: button(() => plugin?.undo()),
                            "Re-apply": button(() => plugin?.reapply()),
                            Clear: button(() => plugin?.clearEdits()),
                        },
                        { collapsed: true },
                    ),
                },
                { collapsed: true },
            ),
        },
        [
            plugin,
            config?.enabled,
            config?.active,
            config?.tool,
            config?.placeKind,
            config?.shape,
            config?.rotation,
            config?.overlayId,
            config?.edits.length,
            state?.freeCamera,
            state?.scenePreview,
            state?.interfaces.selected,
            activeId,
            resultKey,
            groupKey,
        ],
    );

    return null;
});
