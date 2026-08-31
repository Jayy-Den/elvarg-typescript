import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const server = path.join(root, "server");
const output = path.join(root, "client", "public", "browser-host", "runtime.json");
const interfaceOutput = path.join(root, "client", "public", "browser-host", "interfaces");
const dist = path.join(server, "dist");
const browserExcludedPluginEntrypoints = new Set([
    "bots/StressTestBots.plugin.js",
    "commands/AdminCommands.plugin.js",
    "commands/PluginPerfCommand.plugin.js",
    "interface/DeveloperSetSkillLevel.plugin.js",
    "interface/ItemSpawner.plugin.js",
    "interface/VoiceChat.plugin.js",
    "persistence/SqlitePlayerPersistence.plugin.js",
    "world/ProceduralRegionStream.plugin.js",
]);
const expectedBrowserPluginEntrypoints = 62;
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
const packagedFiles = new Set();

function addFile(relativePath, contents) {
    const parts = relativePath.split("/");
    let directory = tree;
    for (const part of parts.slice(0, -1)) {
        directory[part] ??= { directory: {} };
        directory = directory[part].directory;
    }
    directory[parts.at(-1)] = { file: { contents } };
    packagedFiles.add(relativePath);
}

function addDirectory(source, destination) {
    for (const entry of fs.readdirSync(source, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const absolute = path.join(source, entry.name);
        const relative = `${destination}/${entry.name}`;
        if (entry.isDirectory()) addDirectory(absolute, relative);
        else if (!entry.name.endsWith(".map")) addFile(relative, fs.readFileSync(absolute, "utf8"));
    }
}

const browserPluginEntrypoints = [];

function addBrowserPlugins(source, relativeDirectory = "") {
    for (const entry of fs.readdirSync(source, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const absolute = path.join(source, entry.name);
        const relative = path.posix.join(relativeDirectory, entry.name);
        if (entry.isDirectory()) {
            if (relative !== "world") addBrowserPlugins(absolute, relative);
            continue;
        }
        if (!relative.endsWith(".js") && !relative.endsWith(".json")) continue;
        if (browserExcludedPluginEntrypoints.has(relative)) continue;
        addFile(`plugins/${relative}`, fs.readFileSync(absolute, "utf8"));
        if (relative.endsWith(".plugin.js")) browserPluginEntrypoints.push(relative);
    }
}

for (const name of browserExcludedPluginEntrypoints) {
    if (!fs.existsSync(path.join(server, "plugins", name))) {
        throw new Error(`Missing excluded browser plugin entrypoint ${name}`);
    }
}

addDirectory(dist, "dist");
addBrowserPlugins(path.join(server, "plugins"));
addDirectory(path.join(server, "data", "definitions"), "data/definitions");
for (const name of ["Bans.txt", "IPBans.txt", "IPMutes.txt", "Mutes.txt"]) {
    addFile(`data/saves/${name}`, fs.readFileSync(path.join(server, "data/saves", name), "utf8"));
}
addFile("data/plugins.json", fs.readFileSync(path.join(server, "data/plugins.json"), "utf8"));
addFile("target.txt", fs.readFileSync(path.join(server, "target.txt"), "utf8"));
addFile("package.json", `${JSON.stringify({ private: true, dependencies }, null, 2)}\n`);

if (browserPluginEntrypoints.length !== expectedBrowserPluginEntrypoints) {
    throw new Error(
        `Expected ${expectedBrowserPluginEntrypoints} browser plugin entrypoints, found ${browserPluginEntrypoints.length}`,
    );
}
for (const name of browserExcludedPluginEntrypoints) {
    if (packagedFiles.has(`plugins/${name}`)) {
        throw new Error(`Excluded browser plugin entrypoint was packaged: ${name}`);
    }
}
for (const name of [
    "plugins/bots/PlayerBots.plugin.js",
    "plugins/bots/behaviours/spawn/BotPlayerFactory.js",
    "plugins/bots/data/object-index.json",
    "plugins/combat/DragonfireProtection.js",
    "plugins/interface/PresetsState.js",
    "data/definitions/item-gameplay.json",
    "data/plugins.json",
    "data/definitions/npc_spawns.json",
]) {
    if (!packagedFiles.has(name)) throw new Error(`Browser runtime is missing ${name}`);
}

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify({
    version: 2,
    tree,
}));
const { buildPresetsInterfaceDefinition } = require("../server/plugins/interface/presetsWidget.js");
const presetsInterface = buildPresetsInterfaceDefinition();
fs.mkdirSync(interfaceOutput, { recursive: true });
fs.writeFileSync(
    path.join(interfaceOutput, `${presetsInterface.groupId}.json`),
    JSON.stringify(presetsInterface),
);
console.info(
    `[browser-host] wrote ${path.relative(root, output)} with ${browserPluginEntrypoints.length} plugins ` +
    `(${(fs.statSync(output).size / 1024 / 1024).toFixed(1)} MiB)`,
);
