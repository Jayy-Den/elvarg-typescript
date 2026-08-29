/**
 * The editor runs in the client window that /host opened, so exported region
 * packs travel back to the host tab over postMessage. The host writes them into
 * the WebContainer's `data/regions`, which RegionManager loads on startup.
 */
export const REGION_PACK_MESSAGE = "elvarg:region-pack";

export type RegionPackMessage = {
    type: typeof REGION_PACK_MESSAGE;
    regionId: number;
    data: Uint8Array;
};
