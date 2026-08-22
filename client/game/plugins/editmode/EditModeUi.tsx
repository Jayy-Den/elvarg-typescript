import { memo, useEffect } from "react";

import type { OsrsClient } from "../../OsrsClient";
import { mountEditorUi } from "./EditorUi";

/**
 * Dev-only. Mounts the editor's own chrome while edit mode is on; the panels are
 * plain DOM in the elvarg-web-client editor's style rather than app UI.
 */
export default memo(function EditModeUi({ osrsClient }: { osrsClient: OsrsClient }): null {
    const plugin = osrsClient.editModePlugin;

    useEffect(() => {
        if (!plugin) return;
        let teardown: (() => void) | undefined;

        const sync = (): void => {
            // Only while actually editing - the chrome has no business sitting
            // over the login screen or normal gameplay.
            const state = plugin.getState();
            const enabled = state.config.enabled && (state.scenePreview || state.config.active);
            if (enabled && !teardown) {
                teardown = mountEditorUi(plugin);
            } else if (!enabled && teardown) {
                teardown();
                teardown = undefined;
            }
        };

        sync();
        const unsubscribe = plugin.subscribe(sync);
        return () => {
            unsubscribe();
            teardown?.();
        };
    }, [plugin]);

    return null;
});
