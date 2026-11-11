import assert from "node:assert/strict";
import { createServer } from "node:http";
import { afterEach, beforeEach, test } from "node:test";
import { Hono } from "hono";
import { headerPairs, optionalInstant, readCommand, type ApiEnv } from "./request.ts";
import { JSON_BODY_LIMIT } from "./routes.ts";
import { closeServer, createApiApp } from "./server.ts";

const envKeys = ["WIRESLEUTH_ADMIN_TOKEN", "WIRESLEUTH_WORKSPACE_ID", "WIRESLEUTH_SIMULATED_WEBHOOKS"] as const;
let saved: (string | undefined)[];
beforeEach(() => {
  saved = envKeys.map((key) => process.env[key]);
  process.env["WIRESLEUTH_ADMIN_TOKEN"] = "transport-test-secret";
  process.env["WIRESLEUTH_WORKSPACE_ID"] = "workspace-1";
  delete process.env["WIRESLEUTH_SIMULATED_WEBHOOKS"];
});
afterEach(() => {
  envKeys.forEach((key, index) => {
    if (saved[index] === undefined) delete process.env[key];
    else process.env[key] = saved[index];
  });
});
const auth = { authorization: "Bearer transport-test-secret", "content-type": "application/json" };

// Exercises body parsing without invoking an application service or database.
function commandApp() {
  const app = new Hono<ApiEnv>();
  app.put("/", async (c) => {
    const result = await readCommand(c, headerPairs(c));
    if (!result.ok) return result.response;
    assert.equal(Object.getPrototypeOf(result.value), Object.prototype);
    return c.json({ keys: Object.keys(result.value), inheritedStatus: result.value["status"] ?? null });
  });
  return app;
}

test("JSON parsing preserves __proto__ as an own property", async () => {
  const response = await commandApp().request("/", {
    method: "PUT", headers: auth, body: '{"__proto__":{"status":"OPEN"}}',
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { keys: ["__proto__"], inheritedStatus: null });
});

test("commands reject malformed JSON and non-object roots", async () => {
  for (const body of ["{", "[]", "null", '"text"', "42"]) {
    const response = await commandApp().request("/", { method: "PUT", headers: auth, body });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "invalid_request", field: "$" });
  }
});

test("command bodies accept the exact byte limit and reject one byte over", async () => {
  const exact = JSON.stringify({ note: "x".repeat(JSON_BODY_LIMIT - 11) });
  assert.equal(Buffer.byteLength(exact), JSON_BODY_LIMIT);
  for (const [body, status] of [[exact, 200], [exact + " ", 413]] as const) {
    const response = await commandApp().request("/", { method: "PUT", headers: auth, body });
    assert.equal(response.status, status);
  }
  const response = await commandApp().request("/", {
    method: "PUT", headers: { "content-type": "text/plain" }, body: exact,
  });
  assert.equal(response.status, 415);
});

test("oversized streamed commands cancel the reader", async () => {
  let cancelled = false;
  const body = new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(JSON_BODY_LIMIT + 2)); },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  const init: RequestInit & { duplex: string } = { method: "PUT", headers: auth, body, duplex: "half" };
  const response = await commandApp().request(new Request("http://localhost/", init));
  assert.equal(response.status, 413);
  assert.equal(cancelled, true);
});

test("instants require valid calendar dates and an explicit timezone", () => {
  for (const value of ["0", "2026-02-30T00:00:00Z", "2025-02-29T00:00:00Z", "1900-02-29T00:00:00Z", "2026-11-08", "2026-11-08T10:00:00", "2026-01-01T24:00:00Z", "2026-01-01T00:00:00+24:00", " 2026-01-01T00:00:00Z", "2026-13-01T00:00:00Z"]) {
    assert.deepEqual(optionalInstant(new URLSearchParams({ from: value }), "from"), { ok: false, field: "from" }, value);
  }
  for (const value of ["2024-02-29T00:00:00Z", "2000-02-29T00:00:00Z", "2026-11-08T10:00:00.123Z", "2026-11-08T12:00:00+02:00"]) {
    const parsed = optionalInstant(new URLSearchParams({ from: value }), "from");
    assert.ok(parsed.ok, value);
    assert.equal(parsed.value?.getTime(), Date.parse(value));
  }
});

test("actual write routes reject prototype keys, missing fields, and spoofed identity before calling services", async () => {
  const app = createApiApp();
  for (const [path, field, value] of [
    ["/v1/incidents/id/status", "status", "OPEN"],
    ["/v1/findings/id/feedback", "rating", "USEFUL"],
  ]) {
    for (const [body, expectedField] of [
      [`{"__proto__":{"${field}":"${value}"}}`, "__proto__"],
      ["{}", field],
      [JSON.stringify({ [field]: value, actor: "spoofed" }), "actor"],
      [JSON.stringify({ [field]: value, workspaceId: "other" }), "workspaceId"],
    ]) {
      const response = await app.request(path, { method: "PUT", headers: auth, body });
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: "invalid_request", field: expectedField });
    }
  }
});

test("unauthorized writes do not read the body", async () => {
  let reads = 0;
  const body = new ReadableStream({ pull() { reads++; throw new Error("body must not be read"); } }, { highWaterMark: 0 });
  const init: RequestInit & { duplex: string } = { method: "PUT", body, duplex: "half" };
  const response = await createApiApp().request(new Request("http://localhost/v1/incidents/id/status", init));
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("www-authenticate"), "Bearer");
  assert.equal(reads, 0);
  await body.cancel();
});

test("unknown paths and disabled hooks are 404; known paths return 405 with Allow", async () => {
  const app = createApiApp();
  for (const path of ["/missing", "/hooks/token"]) {
    assert.equal((await app.request(path)).status, 404);
  }
  for (const [path, allow] of [["/v1/events", "GET"], ["/v1/findings/id/feedback", "PUT, GET"]]) {
    const response = await app.request(path, { method: "POST" });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), allow);
  }
  assert.equal((await app.request("/v1/events", { method: "HEAD" })).status, 405);
});

test("invalid query values and duplicate keys are rejected without database access", async () => {
  const app = createApiApp();
  for (const query of ["from=0", "limit=1&limit=2", "workspaceId=other", "limit=101", "from=2026-02-30T00:00:00Z"]) {
    assert.equal((await app.request(`/v1/events?${query}`, { headers: auth })).status, 400);
  }
});

test("graceful shutdown allows an active HTTP response to complete", { timeout: 5000 }, async () => {
  let finish!: () => void;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  const server = createServer((_req, res) => {
    finish = () => res.end("completed");
    started();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const response = fetch(`http://127.0.0.1:${address.port}`);
  try {
    await ready;
    const closing = closeServer(server, 1000);
    finish();
    assert.equal(await (await response).text(), "completed");
    await closing;
  } finally {
    server.closeAllConnections();
    if (server.listening) await closeServer(server, 0);
  }
});

test("shutdown force-closes requests after the grace period", { timeout: 5000 }, async () => {
  let started!: () => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  const server = createServer(() => started());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  // Attach the rejection handler immediately so forced disconnects cannot become unhandled.
  const disconnected = assert.rejects(fetch(`http://127.0.0.1:${address.port}`));
  try {
    await ready;
    await closeServer(server, 20);
    await disconnected;
  } finally {
    server.closeAllConnections();
    if (server.listening) await closeServer(server, 0);
  }
});

test("CORS preflight and cross-origin headers allow local dashboard requests", async () => {
  const app = createApiApp();
  const preflight = await app.request("/v1/events", {
    method: "OPTIONS",
    headers: {
      Origin: "http://localhost:5173",
      "Access-Control-Request-Method": "GET",
      "Access-Control-Request-Headers": "Authorization, Content-Type",
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "http://localhost:5173");
  assert.ok(preflight.headers.get("access-control-allow-methods")?.includes("GET"));

  const unauth = await app.request("/v1/events", {
    method: "GET",
    headers: {
      Origin: "http://localhost:5173",
    },
  });
  assert.equal(unauth.status, 401);
  assert.equal(unauth.headers.get("access-control-allow-origin"), "http://localhost:5173");
});
