import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const server = path.join(root, "server");
const output = path.join(root, "client", "public", "browser-host", "runtime.json");
const dist = path.join(server, "dist");
const worldSourcePath = path.join(
    server,
    "src/main/typescript/elvarg/game/World.ts",
);
const definitionFiles = [
    "interface_layouts.json",
    "monsters-complete.json",
    "music-data.json",
    "npc-animations.json",
    "npc-combat-defs.json",
    "npc_drops.json",
    "npc_interactions.json",
    "object_spawns.json",
    "shops.json",
];
const runtimeDependencies = [
    "adm-zip",
    "async-lock",
    "async-mutex",
    "big-integer",
    "bzip2",
    "decimal-format",
    "fs-extra",
    "gson",
    "gzip-js",
    "hashmap",
    "js-joda",
    "pako",
    "reflect-metadata",
    "require-all",
    "securerandom",
    "socket.io-client",
    "ws",
];

if (!fs.existsSync(path.join(dist, "Server.js"))) {
    throw new Error("server/dist is missing; run `yarn browser-host:prepare`");
}

const serverPackage = JSON.parse(fs.readFileSync(path.join(server, "package.json"), "utf8"));
const dependencies = Object.fromEntries(
    runtimeDependencies.map((name) => {
        const version = serverPackage.dependencies[name];
        if (!version) throw new Error(`Missing server dependency ${name}`);
        return [name, version];
    }),
);
const tree = {};

function addFile(relativePath, contents) {
    const parts = relativePath.split("/");
    let directory = tree;
    for (const part of parts.slice(0, -1)) {
        directory[part] ??= { directory: {} };
        directory = directory[part].directory;
    }
    directory[parts.at(-1)] = { file: { contents } };
}

function addDirectory(source, destination) {
    for (const entry of fs.readdirSync(source, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const absolute = path.join(source, entry.name);
        const relative = `${destination}/${entry.name}`;
        if (entry.isDirectory()) addDirectory(absolute, relative);
        else if (!entry.name.endsWith(".map")) addFile(relative, fs.readFileSync(absolute, "utf8"));
    }
}

addDirectory(dist, "dist");
for (const name of definitionFiles) {
    addFile(`data/definitions/${name}`, fs.readFileSync(path.join(server, "data/definitions", name), "utf8"));
}
for (const name of ["Bans.txt", "IPBans.txt", "IPMutes.txt", "Mutes.txt"]) {
    addFile(`data/saves/${name}`, fs.readFileSync(path.join(server, "data/saves", name), "utf8"));
}
addFile("target.txt", fs.readFileSync(path.join(server, "target.txt"), "utf8"));
addFile("package.json", `${JSON.stringify({ private: true, dependencies }, null, 2)}\n`);

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify({
    version: 1,
    worldSource: fs.readFileSync(worldSourcePath, "utf8"),
    tree,
}));
console.info(`[browser-host] wrote ${path.relative(root, output)} (${(fs.statSync(output).size / 1024 / 1024).toFixed(1)} MiB)`);
