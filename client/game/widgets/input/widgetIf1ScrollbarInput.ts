import { ClickMode } from "../../InputManager";
import type { WidgetInputControllerDeps, WidgetInputFrame, WidgetInputState } from "./widgetInputTypes";
import type { WidgetInteractionController } from "../WidgetInteractionController";
import type { WidgetManager } from "../../../widgets/WidgetManager";

export function processWidgetIf1ScrollbarInput(
    deps: WidgetInputControllerDeps,
    state: WidgetInputState,
    frame: WidgetInputFrame,
    widgetManager: WidgetManager,
    widgetInteraction: WidgetInteractionController,
): void {
    const { input, mx, my, allRoots, getStaticChildren } = frame;
    if (!widgetInteraction.isDraggingWidget) {
        state.if1AlternativeScrollbarWidth = state.if1ScrollbarDragging ? 32 : 0;
        state.if1ScrollbarDragging = false;

        const isLeftHeld = input.clickMode2 === ClickMode.LEFT;
        const if1WheelDelta = input.wheelDeltaY;
        
        // Touch scroll: if left is held, scroll the widget under the pointer
        if (isLeftHeld) {
            for (let i = allRoots.length - 1; i >= 0; i--) {
                const scrollResult = scrollWidgetAtPoint(
                    allRoots[i],
                    mx,
                    my,
                    state,
                    widgetManager,
                    input.mouseX - (state.lastTouchScrollX ?? mx),
                    input.mouseY - (state.lastTouchScrollY ?? my),
                );
                if (scrollResult) {
                    state.lastTouchScrollX = mx;
                    state.lastTouchScrollY = my;
                    break;
                }
            }
        } else if (isLeftHeld || if1WheelDelta !== 0) {
            const SCROLLBAR_WIDTH = 16;
            const ARROW_HEIGHT = 16;
            let handledWheel = false;

            const handleIf1Scrollbars = (
                widget: any,
                parentAbsX: number,
                parentAbsY: number,
            ): boolean => {
                if (!widget) return false;
                const uid = (widget.uid ?? 0) | 0;
                if (uid !== 0 && widgetManager.isEffectivelyHidden(uid)) return false;
                if (widget.hidden || widget.hide) return false;

                const absX = (parentAbsX + (widget.x ?? 0)) | 0;
                const absY = (parentAbsY + (widget.y ?? 0)) | 0;

                const widgetType = ((widget.type ?? 0) | 0) as number;
                const widgetWidth = (widget.width ?? 0) | 0;
                const widgetHeight = (widget.height ?? 0) | 0;
                const scrollHeight = (widget.scrollHeight ?? 0) | 0;
                const isIf1Scrollable =
                    widgetType === 0 && widget.isIf3 === false && scrollHeight > widgetHeight;

                if (isIf1Scrollable) {
                    const scrollbarX = absX + widgetWidth;
                    const maxScrollY = Math.max(0, scrollHeight - widgetHeight);
                    const clampScrollY = (value: number): number =>
                        Math.min(Math.max(0, value | 0), maxScrollY);

                    if (isLeftHeld) {
                        if (
                            mx >= scrollbarX &&
                            mx < scrollbarX + SCROLLBAR_WIDTH &&
                            my >= absY &&
                            my < absY + ARROW_HEIGHT
                        ) {
                            widget.scrollY = clampScrollY((widget.scrollY ?? 0) - 4);
                            widgetManager.invalidateScroll(widget);
                            return true;
                        }
                        if (
                            mx >= scrollbarX &&
                            mx < scrollbarX + SCROLLBAR_WIDTH &&
                            my >= absY + widgetHeight - ARROW_HEIGHT &&
                            my < absY + widgetHeight
                        ) {
                            widget.scrollY = clampScrollY((widget.scrollY ?? 0) + 4);
                            widgetManager.invalidateScroll(widget);
                            return true;
                        }
                        if (
                            mx >= scrollbarX - state.if1AlternativeScrollbarWidth &&
                            mx <
                                scrollbarX +
                                    SCROLLBAR_WIDTH +
                                    state.if1AlternativeScrollbarWidth &&
                            my >= absY + ARROW_HEIGHT &&
                            my < absY + widgetHeight - ARROW_HEIGHT
                        ) {
                            let thumbHeight = Math.floor(
                                (widgetHeight * (widgetHeight - 32)) / scrollHeight,
                            );
                            if (thumbHeight < 8) thumbHeight = 8;
                            const clickPosY = my - absY - ARROW_HEIGHT - (thumbHeight >> 1);
                            const trackHeight = widgetHeight - 32 - thumbHeight;
                            widget.scrollY = clampScrollY(
                                trackHeight > 0
                                    ? Math.floor(
                                          (clickPosY * (scrollHeight - widgetHeight)) /
                                              trackHeight,
                                      )
                                    : 0,
                            );
                            widgetManager.invalidateScroll(widget);
                            state.if1ScrollbarDragging = true;
                            return true;
                        }
                    }

                    if (
                        !handledWheel &&
                        if1WheelDelta !== 0 &&
                        mx >= scrollbarX - widgetWidth &&
                        my >= absY &&
                        mx < scrollbarX + SCROLLBAR_WIDTH &&
                        my <= absY + widgetHeight
                    ) {
                        widget.scrollY = clampScrollY(
                            (widget.scrollY ?? 0) + if1WheelDelta * 45,
                        );
                        widgetManager.invalidateScroll(widget);
                        handledWheel = true;
                    }
                }

                const childBaseX = absX - ((widget.scrollX ?? 0) | 0);
                const childBaseY = absY - ((widget.scrollY ?? 0) | 0);

                if (widget.uid !== undefined) {
                    const staticChildren = getStaticChildren(widget.uid);
                    for (let i = staticChildren.length - 1; i >= 0; i--) {
                        if (handleIf1Scrollbars(staticChildren[i], childBaseX, childBaseY)) {
                            return true;
                        }
                    }
                }
                if (Array.isArray(widget.children)) {
                    for (let i = widget.children.length - 1; i >= 0; i--) {
                        const child = widget.children[i];
                        if (handleIf1Scrollbars(child, childBaseX, childBaseY)) return true;
                    }
                }
                return false;
            };

            for (let i = allRoots.length - 1; i >= 0; i--) {
                if (handleIf1Scrollbars(allRoots[i], 0, 0)) break;
            }
            if (handledWheel) {
                input.wheelDeltaY = 0;
            }
        }
    }
}

/**
 * Find a scrollable widget at the given point and scroll it by the delta.
 * Returns true if a widget was scrolled.
 */
function scrollWidgetAtPoint(
    root: any,
    px: number,
    py: number,
    state: any,
    widgetManager: any,
    deltaX: number,
    deltaY: number,
): boolean {
    if (!root) return false;

    const scrollable = findScrollableWidget(root, px, py, widgetManager);
    if (scrollable) {
        const maxScrollY = Math.max(0, (scrollable.scrollHeight ?? 0) - (scrollable.height ?? 0));
        const newScrollY = Math.min(Math.max(0, (scrollable.scrollY ?? 0) + deltaY), maxScrollY);
        if (newScrollY !== scrollable.scrollY) {
            scrollable.scrollY = newScrollY;
            widgetManager.invalidateScroll(scrollable);
            return true;
        }
    }
    return false;
}

/**
 * Recursively find a scrollable widget at the given point.
 */
function findScrollableWidget(widget: any, px: number, py: number, widgetManager: any): any {
    if (!widget) return null;

    const uid = (widget.uid ?? 0) | 0;
    if (uid !== 0 && widgetManager.isEffectivelyHidden(uid)) return null;
    if (widget.hidden || widget.hide) return null;

    const absX = (widget._absX ?? widget.x ?? 0) | 0;
    const absY = (widget._absY ?? widget.y ?? 0) | 0;
    const width = Math.max(1, (widget.width ?? 0) | 0);
    const height = Math.max(1, (widget.height ?? 0) | 0);

    // Check children first (top-most first)
    if (Array.isArray(widget.children)) {
        for (let i = widget.children.length - 1; i >= 0; i--) {
            const child = widget.children[i];
            if (child) {
                const result = findScrollableWidget(child, px, py, widgetManager);
                if (result) return result;
            }
        }
    }

    // Check if this widget is scrollable and contains the point
    if ((widget.scrollHeight ?? 0) > height) {
        if (px >= absX && px < absX + width && py >= absY && py < absY + height) {
            return widget;
        }
    }

    return null;
}
