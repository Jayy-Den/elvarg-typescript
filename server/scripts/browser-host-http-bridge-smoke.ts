import { strict as assert } from "assert";
import { createServer } from "http";
import { Script } from "vm";
import {
  BROWSER_HOST_BRIDGE_HTML,
  BrowserHostHttpBridge,
  BrowserHostHttpChannel,
} from "../src/main/typescript/elvarg/net/BrowserHostHttpBridge";

async function main(): Promise<void> {
  const inlineScript = BROWSER_HOST_BRIDGE_HTML.match(/<script>([\s\S]*)<\/script>/)?.[1];
  assert.ok(inlineScript);
  new Script(inlineScript);

  let channel: BrowserHostHttpChannel | undefined;
  const bridge = new BrowserHostHttpBridge((accepted) => {
    channel = accepted as BrowserHostHttpChannel;
    channel.send(Buffer.from([1, 2]));
  });
  const server = createServer((request, response) => {
    if (!bridge.handle(request, response)) {
      response.statusCode = 404;
      response.end();
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const created = await fetch(`${base}/browser-host/session`, { method: "POST" });
    assert.equal(created.status, 200);
    const id = await created.text();
    assert.match(id, /^[0-9a-f-]+$/);
    assert.ok(channel?.isOpen());

    channel.send(Buffer.from([3, 4]));
    const polled = await fetch(`${base}/browser-host/session/${id}/poll`);
    assert.equal(polled.status, 200);
    assert.deepEqual([...new Uint8Array(await polled.arrayBuffer())], [1, 2, 3, 4]);

    let received: Buffer | undefined;
    channel.onData((data) => { received = data; });
    const sent = await fetch(`${base}/browser-host/session/${id}/send`, {
      method: "POST",
      body: Uint8Array.from([5, 6]),
    });
    assert.equal(sent.status, 204);
    assert.deepEqual([...(received ?? Buffer.alloc(0))], [5, 6]);

    const oversized = new BrowserHostHttpChannel();
    oversized.send(Buffer.alloc(4097));
    assert.equal(oversized.isOpen(), false);

    const closed = await fetch(`${base}/browser-host/session/${id}`, { method: "DELETE" });
    assert.equal(closed.status, 204);
    assert.equal(channel.isOpen(), false);

    const closingSession = await fetch(`${base}/browser-host/session`, { method: "POST" });
    const closingId = await closingSession.text();
    assert.ok(channel?.isOpen());
    channel.send(Buffer.from([7, 8]));
    channel.close();
    const terminalData = await fetch(`${base}/browser-host/session/${closingId}/poll`);
    assert.deepEqual([...new Uint8Array(await terminalData.arrayBuffer())], [1, 2, 7, 8]);
    const terminalClose = await fetch(`${base}/browser-host/session/${closingId}/poll`);
    assert.equal(terminalClose.status, 410);
    console.log("browser host HTTP bridge: ok");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

void main();
