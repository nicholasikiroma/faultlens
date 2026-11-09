import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { test, type TestContext } from "node:test";
import { INGEST_SIGNATURE_HEADER, MAX_INGEST_BODY_BYTES } from "#domain";
import { createSampleHost } from "../../../apps/sdk-example/src/server.ts";
import { verify } from "../../../apps/api/src/ingest/verify.ts";
import { validateEventSchema } from "../../../apps/api/src/ingest/schema.ts";
import { createWireSleuthClient, type DeliveryResult, type WireSleuthClientOptions } from "./index.ts";
import { createTransport } from "./transport.ts";

const apiKey = "wsk_test-key-not-a-provider-secret";
const signingSecret = "test-integration-signing-secret";
const raw = Buffer.from('{ "event_id": "evt-sdk", "type": "invoice.paid", "label": "café" }\n');
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
};
async function listen(t: TestContext, server: Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}
const clientFor = (baseUrl: string, options: Partial<WireSleuthClientOptions> = {}) =>
  createWireSleuthClient({ baseUrl, apiKey, ...options, webhooks: options.webhooks ?? { signingSecret } });

test("core needs no webhook secret and exposes only explicitly enabled capabilities", () => {
  const core = createWireSleuthClient({ baseUrl: "http://localhost", apiKey });
  assert.deepEqual(Object.keys(core), []);
  assert.equal(core.webhooks, undefined);
  assert.equal("captureWebhook" in core, false);
  const enabled = clientFor("http://localhost");
  assert.deepEqual(Object.keys(enabled), ["webhooks"]);
  assert.equal(typeof enabled.webhooks.capture, "function");
});

test("webhook capability posts exact snapshotted bytes with the API key and a compatible HMAC", { timeout: 5000 }, async (t) => {
  const received = deferred<void>();
  const server = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks);
      assert.equal(req.method, "POST");
      assert.equal(req.url, "/v1/ingest");
      assert.equal(req.headers.authorization, `Bearer ${apiKey}`);
      assert.equal(req.headers["content-type"], "application/json");
      assert.equal(req.headers.cookie, undefined);
      assert.deepEqual(body, raw);
      assert.equal(verify(body, { [INGEST_SIGNATURE_HEADER]: String(req.headers[INGEST_SIGNATURE_HEADER]) }, signingSecret), "VERIFIED");
      assert.equal(validateEventSchema(body).ok, true);
      res.writeHead(200).end("ignored response body");
    } finally { received.resolve(); }
  });
  const client = clientFor(await listen(t, server));
  const mutable = Buffer.from(raw);
  const delivery = client.webhooks.capture(mutable);
  mutable.fill(0);
  assert.deepEqual(await delivery, { outcome: "delivered", status: 200 });
  await received.promise;
});

test("HTTP refusals are returned as data without upstream body or secrets", { timeout: 5000 }, async (t) => {
  let status = 400;
  const client = clientFor(await listen(t, createServer((req, res) => {
    req.resume();
    res.writeHead(status).end(`${apiKey} ${signingSecret}`);
  })));
  for (status of [400, 401, 409, 413, 503]) {
    assert.deepEqual(await client.webhooks.capture(raw), { outcome: "failed", reason: "http", status });
  }
});

test("socket failures never reject", { timeout: 5000 }, async (t) => {
  const client = clientFor(await listen(t, createServer((req) => req.socket.destroy())));
  assert.deepEqual(await client.webhooks.capture(raw), { outcome: "failed", reason: "network" });
});

test("timeouts release capacity so later deliveries still work", { timeout: 5000 }, async (t) => {
  let respond = false;
  const client = clientFor(await listen(t, createServer((req, res) => {
    req.resume();
    if (respond) res.writeHead(200).end();
  })), { timeoutMs: 150, maxInFlight: 1 });
  assert.deepEqual(await client.webhooks.capture(raw), { outcome: "failed", reason: "timeout" });
  respond = true;
  assert.deepEqual(await client.webhooks.capture(raw), { outcome: "delivered", status: 200 });
});

test("concurrent deliveries beyond the client budget are dropped rather than queued", { timeout: 5000 }, async (t) => {
  const started = deferred<void>();
  let finish!: () => void;
  let calls = 0;
  const client = clientFor(await listen(t, createServer((req, res) => {
    req.resume();
    calls++;
    finish = () => res.writeHead(200).end();
    started.resolve();
  })), { maxInFlight: 1, timeoutMs: 2000 });
  const first = client.webhooks.capture(raw);
  await started.promise;
  assert.deepEqual(await client.webhooks.capture(raw), { outcome: "dropped", reason: "busy" });
  assert.equal(calls, 1);
  finish();
  assert.deepEqual(await first, { outcome: "delivered", status: 200 });
});

test("webhook body bounds reject oversized inputs locally and accept the exact limit", { timeout: 5000 }, async (t) => {
  let calls = 0;
  const client = clientFor(await listen(t, createServer((req, res) => {
    calls++;
    req.resume();
    req.on("end", () => res.end());
  })));
  assert.deepEqual(await client.webhooks.capture(new Uint8Array(MAX_INGEST_BODY_BYTES + 1)), { outcome: "dropped", reason: "oversized" });
  // @ts-expect-error JavaScript consumers can pass an invalid body at runtime.
  assert.deepEqual(await client.webhooks.capture("not raw bytes"), { outcome: "failed", reason: "invalid-input" });
  assert.equal(calls, 0);
  assert.deepEqual(await client.webhooks.capture(new Uint8Array(MAX_INGEST_BODY_BYTES)), { outcome: "delivered", status: 200 });
  assert.equal(calls, 1);
});

test("redirects never forward payloads or credentials to another endpoint", { timeout: 5000 }, async (t) => {
  const paths: string[] = [];
  const client = clientFor(await listen(t, createServer((req, res) => {
    req.resume();
    paths.push(req.url ?? "");
    res.writeHead(307, { location: "/collect-secrets" }).end();
  })));
  assert.deepEqual(await client.webhooks.capture(raw), { outcome: "failed", reason: "network" });
  assert.deepEqual(paths, ["/v1/ingest"]);
});

test("bad shared and webhook configuration is rejected without exposing credentials", () => {
  for (const baseUrl of ["ftp://localhost", "http://name:password@localhost", "http://localhost/api", "http://localhost?x=1", "http://localhost/#fragment"]) {
    assert.throws(() => clientFor(baseUrl));
  }
  for (const timeoutMs of [0, -1, NaN, Infinity, 1.5, 60001]) {
    assert.throws(() => clientFor("http://localhost", { timeoutMs }));
  }
  for (const maxInFlight of [0, -1, NaN, Infinity, 1.5, 1025]) {
    assert.throws(() => clientFor("http://localhost", { maxInFlight }));
  }
  assert.throws(() => clientFor("http://localhost", { apiKey: "" }));
  assert.throws(() => clientFor("http://localhost", { webhooks: { signingSecret: "" } }));
  assert.throws(() => clientFor(`not-a-url-${apiKey}-${signingSecret}`), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message.includes(apiKey), false);
    assert.equal(error.message.includes(signingSecret), false);
    return true;
  });
});

test("shared transport has no webhook dependency and rejects off-origin paths", { timeout: 5000 }, async (t) => {
  let calls = 0;
  const baseUrl = await listen(t, createServer((req, res) => { calls++; req.resume(); res.writeHead(204).end(); }));
  const transport = createTransport({ baseUrl, apiKey });
  assert.deepEqual(await transport.deliver(() => ({ path: "/internal-transport-test", body: new Uint8Array(), headers: {} })), { outcome: "delivered", status: 204 });
  assert.deepEqual(await transport.deliver(() => ({ path: "//other.example/collect", body: new Uint8Array(), headers: {} })), { outcome: "failed", reason: "invalid-input" });
  assert.equal(calls, 1);
});

test("sample host does not wait for telemetry to settle before responding", { timeout: 5000 }, async (t) => {
  const pending = deferred<DeliveryResult>();
  const called = deferred<void>();
  const url = await listen(t, createSampleHost({ capture: () => {
    called.resolve();
    return pending.promise;
  } }));
  try {
    const response = await fetch(`${url}/webhook`, { method: "POST", body: raw });
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { accepted: true });
    await called.promise;
  } finally {
    pending.resolve({ outcome: "failed", reason: "network" });
  }
});

for (const failure of ["http", "timeout"] as const) {
  test(`sample host returns its own response when telemetry fails (${failure})`, { timeout: 5000 }, async (t) => {
    const upstream = createServer((req, res) => {
      req.resume();
      if (failure === "http") res.writeHead(503).end();
    });
    const client = clientFor(await listen(t, upstream), { timeoutMs: 200 });
    const delivery = deferred<DeliveryResult>();
    const host = createSampleHost({ capture: async (body) => {
      const result = await client.webhooks.capture(body);
      delivery.resolve(result);
      return result;
    } });
    const url = await listen(t, host);
    const response = await fetch(`${url}/webhook`, { method: "POST", body: raw });
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { accepted: true });
    const result = await delivery.promise;
    assert.equal(result.outcome, "failed");
    if (result.outcome === "failed") assert.equal(result.reason, failure);
  });
}
