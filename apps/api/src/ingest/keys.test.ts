import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { after, afterEach, test } from "node:test";
import { db } from "#db";
import { createApiApp } from "../http/server.ts";
import { ingest, ingestSimulated } from "./ingest.ts";
import { createIngestKey, hashIngestKey, revokeIngestKey, rotateIngestKey } from "./keys.ts";
import { SIGNATURE_HEADER } from "./verify.ts";

const fixtures: string[] = [];
afterEach(async () => {
  for (const id of fixtures.splice(0)) {
    await db.execute(db.raw.sql`DELETE FROM outbox WHERE attempt_id IN (SELECT id FROM delivery_attempts WHERE integration_id = ${id})`.affectedCount().build());
    await db.execute(db.raw.sql`DELETE FROM delivery_attempts WHERE integration_id = ${id}`.affectedCount().build());
    await db.execute(db.raw.sql`DELETE FROM webhook_events WHERE integration_id = ${id}`.affectedCount().build());
    await db.execute(db.raw.sql`DELETE FROM integrations WHERE id = ${id}`.affectedCount().build());
  }
});
after(async () => { await db.close(); });

async function fixture() {
  const id = randomUUID();
  const workspaceId = `keys-test-${id}`;
  const token = `simulation-${id}`;
  const secret = `signing-${id}`;
  await db.orm.public.Integration.create({ id, workspaceId, endpointToken: token,
    signingSecret: secret, environment: "production", endpoint: "/test" });
  fixtures.push(id);
  const issued = await createIngestKey({ workspaceId, integrationId: id });
  assert.equal(issued.outcome, "created");
  if (issued.outcome !== "created") throw new Error("expected a key");
  const rawBody = Buffer.from(JSON.stringify({ event_id: `evt-${id}`, type: "test.event",
    occurred_at: "2026-11-08T10:00:00Z", workspaceId: "spoofed", environment: "other" }));
  const headers = { [SIGNATURE_HEADER]: createHmac("sha256", secret).update(rawBody).digest("hex") };
  return { id, workspaceId, token, secret, issued, rawBody, headers };
}

async function assertEmpty(integrationId: string) {
  assert.equal((await db.orm.public.WebhookEvent.where({ integrationId }).all()).length, 0);
  assert.equal((await db.orm.public.DeliveryAttempt.where({ integrationId }).all()).length, 0);
}

test("creation persists only a hash; a valid HTTP key stores one event, attempt, and outbox row", async () => {
  const f = await fixture();
  assert.match(f.issued.key, /^wsk_[A-Za-z0-9_-]{43}$/);
  const stored = await db.orm.public.IngestKey.where({ id: f.issued.id }).first();
  assert.equal(stored?.keyHash, hashIngestKey(f.issued.key));
  assert.equal(JSON.stringify(stored).includes(f.issued.key), false);
  const response = await createApiApp().request("/v1/ingest", { method: "POST",
    headers: { ...f.headers, authorization: `Bearer ${f.issued.key}` }, body: f.rawBody.toString() });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.outcome, "stored");
  assert.equal((await db.orm.public.WebhookEvent.where({ integrationId: f.id }).all()).length, 1);
  const attempt = await db.orm.public.DeliveryAttempt.where({ integrationId: f.id }).first();
  assert.ok(attempt);
  assert.equal(attempt.workspaceId, f.workspaceId);
  assert.equal((await db.orm.public.Outbox.where({ attemptId: attempt.id }).all()).length, 1);
  const event = await db.orm.public.WebhookEvent.where({ id: body.eventId }).first();
  assert.equal(event?.workspaceId, f.workspaceId);
  assert.equal(JSON.stringify(body).includes(f.issued.key), false);
  assert.equal(JSON.stringify(body).includes(f.secret), false);
});

test("revocation is idempotent and a revoked key writes no event or attempt", async () => {
  const f = await fixture();
  assert.deepEqual(await revokeIngestKey({ workspaceId: f.workspaceId, keyId: f.issued.id }), { outcome: "revoked" });
  assert.deepEqual(await revokeIngestKey({ workspaceId: f.workspaceId, keyId: f.issued.id }), { outcome: "unchanged" });
  const response = await createApiApp().request("/v1/ingest", { method: "POST",
    headers: { ...f.headers, authorization: `Bearer ${f.issued.key}` }, body: f.rawBody.toString() });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { outcome: "unknown-token" });
  await assertEmpty(f.id);
});

test("rotation atomically revokes the old key and issues a usable replacement", async () => {
  const f = await fixture();
  const rotated = await rotateIngestKey({ workspaceId: f.workspaceId, keyId: f.issued.id });
  assert.equal(rotated.outcome, "rotated");
  if (rotated.outcome !== "rotated") return;
  assert.notEqual(rotated.key, f.issued.key);
  assert.equal(rotated.environment, "production");
  assert.deepEqual(await ingest({ token: f.issued.key, rawBody: f.rawBody, headers: f.headers }), { outcome: "unknown-token" });
  await assertEmpty(f.id);
  assert.equal((await ingest({ token: rotated.key, rawBody: f.rawBody, headers: f.headers })).outcome, "stored");
  assert.deepEqual(await rotateIngestKey({ workspaceId: f.workspaceId, keyId: f.issued.id }), { outcome: "missing" });
});

test("key management cannot cross workspace boundaries", async () => {
  const f = await fixture();
  const workspaceId = "another-workspace";
  assert.deepEqual(await createIngestKey({ workspaceId, integrationId: f.id }), { outcome: "missing" });
  assert.deepEqual(await revokeIngestKey({ workspaceId, keyId: f.issued.id }), { outcome: "missing" });
  assert.deepEqual(await rotateIngestKey({ workspaceId, keyId: f.issued.id }), { outcome: "missing" });
  assert.equal((await db.orm.public.IngestKey.where({ id: f.issued.id }).first())?.revokedAt, null);
});

test("keys fail closed if integration workspace or environment no longer matches", async () => {
  const f = await fixture();
  await db.orm.public.Integration.where({ id: f.id }).update({ environment: "staging" });
  assert.deepEqual(await ingest({ token: f.issued.key, rawBody: f.rawBody, headers: f.headers }), { outcome: "unknown-token" });
  await db.orm.public.Integration.where({ id: f.id }).update({ environment: "production", workspaceId: "moved" });
  assert.deepEqual(await ingest({ token: f.issued.key, rawBody: f.rawBody, headers: f.headers }), { outcome: "unknown-token" });
  await assertEmpty(f.id);
});

test("production never falls back to a simulation token; simulated ingest remains explicit", async () => {
  const f = await fixture();
  assert.deepEqual(await ingest({ token: f.token, rawBody: f.rawBody, headers: f.headers }), { outcome: "unknown-token" });
  assert.deepEqual(await ingestSimulated({ token: f.issued.key, rawBody: f.rawBody, headers: f.headers }), { outcome: "unknown-token" });
  await assertEmpty(f.id);
  assert.equal((await ingestSimulated({ token: f.token, rawBody: f.rawBody, headers: f.headers })).outcome, "stored");
});
