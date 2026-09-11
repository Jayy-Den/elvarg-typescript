/**
 * Shop open smoke test: verifies the chat -> command -> ShopManager.open ->
 * SHOP_OPEN packet chain end-to-end over the real WebSocket protocol.
 *
 * Usage: npm run test:shop
 *
 * Flow:
 *   1. Log in exactly like login-smoke.ts.
 *   2. Send a CHAT (190) client packet carrying "::shop 7".
 *   3. Expect either:
 *        - SHOP_OPEN (150) for shop id "7" with a non-empty stock (allow path,
 *          requires the account to have developer rights, e.g. CI sets
 *          DEV_USERNAME=smoketest), or
 *        - a CHAT_MESSAGE (120) denying permission (deny path; still proves
 *          chat routing, command parsing, and the rights gate respond).
 *
 * Environment overrides: HOST WEBSOCKET_PORT SMOKE_USERNAME SMOKE_PASSWORD
 * REVISION TIMEOUT_MS (same defaults as login-smoke.ts).
 */
import { WebSocket } from "ws";
import * as fs from "fs";
import * as path from "path";
import { NetworkConstants } from "../src/main/typescript/elvarg/net/NetworkConstants";
import {
  ServerPacketId,
  SERVER_PACKET_LENGTHS,
} from "../src/main/typescript/elvarg/net/protocol/ServerPackets";

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
const TIMEOUT_MS = parseEnvInt("TIMEOUT_MS", 30000);
const SHOP_COMMAND = process.env.SHOP_SMOKE_COMMAND ?? "::shop 7";
const EXPECTED_SHOP_ID = "7";

const LOGIN_OPCODE = 204;
const LOGOUT_OPCODE = 203;
const HANDSHAKE_OPCODE = 202;

function parseTargetRevision(target: string): number {
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
  return Buffer.concat([
    Buffer.from([LOGIN_OPCODE, payload.length >> 8, payload.length & 0xff]),
    payload,
  ]);
}

/** CHAT client packet: opcode 190, byte length prefix, message-type byte + null-terminated text. */
function buildChatPacket(text: string): Buffer {
  const payload = Buffer.concat([
    Buffer.from([0]), // messageType "public"
    Buffer.from(text, "latin1"),
    Buffer.from([0]),
  ]);
  return Buffer.concat([Buffer.from([190, payload.length]), payload]);
}

/**
 * HANDSHAKE client packet: opcode 202, byte length prefix, name string +
 * appearance flag (0 = default) + clientType byte. The server only enters the
 * world (registers the player, sends the gameframe bootstrap) after this.
 */
function buildHandshakePacket(username: string): Buffer {
  const payload = Buffer.concat([
    Buffer.from(username, "latin1"),
    Buffer.from([0]), // name terminator
    Buffer.from([0]), // hasAppearance = false
    Buffer.from([0]), // clientType
  ]);
  return Buffer.concat([Buffer.from([HANDSHAKE_OPCODE, payload.length]), payload]);
}

/** Splits the server stream into packets using the server's own wire-length table. */
function* parseServerPackets(buffer: Buffer): Generator<{ opcode: number; payload: Buffer; consumed: number }> {
  let offset = 0;
  while (offset < buffer.length) {
    const opcode = buffer[offset];
    const expected = SERVER_PACKET_LENGTHS[opcode as ServerPacketId];
    if (expected === undefined) {
      if (process.env.SHOP_SMOKE_DEBUG) {
        console.log(`[debug] unknown opcode ${opcode}; skipping 1 byte`);
        offset += 1;
        continue;
      }
      throw new Error(`Unknown server opcode ${opcode} at offset ${offset}`);
    }
    const header = expected >= 0 ? 1 : expected === -1 ? 2 : 3;
    if (offset + header > buffer.length) return;
    const length = expected >= 0
      ? expected
      : expected === -1
        ? buffer[offset + 1]
        : buffer.readUInt16BE(offset + 1);
    const end = offset + header + length;
    if (end > buffer.length) return;
    yield { opcode, payload: buffer.subarray(offset + header, end), consumed: end };
    offset = end;
  }
}

function readNullTerminated(data: Buffer, offset: number): { value: string; end: number } {
  const terminator = data.indexOf(0, offset);
  if (terminator === -1) throw new Error("Unterminated string in server packet");
  return { value: data.toString("latin1", offset, terminator), end: terminator + 1 };
}

/** SHOP_OPEN payload: shopId string, name string, u16 currency, u8 general, u8 buy, u8 sell, u16 stockCount. */
function decodeShopOpen(payload: Buffer): { shopId: string; name: string; stockCount: number } {
  let offset = 0;
  const id = readNullTerminated(payload, offset);
  offset = id.end;
  const name = readNullTerminated(payload, offset);
  offset = name.end;
  const stockCount = payload.readUInt16BE(offset + 5); // header: u16 currency, u8 general, u8 buy, u8 sell, u16 count
  return { shopId: id.value, name: name.value, stockCount };
}

function decodeChatMessage(payload: Buffer): string {
  // Server encodeChatMessage: string(text), [type byte], string(from), string(prefix), u16 id.
  return readNullTerminated(payload, 0).value;
}

async function main(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`ws://${HOST}:${PORT}`);
    ws.binaryType = "arraybuffer";
    let stream = Buffer.alloc(0);
    let loggedIn = false;
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      ws.close();
      reject(new Error(`Timed out after ${TIMEOUT_MS}ms (loggedIn=${loggedIn})`));
    }, TIMEOUT_MS);

    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      ws.close();
      reject(new Error(message));
    };

    const succeed = (message: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      console.log(message);
      ws.send(Buffer.from([LOGOUT_OPCODE]));
      ws.close();
      resolve();
    };

    ws.onopen = () => {
      ws.send(buildLoginPacket(USERNAME, PASSWORD, REVISION));
    };

    ws.onmessage = (ev) => {
      const chunk = Buffer.isBuffer(ev.data) ? ev.data : Buffer.from(ev.data as ArrayBuffer);
      stream = Buffer.concat([stream, chunk]);
      for (const { opcode, payload, consumed } of parseServerPackets(stream)) {
        stream = stream.subarray(consumed);
        if (process.env.SHOP_SMOKE_DEBUG) console.log(`[debug] opcode=${opcode} len=${payload.length}`);
        if (opcode === ServerPacketId.WELCOME) continue;
        if (opcode === ServerPacketId.LOGIN_RESPONSE) {
          if (payload[0] !== 1) {
            fail(`Login failed with error code ${payload.readInt32BE(1)}`);
            return;
          }
          loggedIn = true;
          // Complete the two-stage login: the server enters the world only
          // once the client sends HANDSHAKE.
          setTimeout(() => {
            if (!settled) ws.send(buildHandshakePacket(USERNAME));
          }, 500);
          // Let the post-login burst (region, players, varps) flow, then issue
          // the command.
          setTimeout(() => {
            if (!settled) ws.send(buildChatPacket(SHOP_COMMAND));
          }, 2500);
          continue;
        }
        if (opcode === ServerPacketId.SHOP_OPEN) {
          try {
            const shop = decodeShopOpen(payload);
            if (shop.shopId !== EXPECTED_SHOP_ID) {
              fail(`SHOP_OPEN for shop ${shop.shopId}, expected ${EXPECTED_SHOP_ID}`);
              return;
            }
            if (shop.stockCount <= 0) {
              fail(`SHOP_OPEN for shop ${shop.shopId} arrived with empty stock`);
              return;
            }
            succeed(
              `Shop smoke test: SUCCESS (SHOP_OPEN shop=${shop.shopId} "${shop.name}" ` +
                `stock=${shop.stockCount} user=${USERNAME})`,
            );
            return;
          } catch (error) {
            fail(`Failed to decode SHOP_OPEN: ${error}`);
            return;
          }
        }
        if (opcode === ServerPacketId.CHAT_MESSAGE) {
          const text = decodeChatMessage(payload);
          if (/do not have permission|cannot use/i.test(text)) {
            succeed(
              "Shop smoke test: SUCCESS (deny path - chat routing and command parsing " +
                "respond; re-run with DEV_USERNAME set to exercise the open path)",
            );
            return;
          }
          continue;
        }
      }
    };

    ws.onerror = (err) => {
      const cause = (err as unknown as { error?: unknown }).error;
      fail(cause instanceof Error ? cause.message : "WebSocket error");
    };
    ws.onclose = () => {
      if (!settled) fail(`Connection closed (loggedIn=${loggedIn}) before the shop response arrived`);
    };
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
