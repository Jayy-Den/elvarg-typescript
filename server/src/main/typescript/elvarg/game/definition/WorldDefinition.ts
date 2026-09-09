import * as fs from "fs";
import * as path from "path";
import { Boundary } from "../model/Boundary";
import { Location } from "../model/Location";

export type WorldZoneTag = "pvp" | "multi-combat";

export interface WorldPosition {
    x: number;
    y: number;
    z: number;
}

/**
 * Bounds are absent on the fallback zone, whose tags apply to the whole world on every
 * plane: a fallback tagged "pvp" makes the world pvp, and narrower zones add nothing.
 */
export interface WorldZone {
    minX?: number;
    maxX?: number;
    minY?: number;
    maxY?: number;
    z?: number;
    tags: WorldZoneTag[];
}

export interface WorldDefinitionData {
    spawn: WorldPosition;
    zones: WorldZone[];
    disabledPlugins: string[];
    experienceMultiplier: number;
}

export class WorldDefinitionValidationError extends Error {}

type JsonObject = Record<string, unknown>;

const WORLD_FILE = path.resolve("data/definitions/world.json");

function object(value: unknown, label: string): JsonObject {
    if (!value || Array.isArray(value) || typeof value !== "object") {
        throw new WorldDefinitionValidationError(`${label} must be an object`);
    }
    return value as JsonObject;
}

function integer(source: JsonObject, key: string, label: string): number {
    const value = source[key];
    if (typeof value !== "number" || !Number.isInteger(value)) {
        throw new WorldDefinitionValidationError(`${label}.${key} must be an integer`);
    }
    return value;
}

function positiveNumber(source: JsonObject, key: string, label: string): number {
    const value = source[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
        throw new WorldDefinitionValidationError(`${label}.${key} must be a positive number`);
    }
    return value;
}

function coordinate(source: JsonObject, key: string, label: string): number {
    const value = integer(source, key, label);
    if (value < 0 || value > 0x3fff) {
        throw new WorldDefinitionValidationError(`${label}.${key} is outside the world`);
    }
    return value;
}

function plane(source: JsonObject, label: string): number {
    const value = integer(source, "z", label);
    if (value < 0 || value > 3) {
        throw new WorldDefinitionValidationError(`${label}.z must be between 0 and 3`);
    }
    return value;
}

export function parseWorldPosition(value: unknown, label = "world spawn"): WorldPosition {
    const position = object(value, label);
    return {
        x: coordinate(position, "x", label),
        y: coordinate(position, "y", label),
        z: plane(position, label),
    };
}

const ZONE_BOUND_KEYS = ["minX", "maxX", "minY", "maxY", "z"] as const;

export function parseWorldZone(value: unknown, label = "world zone"): WorldZone {
    const zone = object(value, label);
    // No bounds at all is the fallback zone; a partial set still has to name them all.
    const bounded = ZONE_BOUND_KEYS.some((key) => zone[key] !== undefined);
    const parsed: WorldZone = bounded
        ? {
              minX: coordinate(zone, "minX", label),
              maxX: coordinate(zone, "maxX", label),
              minY: coordinate(zone, "minY", label),
              maxY: coordinate(zone, "maxY", label),
              z: plane(zone, label),
              tags: [],
          }
        : { tags: [] };
    if (bounded && (parsed.minX! > parsed.maxX! || parsed.minY! > parsed.maxY!)) {
        throw new WorldDefinitionValidationError(`${label} has reversed bounds`);
    }
    if (!Array.isArray(zone.tags)) {
        throw new WorldDefinitionValidationError(`${label}.tags must be an array`);
    }
    // The fallback zone is allowed to carry no tags: world.json ships one so the setting
    // is visible. A bounded zone with no tags is still a mistake - it does nothing.
    if (bounded && zone.tags.length === 0) {
        throw new WorldDefinitionValidationError(`${label}.tags must be a non-empty array`);
    }
    for (const tag of new Set(zone.tags)) {
        if (tag !== "pvp" && tag !== "multi-combat") {
            throw new WorldDefinitionValidationError(
                `${label} has unsupported tag: ${String(tag)}`
            );
        }
        parsed.tags.push(tag);
    }
    return parsed;
}

export function parseWorldDefinition(value: unknown): WorldDefinitionData {
    const world = object(value, "world.json");
    if (!Array.isArray(world.zones)) {
        throw new WorldDefinitionValidationError("world.json zones must be an array");
    }
    if (!Array.isArray(world.disabledPlugins) || world.disabledPlugins.some(
        (pluginName) => typeof pluginName !== "string" || pluginName.trim().length === 0
    )) {
        throw new WorldDefinitionValidationError("world.json disabledPlugins must be a string[]");
    }
    const experienceMultiplier = world.experienceMultiplier === undefined
        ? 1
        : positiveNumber(world, "experienceMultiplier", "world.json");
    return {
        spawn: parseWorldPosition(world.spawn, "world.json spawn"),
        zones: world.zones.map((zone, index) =>
            parseWorldZone(zone, `world.json zones[${index}]`)
        ),
        disabledPlugins: world.disabledPlugins.map((pluginName) => pluginName.trim()),
        experienceMultiplier,
    };
}

let definition = parseWorldDefinition(
    JSON.parse(fs.readFileSync(WORLD_FILE, "utf8"))
);

export const WORLD_SPAWN = new Location(
    definition.spawn.x,
    definition.spawn.y,
    definition.spawn.z
);

export const WORLD_ZONE_BOUNDARIES: Record<WorldZoneTag, Boundary[]> = {
    pvp: [],
    "multi-combat": [],
};

const WORLD_EDGE = 0x3fff;
const PLANES = [0, 1, 2, 3];

/** The fallback zone has no rectangle, so it becomes one covering every plane. */
function zoneBoundaries(zone: WorldZone): Boundary[] {
    const { minX, maxX, minY, maxY, z } = zone;
    if (minX === undefined || maxX === undefined || minY === undefined || maxY === undefined || z === undefined) {
        return PLANES.map((plane) => new Boundary(0, WORLD_EDGE, 0, WORLD_EDGE, plane));
    }
    return [new Boundary(minX, maxX, minY, maxY, z)];
}

function syncRuntime(): void {
    WORLD_SPAWN.set(definition.spawn.x, definition.spawn.y, definition.spawn.z);
    WORLD_ZONE_BOUNDARIES.pvp.length = 0;
    WORLD_ZONE_BOUNDARIES["multi-combat"].length = 0;
    for (const zone of definition.zones) {
        const boundaries = zoneBoundaries(zone);
        for (const tag of zone.tags) WORLD_ZONE_BOUNDARIES[tag].push(...boundaries);
    }
}

function copyWorldDefinition(): WorldDefinitionData {
    return {
        spawn: { ...definition.spawn },
        zones: definition.zones.map((zone) => ({ ...zone, tags: [...zone.tags] })),
        disabledPlugins: [...definition.disabledPlugins],
        experienceMultiplier: definition.experienceMultiplier,
    };
}

function saveWorldDefinition(value: unknown): WorldDefinitionData {
    const next = parseWorldDefinition(value);
    const temporary = `${WORLD_FILE}.tmp`;
    try {
        fs.writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, "utf8");
        fs.renameSync(temporary, WORLD_FILE);
    } catch (error) {
        fs.rmSync(temporary, { force: true });
        throw error;
    }
    definition = next;
    syncRuntime();
    return copyWorldDefinition();
}

export function getWorldDefinition(): WorldDefinitionData {
    return copyWorldDefinition();
}

export function setWorldSpawn(value: unknown): WorldPosition {
    const spawn = parseWorldPosition(value);
    return saveWorldDefinition({ ...definition, spawn }).spawn;
}

export function addWorldZone(value: unknown): { index: number; zone: WorldZone } {
    const zone = parseWorldZone(value);
    const saved = saveWorldDefinition({
        ...definition,
        zones: [...definition.zones, zone],
    });
    const index = saved.zones.length - 1;
    return { index, zone: saved.zones[index] };
}

export function setWorldZone(index: number, value: unknown): WorldZone {
    if (!Number.isInteger(index) || index < 0 || index >= definition.zones.length) {
        throw new RangeError(`World zone ${String(index)} was not found`);
    }
    const zones = [...definition.zones];
    zones[index] = parseWorldZone(value);
    return saveWorldDefinition({ ...definition, zones }).zones[index];
}

export function deleteWorldZone(index: number): WorldZone {
    if (!Number.isInteger(index) || index < 0 || index >= definition.zones.length) {
        throw new RangeError(`World zone ${String(index)} was not found`);
    }
    const zones = [...definition.zones];
    const [removed] = zones.splice(index, 1);
    saveWorldDefinition({ ...definition, zones });
    return removed;
}

syncRuntime();
