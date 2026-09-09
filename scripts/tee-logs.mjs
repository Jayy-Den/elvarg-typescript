/**
 * Tee a child process's stdout/stderr to the console and a timestamped log file.
 *
 * Usage: node scripts/tee-logs.mjs <label> <command> [...args]
 *
 * Logs are written to <repo>/logs/<label>-<YYYY-MM-DD-HH-MM-SS>.log (the logs/
 * directory is already git-ignored), so long-lived dev processes like the game
 * server stay inspectable after the fact.
 */
import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [label, ...command] = process.argv.slice(2);
if (!label || command.length === 0) {
  throw new Error("Usage: tee-logs.mjs <label> <command> [...args]");
}

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const logsDir = resolve(rootDir, "logs");
mkdirSync(logsDir, { recursive: true });

// Local time, Windows-safe (no colons): 2026-09-09-14-30-05
const now = new Date();
const pad = (n) => String(n).padStart(2, "0");
const timestamp = [
  now.getFullYear(),
  pad(now.getMonth() + 1),
  pad(now.getDate()),
  pad(now.getHours()),
  pad(now.getMinutes()),
  pad(now.getSeconds()),
].join("-");
const logPath = resolve(logsDir, `${label}-${timestamp}.log`);
const log = createWriteStream(logPath, { flags: "a" });

// Only spawn.exe-style commands (no shell) so args never need quoting.
const child = spawn(process.execPath, command, {
  stdio: ["inherit", "pipe", "pipe"],
});
console.log(`[tee] ${label} logging to ${logPath}`);

// Prefix each line with the source stream, and mirror to the log.
function pipeStream(stream, name) {
  let buffered = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buffered += chunk;
    let newlineIndex;
    while ((newlineIndex = buffered.indexOf("\n")) !== -1) {
      const line = buffered.slice(0, newlineIndex);
      buffered = buffered.slice(newlineIndex + 1);
      const prefixed = `[${label}][${name}] ${line}`;
      console.log(prefixed);
      log.write(`${prefixed}\n`);
    }
  });
  stream.on("end", () => {
    if (buffered.length > 0) {
      const prefixed = `[${label}][${name}] ${buffered}`;
      console.log(prefixed);
      log.write(`${prefixed}\n`);
      buffered = "";
    }
  });
}
pipeStream(child.stdout, "out");
pipeStream(child.stderr, "err");

child.on("exit", (code, signal) => {
  log.end(`[${label}] process exited with ${signal ? `signal ${signal}` : `code ${code}`}\n`, () => {
    process.exit(code ?? 1);
  });
});

child.on("error", (error) => {
  console.error(`[tee] failed to start ${label}:`, error.message);
  log.end(`[${label}] failed to start: ${error.message}\n`, () => process.exit(1));
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    child.kill(signal);
  });
}
