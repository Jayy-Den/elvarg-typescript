/**
 * Minimal smoke test client to ensure the login flow stays stable.
 *
 * Usage: npm run test:login
 *
 * It connects to the game server's WebSocket endpoint
 * (ws://127.0.0.1:43594 by default), performs the same login as the web
 * client (LOGIN opcode 204 carrying username/password/revision), and asserts
 * that a successful LOGIN_RESPONSE (3) is received.
 *
 * Environment overrides:
 *   HOST=127.0.0.1 WEBSOCKET_PORT=43594 SMOKE_USERNAME=smoketest
 *   SMOKE_PASSWORD=smoketest REVISION=237 TIMEOUT_MS=15000
 *
 * The cache revision defaults to the value parsed from target.txt, matching
 * what the server validates logins against.
 */
import { WebSocket } from "ws";
import * as fs from "fs";
import * as path from "path";
import { NetworkConstants } from "../src/main/typescript/elvarg/net/NetworkConstants";

const parseEnvInt = (key: string, fallback: number): number => {
  const raw = process.env[key];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
};

const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = parseEnvInt("WEBSOCKET_PORT", NetworkConstants.WEBSOCKET_PORT);
const USERNAME = process.env.SMOKE_USERNAME ?? "smoketest";
const PASSWORD = process.env.SMOKE_PASSWORD ?? "smoketest";
const TIMEOUT_MS = parseEnvInt("TIMEOUT_MS", 15000);

// Client opcodes (see src/main/typescript/elvarg/net/protocol/ClientPackets.ts)
const LOGIN_OPCODE = 204;
const LOGOUT_OPCODE = 203;
// Server opcodes (see src/main/typescript/elvarg/net/protocol/ServerPackets.ts)
const WELCOME_OPCODE = 0;
const LOGIN_RESPONSE_OPCODE = 3;
const LOGOUT_RESPONSE_OPCODE = 4;
// Wire lengths from SERVER_PACKET_LENGTHS: >= 0 fixed (no length byte on the
// wire), -1 = one length byte, -2 = two length bytes.
const SERVER_PACKET_WIRE_LENGTHS: Record<number, number> = {
  [WELCOME_OPCODE]: 8,
  [LOGIN_RESPONSE_OPCODE]: -1,
  [LOGOUT_RESPONSE_OPCODE]: -1,
};

function parseTargetRevision(target: string): number {
  // Same "osrs-{revision}_{date}" format as CachePipeline.parseCacheTarget.
  const match = /^osrs-(\d+)_/.exec(target);
  if (!match) throw new Error(`Invalid cache target "${target}"; expected osrs-{revision}_{date}`);
  return Number(match[1]);
}

const REVISION = parseEnvInt(
  "REVISION",
  parseTargetRevision(fs.readFileSync(path.join(__dirname, "..", "target.txt"), "utf8").trim()),
);

function writeString(buf: Buffer[], s: string) {
  buf.push(Buffer.from(s, "latin1"), Buffer.from([0]));
}

function buildLoginPacket(username: string, password: string, revision: number): Buffer {
  const payloadParts: Buffer[] = [];
  writeString(payloadParts, username);
  writeString(payloadParts, password);
  const revisionBuf = Buffer.alloc(4);
  revisionBuf.writeInt32BE(revision | 0, 0);
  payloadParts.push(revisionBuf);
  const payload = Buffer.concat(payloadParts);
  // LOGIN is variable-length with a 2-byte (u16 BE) length field
  // (see CLIENT_PACKET_LENGTHS in ClientPackets.ts: -2 = short length).
  return Buffer.concat([
    Buffer.from([LOGIN_OPCODE, payload.length >> 8, payload.length & 0xff]),
    payload,
  ]);
}

/**
 * Splits a stream buffer into complete server packets. Fixed-length packets
 * carry only opcode + payload; variable-length ones (e.g. LOGIN_RESPONSE)
 * prefix their payload with a single length byte.
 */
function* parseServerPackets(buffer: Buffer): Generator<{ opcode: number; payload: Buffer; consumed: number }> {
  let offset = 0;
  while (offset < buffer.length) {
    const opcode = buffer[offset];
    const expected = SERVER_PACKET_WIRE_LENGTHS[opcode];
    if (expected === undefined) {
      console.warn(
        `login-smoke: unexpected server opcode ${opcode} at offset ${offset};` +
          ` bytes: ${buffer.subarray(offset, offset + 32).toString("hex")}`,
      );
      return;
    }
    const header = expected >= 0 ? 1 : expected === -1 ? 2 : 3;
    if (offset + header > buffer.length) return;
    const length = expected >= 0 ? expected : expected === -1 ? buffer[offset + 1] : buffer.readUInt16BE(offset + 1);
    const end = offset + header + length;
    if (end > buffer.length) return;
    yield { opcode, payload: buffer.subarray(offset + header, end), consumed: end };
    offset = end;
  }
}

function readNullTerminated(data: Buffer, offset: number): { value: string; end: number } {
  const terminator = data.indexOf(0, offset);
  if (terminator === -1) throw new Error("Unterminated string in login response");
  return { value: data.toString("latin1", offset, terminator), end: terminator + 1 };
}

async function main(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`ws://${HOST}:${PORT}`);
    ws.binaryType = "arraybuffer";
    let stream = Buffer.alloc(0);
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      ws.close();
      reject(new Error(`Timed out after ${TIMEOUT_MS}ms waiting for login response`));
    }, TIMEOUT_MS);

    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      ws.close();
      reject(new Error(message));
    };

    ws.onopen = () => {
      ws.send(buildLoginPacket(USERNAME, PASSWORD, REVISION));
    };

    ws.onmessage = (ev) => {
      const chunk = Buffer.isBuffer(ev.data) ? ev.data : Buffer.from(ev.data as ArrayBuffer);
      stream = Buffer.concat([stream, chunk]);
      for (const { opcode, payload, consumed } of parseServerPackets(stream)) {
        stream = stream.subarray(consumed);
        if (opcode === WELCOME_OPCODE) continue;
        if (opcode === LOGIN_RESPONSE_OPCODE) {
          const success = payload[0] === 1;
          const errorCode = payload.readInt32BE(1);
          const error = readNullTerminated(payload, 5);
          const displayName = readNullTerminated(payload, error.end);
          if (!success) {
            fail(`Login smoke test failed, error code ${errorCode}: ${error.value}`);
            return;
          }
          clearTimeout(timeout);
          settled = true;
          console.log(
            `Login smoke test: SUCCESS (user=${displayName.value || USERNAME} revision=${REVISION} port=${PORT})`,
          );
          // LOGOUT is a fixed-length (0 payload) client packet: single byte.
          ws.send(Buffer.from([LOGOUT_OPCODE]));
          ws.close();
          resolve();
          return;
        }
      }
    };

    ws.onerror = (err) => {
      // ws wraps the underlying Error inside the event object.
      const cause = (err as unknown as { error?: unknown }).error;
      const message = cause instanceof Error ? cause.message : err instanceof Error ? err.message : "WebSocket error";
      fail(message);
    };
    ws.onclose = () => {
      fail("Connection closed before a login response was received");
    };
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
