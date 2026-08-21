import { LevaPanel, button, folder, useControls, useCreateStore } from "leva";
import { memo, useCallback, useEffect, useSyncExternalStore } from "react";

import type { OsrsClient } from "../../OsrsClient";
import type { EditModePlaceKind, EditModeTool } from "./types";

const TOOL_OPTIONS: Record<string, EditModeTool> = {
    Select: "select",
    Place: "place",
    Delete: "delete",
    Terrain: "terrain",
    Path: "path",
};

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
 * leva fires onChange for programmatic set() calls and once per schema rebuild
 * as well as for real edits. Only edits carry fromPanel, so anything else would
 * write the panel's stale value back over the plugin's own state.
 */
function onUserChange<T>(apply: (value: T) => void) {
    return (
        value: T,
        _path: string,
        context: { initial: boolean; fromPanel?: boolean },
    ): void => {
        if (context.initial || context.fromPanel !== true) return;
        apply(value);
    };
}

/**
 * Dev-only editor controls. These live in their own leva panel rather than the
 * renderer's, so the editor can be opened and collapsed on its own.
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
    const store = useCreateStore();

    const config = state?.config;
    const placingNpc = config?.placeKind === "npc";
    const activeId = (placingNpc ? config?.npcId : config?.locId) ?? 0;
    // Rebuild when the lists change, but not on every keystroke - that would
    // steal focus from the search box.
    const resultKey = state?.search.results.map((result) => result.id).join(",") ?? "";
    const groupKey = state?.interfaces.groups.length ?? 0;

    const [, set] = useControls(
        () => ({
            Enabled: {
                value: config?.enabled ?? false,
                onChange: onUserChange((value: boolean) => {
                    plugin?.setConfig({
                        enabled: value,
                        active: value && plugin.getConfig().active,
                    });
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
                hint: "WASD to fly, E/Q for height, drag to look",
                onChange: onUserChange((value: boolean) => {
                    plugin?.setFreeCamera(value);
                }),
            },
            "Capture clicks": {
                value: config?.active ?? false,
                hint: "Left click applies the tool, drag still moves the camera",
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
                                plugin.getConfig().placeKind === "npc"
                                    ? { npcId: value | 0 }
                                    : { locId: value | 0 },
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
                        const [x, y, plane] = String(get("Camera.Jump to tile"))
                            .split(/[ ,]+/)
                            .map(Number);
                        if (Number.isFinite(x) && Number.isFinite(y)) {
                            plugin?.jumpToTile(x, y, Number.isFinite(plane) ? plane : 0);
                        }
                    }),
                    Level: button(() => plugin?.levelCamera()),
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
                    Stored: { value: `${config?.edits.length ?? 0}`, editable: false },
                    Undo: button(() => plugin?.undo()),
                    "Re-apply": button(() => plugin?.reapply()),
                    Clear: button(() => plugin?.clearEdits()),
                },
                { collapsed: true },
            ),
        }),
        { store },
        // Only the dynamic option lists need a rebuild; every other value is
        // pushed in below, which keeps the search box from losing focus.
        [plugin, store, resultKey, groupKey],
    );

    useEffect(() => {
        // leva's set() typing only covers the leaves it can infer; every path
        // here is a real input, and leva warns in the console if one is not.
        const push = set as (values: Record<string, unknown>) => void;
        push({
            Enabled: config?.enabled ?? false,
            "Scene preview": state?.scenePreview ?? false,
            "Free camera": state?.freeCamera ?? false,
            "Capture clicks": config?.active ?? false,
            Tool: config?.tool ?? "select",
            Kind: config?.placeKind ?? "loc",
            Id: activeId,
            Name: placingNpc
                ? (plugin?.getNpcName(activeId) ?? "")
                : (plugin?.getLocName(activeId) ?? ""),
            Shape: config?.shape ?? 10,
            Rotation: config?.rotation ?? 0,
            "Overlay id": config?.overlayId ?? 2,
            Widgets: `${state?.interfaces.widgets.length ?? 0} in group`,
            Stored: `${config?.edits.length ?? 0}`,
        });
    }, [
        set,
        plugin,
        activeId,
        placingNpc,
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
        state?.interfaces.widgets.length,
    ]);

    return (
        <div className="leva-edit-mode">
            <LevaPanel
                store={store}
                titleBar={{ title: "Edit Mode", filter: false }}
                hideCopyButton={true}
                fill={false}
            />
        </div>
    );
});
