/**
 * Ported from the elvarg-web-client map editor. Pure geometry: given the tiles
 * a path covers, work out which overlay shape and rotation each tile needs so
 * corners and end caps read correctly.
 */

export interface PathTile {
    x: number;
    y: number;
}

export interface PathOverlayTile extends PathTile {
    overlayShape: number;
    overlayRotation: number;
}

const DIRECTIONS: ReadonlyArray<PathTile> = [
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: 0 },
    { x: 0, y: -1 },
];

const key = (x: number, y: number): string => `${x}:${y}`;

const cornerRotation = ([west, north, east]: boolean[]): number =>
    west ? (north ? 1 : 0) : north && east ? 2 : 3;

/** Bresenham line restricted to orthogonal steps, so paths never cut corners. */
export function createPathTiles(start: PathTile, end: PathTile): PathTile[] {
    const tiles: PathTile[] = [];
    let x = start.x;
    let y = start.y;
    const deltaX = Math.abs(end.x - x);
    const stepX = x < end.x ? 1 : -1;
    const deltaY = -Math.abs(end.y - y);
    const stepY = y < end.y ? 1 : -1;
    let error = deltaX + deltaY;

    // Bounded by the line length; a malformed input still terminates.
    for (;;) {
        tiles.push({ x, y });
        if (x === end.x && y === end.y) return tiles;

        const previousX = x;
        const previousY = y;
        const doubledError = error * 2;
        if (doubledError >= deltaY) {
            error += deltaY;
            x += stepX;
        }
        if (doubledError <= deltaX) {
            error += deltaX;
            y += stepY;
        }
        if (x !== previousX && y !== previousY) {
            tiles.push({ x, y: previousY });
        }
    }
}

/**
 * @param path every tile the path covers, as "x:y" keys
 * @param editable the tiles to emit overlays for (usually the same set)
 * @param inBounds guards the cap/boundary tiles the path bleeds into
 */
export function buildPathOverlays(
    path: ReadonlySet<string>,
    editable: ReadonlySet<string>,
    inBounds: (x: number, y: number) => boolean,
): PathOverlayTile[] {
    const result = new Map<string, PathOverlayTile>();

    for (const tileKey of Array.from(editable)) {
        const [x, y] = tileKey.split(":").map(Number);
        const neighbours = DIRECTIONS.map((direction) => path.has(key(x + direction.x, y + direction.y)));
        const connected = neighbours.flatMap((present, index) => (present ? [index] : []));
        const tile: PathOverlayTile = { x, y, overlayShape: 0, overlayRotation: 0 };

        if (connected.length === 2 && connected[0] % 2 !== connected[1] % 2) {
            const first = DIRECTIONS[connected[0]];
            const second = DIRECTIONS[connected[1]];
            const staircase =
                path.has(key(x + first.x - second.x, y + first.y - second.y)) ||
                path.has(key(x + second.x - first.x, y + second.y - first.y));
            if (!staircase) {
                tile.overlayShape = 5;
                tile.overlayRotation = cornerRotation(neighbours);
            }
        }
        result.set(tileKey, tile);

        if (connected.length === 1) {
            const [direction] = connected;
            const neighbour = DIRECTIONS[direction];
            const capX = x - neighbour.x;
            const capY = y - neighbour.y;
            if (inBounds(capX, capY) && !path.has(key(capX, capY))) {
                result.set(key(capX, capY), {
                    x: capX,
                    y: capY,
                    overlayShape: 11,
                    overlayRotation: [1, 2, 3, 0][direction],
                });
            }
        }
    }

    const boundary = new Set<string>();
    for (const tileKey of Array.from(editable)) {
        const [x, y] = tileKey.split(":").map(Number);
        for (const direction of DIRECTIONS) {
            const boundaryX = x + direction.x;
            const boundaryY = y + direction.y;
            const boundaryKey = key(boundaryX, boundaryY);
            if (
                inBounds(boundaryX, boundaryY) &&
                !path.has(boundaryKey) &&
                !result.has(boundaryKey)
            ) {
                boundary.add(boundaryKey);
            }
        }
    }

    for (const boundaryKey of Array.from(boundary)) {
        const [x, y] = boundaryKey.split(":").map(Number);
        const neighbours = DIRECTIONS.map((direction) => path.has(key(x + direction.x, y + direction.y)));
        const adjacent = neighbours.filter(Boolean).length;
        if (adjacent === 2 && !(neighbours[0] && neighbours[2]) && !(neighbours[1] && neighbours[3])) {
            result.set(boundaryKey, {
                x,
                y,
                overlayShape: 1,
                overlayRotation: cornerRotation(neighbours),
            });
        }
    }

    return Array.from(result.values());
}
