import assert from "assert";
import { appendTerminalLog } from "../browserHost/terminalLog";

let lines = appendTerminalLog([], "\r\\");
lines = appendTerminalLog(lines, "\r|");
lines = appendTerminalLog(lines, "\r/");
lines = appendTerminalLog(lines, "\r-");
assert.deepStrictEqual(lines, ["-"]);
assert.deepStrictEqual(appendTerminalLog(lines, "npm warn deprecated example\n"), ["-", "npm warn deprecated example"]);
console.log("browser host terminal log passed");
