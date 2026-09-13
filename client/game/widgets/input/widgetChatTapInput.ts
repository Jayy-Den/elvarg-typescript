import { isMobileMode } from "../../../common/utils/DeviceUtil";
import type { WidgetInputControllerDeps, WidgetInputFrame } from "./widgetInputTypes";
import type { WidgetInteractionController } from "../WidgetInteractionController";
import type { WidgetManager } from "../../../widgets/WidgetManager";

/** Chatbox interface group — its area is the tap-to-type target on mobile. */
const CHATBOX_GROUP_ID = 162;

/**
 * Mobile tap-to-type: a tap that lands inside the chatbox opens the soft keyboard,
 * matching the official mobile client where tapping the chatbar focuses chat input.
 * The actual typing is engine-owned: the keyboard bridge feeds keys through
 * processWidgetKeyboardInput's plain-chatbox path (draft in varc 335, Enter sends).
 *
 * The chatbox background carries a harmless onClick script (162:38), so the trigger
 * is area-based rather than "no widget was hit": only taps consumed by genuinely
 * interactive widgets — the filter buttons (onOp / transmit flags / actions) or any
 * widget outside the chatbox — leave the keyboard closed.
 */
export function processMobileChatTapInput(
    deps: WidgetInputControllerDeps,
    frame: WidgetInputFrame,
    widgetManager: WidgetManager,
    widgetInteraction: WidgetInteractionController,
    isNewClick: boolean,
): void {
    if (!isNewClick || !isMobileMode) return;
    if (!deps.showMobileChatKeyboard) return;

    // The tap must be over the chatbox: the click hit stack (already
    // transform-corrected) must contain a group-162 widget.
    const overChatbox = frame.hits.some(
        (w) => (((w.groupId ?? w.uid >>> 16) | 0) & 0xffff) === CHATBOX_GROUP_ID,
    );
    if (!overChatbox) return;

    // A widget consumed the click. Interactive widgets keep their click; the
    // chatbox's own background and input line (transmit-flag-only, no cache
    // scripts) fall through to the keyboard.
    const clicked = widgetInteraction.clickedWidget;
    if (clicked) {
        const clickedGroup = ((clicked.groupId ?? clicked.uid >>> 16) | 0) & 0xffff;
        if (clickedGroup !== CHATBOX_GROUP_ID) return;
        const hasOnOp = !!(clicked.eventHandlers?.onOp || clicked.onOp);
        const hasActions =
            Array.isArray(clicked.actions) && clicked.actions.length > 0;
        // Transmit flags (IF_SETEVENTS) alone are not interactive handlers — the
        // input line (162:57) carries one so clicks can be reported to the server,
        // and the official client still opens the keyboard for those taps.
        if (hasOnOp || hasActions) return;
    }

    // Don't fight an open input dialog or pause-button flow.
    if (widgetManager?.meslayerContinueWidget) return;

    deps.showMobileChatKeyboard?.();
}
