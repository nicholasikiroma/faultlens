import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { connect } from 'node:net';
import { after, before, beforeEach, test } from 'node:test';
import { db } from '#db';
import { config } from '../config.ts';
import { MAX_BODY_BYTES } from '../ingest/ingest.ts';
import { hashIngestKey } from '../ingest/keys.ts';
import { SIGNATURE_HEADER } from '../ingest/verify.ts';
import { ensureProductSchema } from '../seed/seed.ts';
import { startApiServer } from './server.ts';

before(async () => {
  await ensureProductSchema();
});

const ADMIN = 'test-admin-token-secret-value';
const WORKSPACE = 'workspace-1';
const TOKEN = 'demo-token';
const SECRET = 'simulator-secret';

beforeEach(() => {
  process.env['FAULTLENS_ADMIN_TOKEN'] = ADMIN;
  process.env['FAULTLENS_WORKSPACE_ID'] = WORKSPACE;
  process.env['FAULTLENS_ADMIN_ACTOR'] = 'local-admin';
  delete process.env['FAULTLENS_SIMULATED_WEBHOOKS'];
});

after(async () => {
  await db.close();
});

test('a tokened GET /v1/events returns one page, and the next page does not repeat it', async () => {
  await reset();
  const integrationId = await seedIntegration(WORKSPACE, TOKEN, SECRET);
  const otherIntegrationId = await seedIntegration('workspace-2', 'other-token', 'other-secret');
  const earlier = '00000000-0000-4000-8000-00000000000a';
  const later = '00000000-0000-4000-8000-00000000000b';
  const outsider = '00000000-0000-4000-8000-00000000000c';
  await seedEvent(earlier, integrationId, WORKSPACE, '2026-11-08T10:00:00.000Z');
  await seedEvent(outsider, otherIntegrationId, 'workspace-2', '2026-11-08T10:02:00.000Z');
  await seedEvent(later, integrationId, WORKSPACE, '2026-11-08T10:05:00.000Z');

  const server = await startApiServer({ port: 0, host: '127.0.0.1' });
  try {
    const first = await fetch(`${server.url}/v1/events?limit=1`, { headers: auth() });
    assert.equal(first.status, 200);
    const pageOne = await readPage(first);
    assert.equal(pageOne.items.length, 1);
    assert.equal(pageOne.items[0]?.id, earlier);
    assert.equal(pageOne.nextCursor, earlier);

    const second = await fetch(
      `${server.url}/v1/events?limit=1&cursor=${encodeURIComponent(pageOne.nextCursor ?? '')}`,
      { headers: auth() },
    );
    assert.equal(second.status, 200);
    const pageTwo = await readPage(second);
    assert.deepEqual(
      pageTwo.items.map((item) => item.id),
      [later],
    );
    assert.equal(pageTwo.nextCursor, null);

    const backwards = await fetch(
      `${server.url}/v1/events?from=2026-11-09T00:00:00.000Z&to=2026-11-08T00:00:00.000Z`,
      { headers: auth() },
    );
    assert.equal(backwards.status, 400);
    const clash = await fetch(
      `${server.url}/v1/events?errorClass=AUTH_FAILURE&failureClass=RATE_LIMIT`,
      { headers: auth() },
    );
    assert.equal(clash.status, 400);
    const repeated = await fetch(`${server.url}/v1/events?limit=1&limit=2`, { headers: auth() });
    assert.equal(repeated.status, 400);
  } finally {
    await server.close();
  }
});

test('GET /v1/events without a token or with the wrong token is unauthorized', async () => {
  await reset();
  const server = await startApiServer({ port: 0, host: '127.0.0.1' });
  try {
    const missing = await fetch(`${server.url}/v1/events`);
    assert.equal(missing.status, 401);
    assert.equal(missing.headers.get('www-authenticate'), 'Bearer');
    assert.deepEqual(await missing.json(), { kind: 'unauthorized', error: 'unauthorized' });

    const wrong = await fetch(`${server.url}/v1/events`, {
      headers: { authorization: 'Bearer wrong-token' },
    });
    assert.equal(wrong.status, 401);
    assert.deepEqual(await wrong.json(), { kind: 'unauthorized', error: 'unauthorized' });
  } finally {
    await server.close();
  }
});

test('an admin route refuses workspaceId in the query', async () => {
  await reset();
  const server = await startApiServer({ port: 0, host: '127.0.0.1' });
  try {
    const response = await fetch(`${server.url}/v1/events?workspaceId=other`, { headers: auth() });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'invalid_request', field: 'workspaceId' });
  } finally {
    await server.close();
  }
});

test('POST /v1/ingest stores a signed event, rejects a bad signature, and refuses an oversized body', async () => {
  await reset();
  await seedIntegration(WORKSPACE, TOKEN, SECRET);
  const server = await startApiServer({ port: 0, host: '127.0.0.1' });
  try {
    const rawBody = eventBody('evt-http-stored');
    const stored = await fetch(`${server.url}/v1/ingest`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${TOKEN}`,
        [SIGNATURE_HEADER]: signature(rawBody, SECRET),
        'content-type': 'application/json',
      },
      body: bodyOf(rawBody),
    });
    assert.equal(stored.status, 200);
    const storedBody = await stored.json();
    assert.equal(outcomeOf(storedBody), 'stored');
    assert.equal(typeof storedBody.eventId, 'string');
    assert.equal(typeof storedBody.attemptId, 'string');
    const attempt = await db.orm.public.DeliveryAttempt.where({ id: storedBody.attemptId }).first();
    assert.equal(attempt?.httpStatus, 200);

    const rejectedBody = eventBody('evt-http-rejected');
    const rejected = await fetch(`${server.url}/v1/ingest`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'content-type': 'application/json',
      },
      body: bodyOf(rejectedBody),
    });
    assert.equal(rejected.status, 401);
    assert.equal(outcomeOf(await rejected.json()), 'rejected');

    const before = (await db.orm.public.WebhookEvent.all()).length;
    const oversizedBody = new Uint8Array(MAX_BODY_BYTES + 1);
    oversizedBody.fill('x'.charCodeAt(0));
    const oversized = await fetch(`${server.url}/v1/ingest`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${TOKEN}`,
        [SIGNATURE_HEADER]: signature(oversizedBody, SECRET),
        'content-type': 'application/json',
      },
      body: bodyOf(oversizedBody),
    });
    assert.equal(oversized.status, 413);
    assert.equal(outcomeOf(await oversized.json()), 'oversized');
    assert.equal((await db.orm.public.WebhookEvent.all()).length, before);
  } finally {
    await server.close();
  }
});

test('duplicate signature headers keep the first value', async () => {
  await reset();
  await seedIntegration(WORKSPACE, TOKEN, SECRET);
  const rawBody = eventBody('evt-http-first-signature');
  const server = await startApiServer({ port: 0, host: '127.0.0.1' });
  try {
    const response = await postRaw(server.url, [
      'POST /v1/ingest HTTP/1.1',
      `Host: ${new URL(server.url).host}`,
      `Authorization: Bearer ${TOKEN}`,
      `${SIGNATURE_HEADER}: ${signature(rawBody, SECRET)}`,
      `${SIGNATURE_HEADER}: ${'ab'.repeat(32)}`,
      'Content-Type: application/json',
      `Content-Length: ${rawBody.byteLength}`,
      '',
      '',
    ], rawBody);
    assert.equal(response.status, 200);
    assert.equal(outcomeOf(response.body), 'stored');
  } finally {
    await server.close();
  }
});

test('POST /hooks/:token is 404 unless simulated webhooks are enabled', async () => {
  await reset();
  await seedIntegration(WORKSPACE, TOKEN, SECRET);
  const rawBody = eventBody('evt-http-simulated');
  const hookInit = (): RequestInit => ({
    method: 'POST',
    headers: {
      [SIGNATURE_HEADER]: signature(rawBody, SECRET),
      'content-type': 'application/json',
    },
    body: bodyOf(rawBody),
  });

  const unset = await startApiServer({ port: 0, host: '127.0.0.1' });
  try {
    const response = await fetch(`${unset.url}/hooks/${TOKEN}`, hookInit());
    assert.equal(response.status, 404);
  } finally {
    await unset.close();
  }
  assert.equal((await db.orm.public.WebhookEvent.all()).length, 0);

  process.env['FAULTLENS_SIMULATED_WEBHOOKS'] = '0';
  const zero = await startApiServer({ port: 0, host: '127.0.0.1' });
  try {
    const response = await fetch(`${zero.url}/hooks/${TOKEN}`, hookInit());
    assert.equal(response.status, 404);
  } finally {
    await zero.close();
  }

  process.env['FAULTLENS_SIMULATED_WEBHOOKS'] = '1';
  const enabled = await startApiServer({ port: 0, host: '127.0.0.1' });
  try {
    const response = await fetch(`${enabled.url}/hooks/${TOKEN}`, hookInit());
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(outcomeOf(body), 'stored');
    const event = await db.orm.public.WebhookEvent.where({ id: body.eventId }).first();
    assert.equal(event?.workspaceId, WORKSPACE);
  } finally {
    await enabled.close();
  }
});

test('admin reads and writes run over HTTP', async () => {
  await reset();
  const signingSecret = 'do-not-leak-signing-secret';
  const integrationId = await seedIntegration(WORKSPACE, TOKEN, signingSecret);
  const eventId = randomUUID();
  const incidentId = randomUUID();
  const findingId = randomUUID();
  const now = new Date('2026-11-08T10:00:00.000Z');
  await seedEvent(eventId, integrationId, WORKSPACE, now.toISOString());
  await db.orm.public.DeliveryAttempt.create({
    id: randomUUID(),
    eventId,
    integrationId,
    receivedAt: now,
    httpStatus: 200,
    durationMs: null,
    senderWaitMs: null,
    verificationState: 'VERIFIED',
    handlerState: 'PENDING',
    errorCode: null,
    correlationId: randomUUID(),
    workspaceId: WORKSPACE,
  });
  await db.orm.public.Incident.create({
    id: incidentId,
    workspaceId: WORKSPACE,
    fingerprint: `fp-${incidentId}`,
    integrationId,
    environment: 'production',
    failureClass: 'AUTH_FAILURE',
    endpoint: '/hooks/billing',
    ruleVersion: '0',
    status: 'OPEN',
    firstSeenAt: now,
    lastSeenAt: now,
    eventCount: 1,
  });
  await db.orm.public.IncidentEvent.create({
    incidentId,
    eventId,
    linkedAt: now,
  });
  await db.orm.public.Finding.create({
    id: findingId,
    incidentId,
    eventId,
    ruleId: 'auth-failure',
    ruleVersion: '0',
    failureClass: 'AUTH_FAILURE',
    explanation: 'Authentication failed.',
    certainty: 'observed',
    workspaceId: WORKSPACE,
  });

  const server = await startApiServer({ port: 0, host: '127.0.0.1' });
  try {
    const attempts = await fetch(`${server.url}/v1/events/${eventId}/attempts`, { headers: auth() });
    assert.equal(attempts.status, 200);
    const attemptPage = await attempts.json();
    assert.equal(attemptPage.kind, 'ok');
    assert.equal(attemptPage.items.length, 1);
    assert.equal(attemptPage.items[0]?.eventId, eventId);

    const incidents = await fetch(`${server.url}/v1/incidents`, { headers: auth() });
    assert.equal(incidents.status, 200);
    const incidentPage = await incidents.json();
    assert.equal(incidentPage.kind, 'ok');
    assert.equal(
      incidentPage.items.some((item: { id: string }) => item.id === incidentId),
      true,
    );

    const exported = await fetch(`${server.url}/v1/incidents/${incidentId}/export`, { headers: auth() });
    assert.equal(exported.status, 200);
    const exportText = await exported.text();
    assert.equal(exportText.includes(signingSecret), false);
    const exportBody = JSON.parse(exportText) as { kind: string; incident: { id: string } };
    assert.equal(exportBody.kind, 'ok');
    assert.equal(exportBody.incident.id, incidentId);

    const spoofed = await fetch(`${server.url}/v1/incidents/${incidentId}/status`, {
      method: 'PUT',
      headers: { ...auth(), 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'INVESTIGATING', actor: 'ada' }),
    });
    assert.equal(spoofed.status, 400);

    const plain = await fetch(`${server.url}/v1/incidents/${incidentId}/status`, {
      method: 'PUT',
      headers: auth(),
      body: JSON.stringify({ status: 'INVESTIGATING' }),
    });
    assert.equal(plain.status, 415);

    const moved = await fetch(`${server.url}/v1/incidents/${incidentId}/status`, {
      method: 'PUT',
      headers: { ...auth(), 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'INVESTIGATING' }),
    });
    assert.equal(moved.status, 200);
    assert.deepEqual(await moved.json(), {
      outcome: 'transitioned',
      previousStatus: 'OPEN',
      status: 'INVESTIGATING',
    });

    const again = await fetch(`${server.url}/v1/incidents/${incidentId}/status`, {
      method: 'PUT',
      headers: { ...auth(), 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'INVESTIGATING' }),
    });
    assert.equal(again.status, 200);
    const unchanged = await again.json();
    assert.equal(unchanged.outcome, 'unchanged');

    const rated = await fetch(`${server.url}/v1/findings/${findingId}/feedback`, {
      method: 'PUT',
      headers: { ...auth(), 'content-type': 'application/json' },
      body: JSON.stringify({ rating: 'USEFUL', note: 'Matched the attempt.' }),
    });
    assert.equal(rated.status, 201);
    const rating = await rated.json();
    assert.equal(rating.outcome, 'rated');
    assert.equal(rating.feedback.actor, config.adminActor);
    assert.equal(rating.feedback.rating, 'USEFUL');

    const ratings = await fetch(`${server.url}/v1/findings/${findingId}/feedback`, { headers: auth() });
    assert.equal(ratings.status, 200);
    const ratingPage = await ratings.json();
    assert.equal(ratingPage.kind, 'ok');
    assert.equal(ratingPage.items.length, 1);
    assert.equal(ratingPage.items[0]?.rating, 'USEFUL');

    const trail = await fetch(
      `${server.url}/v1/audit-events?objectType=INCIDENT&objectId=${encodeURIComponent(incidentId)}`,
      { headers: auth() },
    );
    assert.equal(trail.status, 200);
    const audit = await trail.json();
    assert.equal(audit.kind, 'ok');
    assert.equal(audit.items.length, 1);
    assert.equal(audit.items[0]?.action, 'INCIDENT_STATUS_CHANGED');
    assert.equal(audit.items[0]?.actor, 'local-admin');
  } finally {
    await server.close();
  }
});

test('episode ingest, agent settings, investigate disabled/list, and hypothesis feedback work over HTTP', async () => {
  await reset();
  await seedIntegration('workspace-1', 'ep-key-1', 'ep-secret-1');
  const incidentId = randomUUID();
  const runId = randomUUID();
  const hypothesisId = randomUUID();
  const now = new Date('2026-11-17T12:00:00.000Z');

  await db.orm.public.Incident.create({
    id: incidentId,
    workspaceId: 'workspace-1',
    fingerprint: 'fp-http-agent',
    integrationId: 'int-http-1',
    environment: 'production',
    failureClass: 'RATE_LIMIT',
    endpoint: '/hooks/billing',
    ruleVersion: '0',
    status: 'OPEN',
    firstSeenAt: now,
    lastSeenAt: now,
    eventCount: 1,
  });
  await db.orm.public.InvestigationRun.create({
    id: runId,
    workspaceId: 'workspace-1',
    incidentId,
    eventId: null,
    mode: 'AI_ASSISTED',
    state: 'COMPLETED',
    triggeredBy: 'local-admin',
    triggerReason: 'manual',
    modelId: 'mock-v1',
    promptVersion: '1.0.0',
    rulesetVersion: '0',
    toolCallCount: 1,
    startedAt: now,
    endedAt: now,
  });
  await db.orm.public.Hypothesis.create({
    id: hypothesisId,
    workspaceId: 'workspace-1',
    incidentId,
    investigationRunId: runId,
    title: 'HTTP rate limit hypothesis',
    reasoning: 'Attempt returned 429',
    epistemicStatus: 'OBSERVED',
    confidence: 'HIGH',
    citedEvidenceIds: [],
    missingInformation: [],
    suggestedCheck: 'Check Retry-After',
    remediationJson: null,
    feedback: 'UNVERIFIED',
    createdAt: now,
  });

  const server = await startApiServer({ host: '127.0.0.1', port: 0 });
  const prevAi = process.env['FAULTLENS_AI_ENABLED'];
  process.env['FAULTLENS_AI_ENABLED'] = '0';
  try {
    const epRes = await fetch(`${server.url}/v1/ingest/episodes`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer ep-key-1',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        episodeId: 'ep_http_1',
        framework: 'node-http',
        method: 'POST',
        rawUrl: '/hooks/billing',
        headers: {},
        statusCode: 500,
        verification: { state: 'VERIFIED', recordedAtMs: Date.now() },
        encryption: { scheme: 'NONE', authenticatesSender: false, decryptedOk: true },
        identity: { provider: 'stripe', eventId: 'evt_ep_http_1' },
        idempotency: { handlerIdempotent: true, committedSideEffect: false },
        downstreamCalls: [],
        exceptions: [],
        socket: {
          ingressReceivedAtMs: Date.now() - 20,
          finishFired: true,
          closeFired: false,
          writableEndedAtClose: false,
          headersSentAtClose: false,
          handlerSettled: true,
          committedAfterAbort: false,
          eventLoopMaxLagMs: 0,
          activeCpuBlockMs: 0,
        },
        bodyTap: { totalBytesSeen: 2, tappedBytes: 2, truncatedByCap: false, wireBodyHmac: 'h' },
        isDuplicateDelivery: false,
        isOutOfOrderDelivery: false,
        sealed: true,
      }),
    });
    assert.equal(epRes.status, 200);
    const epBody = (await epRes.json()) as { outcome: string };
    assert.equal(epBody.outcome, 'stored');

    const settingsRes = await fetch(`${server.url}/v1/settings/agent`, { headers: auth() });
    assert.equal(settingsRes.status, 200);
    const settingsBody = (await settingsRes.json()) as { kind: string; enabled: boolean };
    assert.equal(settingsBody.kind, 'ok');
    assert.equal(settingsBody.enabled, false);

    const disabledTrig = await fetch(`${server.url}/v1/incidents/${incidentId}/investigate`, {
      method: 'POST',
      headers: auth(),
    });
    assert.equal(disabledTrig.status, 503);

    const invList = await fetch(`${server.url}/v1/incidents/${incidentId}/investigations`, {
      headers: auth(),
    });
    assert.equal(invList.status, 200);
    const invBody = (await invList.json()) as { kind: string; hypotheses: unknown[]; runs: unknown[] };
    assert.equal(invBody.kind, 'ok');
    assert.equal(invBody.runs.length, 1);
    assert.equal(invBody.hypotheses.length, 1);

    const rateRes = await fetch(`${server.url}/v1/hypotheses/${hypothesisId}/feedback`, {
      method: 'PUT',
      headers: { ...auth(), 'content-type': 'application/json' },
      body: JSON.stringify({ rating: 'USEFUL' }),
    });
    assert.equal(rateRes.status, 200);
    const rateBody = (await rateRes.json()) as { outcome: string; hypothesis: { feedback: string } };
    assert.equal(rateBody.outcome, 'rated');
    assert.equal(rateBody.hypothesis.feedback, 'USEFUL');

    const askDisabled = await fetch(`${server.url}/v1/incidents/${incidentId}/ask`, {
      method: 'POST',
      headers: { ...auth(), 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'Why did this fail?' }),
    });
    assert.equal(askDisabled.status, 503);

    const questionsRes = await fetch(`${server.url}/v1/incidents/${incidentId}/questions`, {
      headers: auth(),
    });
    assert.equal(questionsRes.status, 200);
    const questionsBody = (await questionsRes.json()) as { kind: string; items: unknown[] };
    assert.equal(questionsBody.kind, 'ok');
    assert.equal(questionsBody.items.length, 0);

    const evalRes = await fetch(`${server.url}/v1/evaluations/summary`, {
      headers: auth(),
    });
    assert.equal(evalRes.status, 200);
    const evalBody = (await evalRes.json()) as {
      kind: string;
      totals: { totalRuns: number; usefulHypotheses: number };
    };
    assert.equal(evalBody.kind, 'ok');
    assert.equal(evalBody.totals.totalRuns, 1);
    assert.equal(evalBody.totals.usefulHypotheses, 1);
  } finally {
    if (prevAi === undefined) delete process.env['FAULTLENS_AI_ENABLED'];
    else process.env['FAULTLENS_AI_ENABLED'] = prevAi;
    await server.close();
  }
});

function postRaw(
  url: string,
  lines: readonly string[],
  rawBody: Uint8Array,
): Promise<{ status: number; body: unknown }> {
  const target = new URL(url);
  const head = lines.join('\r\n');
  return new Promise((resolve, reject) => {
    const socket = connect(Number(target.port), target.hostname);
    const chunks: Buffer[] = [];
    let settled = false;
    const finish = (status: number, body: unknown) => {
      if (settled) return;
      settled = true;
      socket.end();
      resolve({ status, body });
    };
    socket.on('connect', () => {
      socket.write(head);
      socket.write(rawBody);
    });
    socket.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString('utf8');
      const headerEnd = raw.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      const header = raw.slice(0, headerEnd);
      const lengthMatch = /content-length: (\d+)/i.exec(header);
      if (lengthMatch === null) return;
      const bodyText = raw.slice(headerEnd + 4);
      if (Buffer.byteLength(bodyText) < Number(lengthMatch[1])) return;
      const statusMatch = /^HTTP\/1\.1 (\d+)/.exec(header);
      finish(Number(statusMatch?.[1]), JSON.parse(bodyText) as unknown);
    });
    socket.on('error', (error) => {
      if (!settled) reject(error);
    });
  });
}

function auth(): { authorization: string } {
  return { authorization: `Bearer ${ADMIN}` };
}

async function readPage(response: Response): Promise<{ items: { id: string }[]; nextCursor: string | null }> {
  const body: unknown = await response.json();
  assert.equal(typeof body, 'object');
  assert.ok(body !== null);
  const page = body as { items?: unknown; nextCursor?: unknown };
  assert.ok(Array.isArray(page.items));
  assert.ok(page.nextCursor === null || typeof page.nextCursor === 'string');
  return { items: page.items as { id: string }[], nextCursor: page.nextCursor };
}

function outcomeOf(body: unknown): string {
  if (typeof body !== 'object' || body === null || !('outcome' in body)) {
    assert.fail('expected an ingest outcome');
  }
  const outcome = body.outcome;
  if (typeof outcome !== 'string') {
    assert.fail('expected an ingest outcome');
  }
  return outcome;
}

function bodyOf(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

function eventBody(eventId: string): Uint8Array {
  return Buffer.from(
    JSON.stringify({
      event_id: eventId,
      type: 'invoice.paid',
      occurred_at: '2026-11-08T10:00:00.000Z',
    }),
  );
}

function signature(rawBody: Uint8Array, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

async function seedIntegration(workspaceId: string, endpointToken: string, signingSecret: string): Promise<string> {
  const id = randomUUID();
  await db.orm.public.Integration.create({
    id,
    workspaceId,
    endpointToken,
    signingSecret,
    environment: 'production',
    endpoint: '/hooks/billing',
  });
  await db.orm.public.IngestKey.create({
    id: randomUUID(), integrationId: id, workspaceId, environment: 'production',
    keyHash: hashIngestKey(endpointToken), createdAt: new Date(), revokedAt: null,
  });
  return id;
}

async function seedEvent(
  id: string,
  integrationId: string,
  workspaceId: string,
  firstReceivedAt: string,
): Promise<void> {
  const at = new Date(firstReceivedAt);
  await db.orm.public.WebhookEvent.create({
    id,
    integrationId,
    externalEventId: `evt-${id}`,
    eventType: 'invoice.paid',
    occurredAt: at,
    firstReceivedAt: at,
    traceId: null,
    payloadDigest: 'a'.repeat(64),
    processingState: 'RECEIVED',
    workspaceId,
  });
}

async function reset(): Promise<void> {
  await db.execute(db.raw.sql`DELETE FROM incident_questions`.affectedCount().build());
  await db.execute(db.raw.sql`DELETE FROM hypotheses`.affectedCount().build());
  await db.execute(db.raw.sql`DELETE FROM tool_calls`.affectedCount().build());
  await db.execute(db.raw.sql`DELETE FROM feedback`.affectedCount().build());
  await db.execute(db.raw.sql`DELETE FROM audit_events`.affectedCount().build());
  await db.execute(db.raw.sql`DELETE FROM finding_evidence`.affectedCount().build());
  await db.execute(db.raw.sql`DELETE FROM findings`.affectedCount().build());
  await db.execute(db.raw.sql`DELETE FROM incident_events`.affectedCount().build());
  await db.execute(db.raw.sql`DELETE FROM investigation_runs`.affectedCount().build());
  await db.execute(db.raw.sql`DELETE FROM incidents`.affectedCount().build());
  await db.execute(db.raw.sql`DELETE FROM outbox`.affectedCount().build());
  await db.execute(db.raw.sql`DELETE FROM delivery_attempts`.affectedCount().build());
  await db.execute(db.raw.sql`DELETE FROM evidence`.affectedCount().build());
  await db.execute(db.raw.sql`DELETE FROM webhook_events`.affectedCount().build());
  await db.execute(db.raw.sql`DELETE FROM integrations`.affectedCount().build());
}
