// Mobile viewport support: display-mode tracking + component UID translation.
//
// A player that logs in with clientType 1 (mobile) gets the OSRS mobile toplevel
// `toplevel_osm` (group 601) instead of the resizable desktop frame `toplevel_osrs_stretch`
// (group 161). Every server-side interface mount that used to target (161 << 16) | child is
// translated through cache enum 1745 (161 -> 601 component map) so the same game content
// renders in the mobile frame, and incoming clicks that carry 601 UIDs are translated back
// so the existing desktop-oriented plugins keep working unchanged.
//
// The map below was dumped from cache enum 1745 of the osrs-237 cache this server serves
// (see `yarn dump:enum 1745`); entries not present fall back to the desktop UID, which is
// correct for the mobile-only components that have no 161 equivalent (hotkeys 601:40, etc.).

/** Desktop resizable toplevel (toplevel_osrs_stretch). */
export const DESKTOP_ROOT_GROUP = 161;
/** Mobile toplevel (toplevel_osm). */
export const MOBILE_ROOT_GROUP = 601;

/** Popout/share panel group (mounted at 601:134 on mobile). */
export const POPOUT_PANEL_GROUP = 728;
/**
 * 728's desktop-layout edge rail: a 58x1128 strip that hugs the left edge. On the
 * native engine its visibility is managed by the toplevel's var-transmit listener
 * chain; on this client that chain (cs2 902) throws on the device path, so the rail
 * would render permanently. The server hides it after the mobile bootstrap mounts.
 */
export const POPOUT_PANEL_RAIL_CHILD = 10;

export type DisplayMode = "desktop" | "mobile";

/**
 * cache enum 1745: maps (161 << 16) | child -> (601 << 16) | child.
 * Built from the verified (desktopChild, mobileChild) pairs below.
 */
const MOBILE_COMPONENT_MAP: Record<number, number> = {};
const REVERSE_MAP: Record<number, number> = {};

/** Build (group << 16) | child quickly. */
const uid = (group: number, child: number) => (group << 16) | child;
for (const [desktopChild, mobileChild] of [
  [1, 4], [2, 5], [3, 6], [4, 9], [5, 13], [6, 12], [7, 8], [8, 14],
  [9, 15], [10, 16], [11, 10], [12, 11], [13, 17], [14, 18],
  [15, 26], [16, 27], [17, 28], [18, 29], [19, 30], [20, 24], [21, 25],
  [30, 34], [31, 35], [33, 37], [34, 20], [35, 131], [36, 133], [37, 132],
  [38, 113], [42, 70], [43, 74], [44, 76], [45, 75], [46, 44], [47, 77],
  [48, 72], [49, 73], [50, 81], [51, 83], [52, 82], [53, 45], [54, 84],
  [55, 79], [56, 80], [58, 96], [59, 101], [60, 71], [61, 102], [62, 97],
  [63, 98], [64, 99], [65, 100], [66, 108], [67, 78], [68, 109], [69, 104],
  [70, 105], [71, 106], [72, 107], [74, 114], [75, 115],
  [76, 116], [77, 117], [78, 118], [79, 119], [80, 120], [81, 121],
  [82, 122], [83, 123], [84, 124], [85, 125], [86, 126], [87, 127],
  [88, 128], [89, 129], [90, 130],
  [92, 3], [93, 21], [94, 23], [95, 22], [96, 49], [98, 134],
] as const) {
  const desktopUid = uid(DESKTOP_ROOT_GROUP, desktopChild);
  const mobileUid = uid(MOBILE_ROOT_GROUP, mobileChild);
  MOBILE_COMPONENT_MAP[desktopUid] = mobileUid;
  REVERSE_MAP[mobileUid] = desktopUid;
}

// Friendly component UIDs used across the server (desktop 161 coordinates).
export const DesktopUids = {
  MAINMODAL: uid(DESKTOP_ROOT_GROUP, 16),
  SIDEMODAL: uid(DESKTOP_ROOT_GROUP, 74),
  OVERLAY_HUD: uid(DESKTOP_ROOT_GROUP, 8),
  PVP_ICONS: uid(DESKTOP_ROOT_GROUP, 3),
  MAP_CONTAINER: uid(DESKTOP_ROOT_GROUP, 92),
  CHATBOX: uid(DESKTOP_ROOT_GROUP, 96),
  TAB_COMBAT: uid(DESKTOP_ROOT_GROUP, 76),
  TAB_PRAYER: uid(DESKTOP_ROOT_GROUP, 81),
  TAB_MAGIC: uid(DESKTOP_ROOT_GROUP, 82),
  TAB_INVENTORY: uid(DESKTOP_ROOT_GROUP, 79),
  TAB_SOCIAL: uid(DESKTOP_ROOT_GROUP, 85),
} as const;

/** True when the player logged in from the mobile layout (clientType 1). */
export function isMobileDisplay(player: any): boolean {
  return player?.getDisplayMode?.() === "mobile";
}

/**
 * Translate a desktop (161-root) component UID to the player's display mode.
 * Non-161 UIDs (modals like the welcome screen 378, chatbox modal 162:567, etc.)
 * are returned unchanged - they are display-mode independent.
 */
export function toDisplayUid(player: any, desktopUid: number): number {
  if (!isMobileDisplay(player)) return desktopUid;
  return MOBILE_COMPONENT_MAP[desktopUid] ?? desktopUid;
}

/** Reverse translation for incoming click UIDs: 601:x -> 161:x (identity otherwise). */
export function fromDisplayUid(player: any, uidValue: number): number {
  if (!isMobileDisplay(player)) return uidValue;
  if ((uidValue >>> 16) !== MOBILE_ROOT_GROUP) return uidValue;
  // Unmapped mobile-only component (hotkey strip, etc.) keeps the mobile UID so
  // generic handlers still see a stable value.
  return REVERSE_MAP[uidValue] ?? uidValue;
}

/** True if the player's root frame is the mobile toplevel. */
export function usesMobileRoot(player: any): boolean {
  return isMobileDisplay(player);
}
