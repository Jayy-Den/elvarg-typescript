import { chatHistory } from "../../../rs/cs2/ChatHistory";
import type { ScriptEvent } from "../../../rs/cs2/Cs2Vm";
import { createScriptEvent } from "../../../rs/cs2/Cs2Vm";
import { collectWidgetsWithKeyHandlers } from "../../../widgets/menu/utils";
import { ClientPacket, createPacket, queuePacket } from "../../../network/packet";
import { sendChat } from "../../../network/ServerConnection";
import type { WidgetInputControllerDeps, WidgetInputFrame } from "./widgetInputTypes";
import type { WidgetInteractionController } from "../WidgetInteractionController";
import type { WidgetManager } from "../../../widgets/WidgetManager";

/** Varc string 335 holds the chatbox draft text. */
const CHAT_INPUT_VARC = 335;
/** OSRS internal key codes. */
const OSRS_KEY_ENTER = 84;
const OSRS_KEY_BACKSPACE = 85;
const OSRS_KEY_ESCAPE = 13;
/** [proc,chat_promptinput] rebuilds the chatbox input line from varc 335. */
const CHAT_PROMPT_SCRIPT_ID = 223;

export function processWidgetKeyboardInput(
    deps: WidgetInputControllerDeps,
    frame: WidgetInputFrame,
    widgetManager: WidgetManager,
): void {
    const { input, mx, my, allRoots, visibleMap, getStaticChildren } = frame;
    if (input.keyEvents.length > 0) {
        // When inputDialogType > 0, keyboard input is captured for the dialog
        // Type 0 = no dialog, Type 1 = default, Type 2 = interface-scoped, Type 3 = widget-scoped
        // Type 1 is also what CS2 arms for plain chatbox typing (SETKEYINPUTMODE_KEYBOARD,
        // fired by the mobile chat-bar tap). Amount dialogs always set a pending action
        // first; plain chatbox mode never does.
        const hasPendingAmountAction =
            !!deps.getPendingInputDialogAction() || !!deps.getPendingTradeQuantityAction();
        // The soft-keyboard bridge being open is the reliable plain-chatbox-mode signal:
        // SETKEYINPUTMODE_KEYBOARD (inputDialogType 1) is flaky across sessions and
        // script 73's sender dead-ends in a Clan-channel branch whose mode vars this
        // client/server never syncs.
        const plainChatboxKeyboardMode = deps.getMobileChatKeyboardOpen();
        // Amount dialogs (bank withdraw-x, trade offer-x) always set a pending action
        // first; arming without one is plain chatbox mode, owned by the engine block
        // below so Enter submits chat instead of being parsed as a quantity.
        const dialogActive =
            deps.getCs2Vm().inputDialogType > 0 && hasPendingAmountAction;
        const customInterfaceSearchHandled =
            !dialogActive && deps.getCustomInterfaces().handleSearchKeyEvents(input.keyEvents);

        // Process keyboard input for active dialog before widget handlers
        if (dialogActive) {
            for (const keyEvent of input.keyEvents) {
                if (keyEvent.keyTyped === OSRS_KEY_BACKSPACE) {
                    // Backspace - remove last character
                    if (deps.getCs2Vm().inputDialogString.length > 0) {
                        deps.getCs2Vm().inputDialogString = deps.getCs2Vm().inputDialogString.slice(
                            0,
                            -1,
                        );
                        // Update VarC string 335 (chatbox input) for CS2 scripts to read
                        deps.getVarManager().setVarcString(335, deps.getCs2Vm().inputDialogString);
                        // The native chatbox input overlay reads VarC 335.
                        // Do not inject a history line for pending trade X input.
                        if (!deps.getPendingTradeQuantityAction()) {
                            chatHistory.addMessage(
                                "game",
                                `Enter amount: ${deps.getCs2Vm().inputDialogString}_`,
                            );
                        }
                    }
                } else if (keyEvent.keyTyped === OSRS_KEY_ESCAPE) {
                    // Escape - cancel dialog
                    deps.getCs2Vm().inputDialogType = 0;
                    deps.getCs2Vm().inputDialogWidgetId = -1;
                    deps.getCs2Vm().inputDialogString = "";
                    deps.getVarManager().setVarcString(335, "");
                    // Clear any pending widget action since user cancelled
                    if (deps.getPendingInputDialogAction() || deps.getPendingTradeQuantityAction()) {
                        chatHistory.addMessage("game", "Input cancelled.");
                        console.log("[InputDialog] Cancelled, clearing pending action");
                        deps.setPendingInputDialogAction(null);
                        deps.setPendingTradeQuantityAction(null);
                    }
                } else if (keyEvent.keyTyped === OSRS_KEY_ENTER) {
                    // Enter - submit dialog
                    if (
                        deps.getCs2Vm().inputDialogString.length > 0 &&
                        deps.getCs2Vm().onInputDialogComplete
                    ) {
                        const value = parseInt(deps.getCs2Vm().inputDialogString, 10) || 0;
                        console.log(`[InputDialog] Submitting value: ${value}`);
                        deps.getCs2Vm().onInputDialogComplete?.("count", value);
                    } else if (deps.getPendingInputDialogAction() || deps.getPendingTradeQuantityAction()) {
                        // No input but pending action - cancel
                        chatHistory.addMessage("game", "No amount entered.");
                        deps.setPendingInputDialogAction(null);
                        deps.setPendingTradeQuantityAction(null);
                    }
                    // Clear dialog state
                    deps.getCs2Vm().inputDialogType = 0;
                    deps.getCs2Vm().inputDialogWidgetId = -1;
                    deps.getCs2Vm().inputDialogString = "";
                    deps.getVarManager().setVarcString(335, "");
                } else if (keyEvent.keyPressed > 0) {
                    // Regular character input - only accept digits for quantity dialogs
                    const char = String.fromCharCode(keyEvent.keyPressed);
                    // For bank quantity dialogs, only accept digits
                    if (
                        (deps.getPendingInputDialogAction() || deps.getPendingTradeQuantityAction()) &&
                        !/^\d$/.test(char)
                    ) {
                        continue; // Skip non-digit characters
                    }
                    // Limit input length (OSRS limits vary by dialog type, 12 for counts, 80 for names)
                    const maxLen = deps.getCs2Vm().inputDialogType === 3 ? 80 : 12;
                    if (deps.getCs2Vm().inputDialogString.length < maxLen) {
                        deps.getCs2Vm().inputDialogString += char;
                        // Update VarC string 335 for CS2 scripts to read
                        deps.getVarManager().setVarcString(335, deps.getCs2Vm().inputDialogString);
                        // The native chatbox input overlay reads VarC 335.
                        if (!deps.getPendingTradeQuantityAction()) {
                            chatHistory.addMessage(
                                "game",
                                `Enter amount: ${deps.getCs2Vm().inputDialogString}_`,
                            );
                        }
                    }
                }
            }

            // The dialog above is the sole owner of these key events.
            // Do not forward them to widget onKey listeners as well: the
            // chatbox input script would append the same digit a second time.
            return;
        }

        if (customInterfaceSearchHandled) {
            return;
        }

        // Plain chatbox typing: engine-owned. Covers (a) the mobile soft-keyboard
        // bridge being open and (b) desktop Enter-to-Chat unlocked mode. The engine
        // owns the draft because the chatbox onKey sender (script 73) routes Enter
        // through chat-channel state this client/server never syncs — its
        // Clan-channel branch silently discards the message. Mirror the desktop
        // keydown contract: chars/backspace maintain the draft (varc 335), Enter
        // submits public chat (as CHAT_SENDPUBLIC would) and re-locks Enter-to-Chat,
        // Escape cancels; then [proc,chat_promptinput] rebuilds the input line.
        // "::" command drafts go through the same public-chat path — the server
        // intercepts them before broadcast (chatHandler.ts).
        const engineOwnsChatTyping =
            plainChatboxKeyboardMode ||
            (deps.getEnterToTypeChat().isEnabled() && deps.getEnterToTypeChat().isUnlocked);
        if (engineOwnsChatTyping) {
            let draft = deps.getVarManager().getVarcString(CHAT_INPUT_VARC) ?? "";
            for (const keyEvent of input.keyEvents) {
                if (keyEvent.keyTyped === OSRS_KEY_ENTER) {
                    if (draft.trim().length > 0) {
                        sendChat(draft, "public", 0);
                    }
                    draft = "";
                    deps.getCs2Vm().context.hideMobileKeyboard?.();
                    deps.getEnterToTypeChat().setUnlocked(false);
                } else if (keyEvent.keyTyped === OSRS_KEY_ESCAPE) {
                    draft = "";
                    deps.getCs2Vm().context.hideMobileKeyboard?.();
                    deps.getEnterToTypeChat().setUnlocked(false);
                } else if (keyEvent.keyTyped === OSRS_KEY_BACKSPACE) {
                    draft = draft.slice(0, -1);
                } else if (keyEvent.keyPressed > 0) {
                    if (draft.length < 80) {
                        draft += String.fromCharCode(keyEvent.keyPressed);
                    }
                }
            }
            deps.getCs2Vm().inputDialogString = draft;
            deps.getVarManager().setVarcString(CHAT_INPUT_VARC, draft);
            try {
                deps.getCs2Vm().runScriptEvent(
                    createScriptEvent({ args: [CHAT_PROMPT_SCRIPT_ID] }),
                );
            } catch {}
            // The engine owns these key events; do not also dispatch them to widgets.
            return;
        }

        for (const keyEvent of input.keyEvents) {
            if (keyEvent.keyTyped === OSRS_KEY_ESCAPE) {
                // Same IF_CLOSE packet MenuAction.ts already sends for
                // MenuOpcode.WidgetClose (verified against
                // ClientBinaryEncoder.ts/ClientProtocol.ts - IF_CLOSE = 55,
                // 0-byte payload, decodes server-side to {type:
                // "interface_close"}, handled in NetworkBuilder.ts via
                // Player.closeInterruptibleInterfaces()).
                const pkt = createPacket(ClientPacket.IF_CLOSE);
                queuePacket(pkt);
                return;
            }
        }

        // Collect ALL widgets with onKey handlers from all roots.
        // Note: some widget trees can reference the same widget via multiple traversal paths
        // (e.g., legacy IF1 `children` plus parentUid-indexed children), so de-duplicate by uid.
        const keyWidgetsByUid = new Map<number, any>();
        for (const root of allRoots) {
            const keyWidgets = collectWidgetsWithKeyHandlers(
                root,
                visibleMap,
                getStaticChildren,
            );
            for (const w of keyWidgets) {
                const uid = (w?.uid ?? 0) | 0;
                if (uid !== 0) keyWidgetsByUid.set(uid, w);
            }
        }
        // Also dispatch keys to InterfaceParent-mounted sub-interfaces
        // (e.g., chatbox input handlers). Mounted interfaces are separate widget trees.
        for (const [containerUid, parent] of widgetManager.interfaceParents) {
            if (!parent) continue;
            // Skip if the container (or any ancestor) is hidden.
            if (widgetManager.isEffectivelyHidden(containerUid)) continue;
            // Root interface is already covered by allRoots.
            if ((parent.group | 0) === (widgetManager.rootInterface | 0)) continue;

            const subRoots = widgetManager.getAllGroupRoots(parent.group);
            for (const root of subRoots) {
                const keyWidgets = collectWidgetsWithKeyHandlers(
                    root,
                    visibleMap,
                    getStaticChildren,
                );
                for (const w of keyWidgets) {
                    const uid = (w?.uid ?? 0) | 0;
                    if (uid !== 0) keyWidgetsByUid.set(uid, w);
                }
            }
        }

        // Process all key events for all widgets with onKey handlers
        for (const keyEvent of input.keyEvents) {
            // Enter-to-type gate (desktop): Enter/Escape toggle chat typing mode and
            // are consumed; while locked, no keys are delivered to chatbox widgets.
            if (deps.getEnterToTypeChat().handleKeyEvent(keyEvent, dialogActive)) {
                continue;
            }
            const blockChatboxKeys = deps.getEnterToTypeChat().shouldBlockChatboxKeys(dialogActive);
            for (const w of keyWidgetsByUid.values()) {
                if (blockChatboxKeys && deps.getEnterToTypeChat().isChatboxGroupUid((w?.uid ?? 0) | 0)) {
                    continue;
                }
                const keyCtx: Partial<ScriptEvent> = {
                    mouseX: mx - (w._absX ?? w.x ?? 0),
                    mouseY: my - (w._absY ?? w.y ?? 0),
                    keyTyped: keyEvent.keyTyped,
                    keyPressed: keyEvent.keyPressed,
                };
                if (w.eventHandlers?.onKey) {
                    deps.getCs2Vm().invokeEventHandler(w, "onKey", keyCtx);
                } else if (w.onKey) {
                    deps.executeScriptListener(w, w.onKey, keyCtx);
                }
            }
            // Enter while typing sends the message (handled by the chatbox scripts
            // above); re-lock so movement keys are captured again (RuneLite behavior).
            if (
                !dialogActive &&
                deps.getEnterToTypeChat().isUnlocked &&
                deps.getEnterToTypeChat().isEnabled() &&
                keyEvent.keyTyped === OSRS_KEY_ENTER
            ) {
                deps.getEnterToTypeChat().setUnlocked(false);
            }
        }
    }
}
