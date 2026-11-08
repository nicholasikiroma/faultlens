import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, beforeEach, test } from 'node:test';
import { db } from '#db';
import { classifyJob } from '../../../worker/src/classify-job.ts';
import { transitionIncident } from '../incidents/lifecycle.ts';
import { listAttempts, listEvents } from './events.ts';
import { exportIncident } from './export.ts';
import { listIncidents } from './incidents.ts';

const TEST_ADMIN_TOKEN = 'test-admin-token-secret-value';

beforeEach(() => {
  process.env['WIRESLEUTH_ADMIN_TOKEN'] = TEST_ADMIN_TOKEN;
});

after(async () => {
  await db.close();
});

test('missing or wrong admin token returns unauthorized across all read functions without throwing', async () => {
  await reset();

  for (const badToken of [null, undefined, '', 'wrong-token', `${TEST_ADMIN_TOKEN}-extra`]) {
    const eventsRes = await listEvents({
      adminToken: badToken,
      workspaceId: 'workspace-1',
      cursor: null,
    });
    assert.deepEqual(eventsRes, { kind: 'unauthorized' });

    const attemptsRes = await listAttempts({
      adminToken: badToken,
      workspaceId: 'workspace-1',
      eventId: 'event-1',
    });
    assert.deepEqual(attemptsRes, { kind: 'unauthorized' });

    const incidentsRes = await listIncidents({
      adminToken: badToken,
      workspaceId: 'workspace-1',
      failureClass: null,
    });
    assert.deepEqual(incidentsRes, { kind: 'unauthorized' });

    const exportRes = await exportIncident({
      adminToken: badToken,
      workspaceId: 'workspace-1',
      incidentId: 'incident-1',
    });
    assert.deepEqual(exportRes, { kind: 'unauthorized' });
  }
});

test('listEvents orders by firstReceivedAt then id, page two repeats no id from page one, and last page has nextCursor null', async () => {
  await reset();
  const integrationId = await seedIntegration({
    workspaceId: 'workspace-1',
    signingSecret: 'super-secret-signing-key',
  });
  const otherIntegrationId = await seedIntegration({
    workspaceId: 'workspace-2',
    signingSecret: 'other-secret-key',
  });

  // Two events at the exact same timestamp to verify tie-breaking by id, plus a third later event
  const idA = '00000000-0000-4000-8000-000000000001';
  const idB = '00000000-0000-4000-8000-000000000002';
  const idC = '00000000-0000-4000-8000-000000000003';
  const idOtherWorkspace = '00000000-0000-4000-8000-000000000004';

  const t1 = new Date('2026-11-08T10:00:00.000Z');
  const t2 = new Date('2026-11-08T10:05:00.000Z');

  // Insert out of order (idB, idC, idA) to verify deterministic sorting
  await db.orm.public.WebhookEvent.create({
    id: idB,
    integrationId,
    externalEventId: 'evt-b',
    eventType: 'invoice.paid',
    occurredAt: t1,
    firstReceivedAt: t1,
    traceId: 'trace-b',
    payloadDigest: 'b'.repeat(64),
    processingState: 'RECEIVED',
    workspaceId: 'workspace-1',
  });
  await db.orm.public.WebhookEvent.create({
    id: idC,
    integrationId,
    externalEventId: 'evt-c',
    eventType: 'invoice.paid',
    occurredAt: t2,
    firstReceivedAt: t2,
    traceId: 'trace-c',
    payloadDigest: 'c'.repeat(64),
    processingState: 'RECEIVED',
    workspaceId: 'workspace-1',
  });
  await db.orm.public.WebhookEvent.create({
    id: idA,
    integrationId,
    externalEventId: 'evt-a',
    eventType: 'invoice.paid',
    occurredAt: t1,
    firstReceivedAt: t1,
    traceId: 'trace-a',
    payloadDigest: 'a'.repeat(64),
    processingState: 'RECEIVED',
    workspaceId: 'workspace-1',
  });
  await db.orm.public.WebhookEvent.create({
    id: idOtherWorkspace,
    integrationId: otherIntegrationId,
    externalEventId: 'evt-other',
    eventType: 'invoice.paid',
    occurredAt: t1,
    firstReceivedAt: t1,
    traceId: 'trace-other',
    payloadDigest: 'd'.repeat(64),
    processingState: 'RECEIVED',
    workspaceId: 'workspace-2',
  });

  const pageOne = await listEvents({
    adminToken: TEST_ADMIN_TOKEN,
    workspaceId: 'workspace-1',
    cursor: null,
    limit: 2,
  });
  assert.equal(pageOne.kind, 'ok');
  assert.deepEqual(
    pageOne.items.map((item) => item.id),
    [idA, idB],
  );
  assert.equal(pageOne.nextCursor, idB);

  const pageTwo = await listEvents({
    adminToken: TEST_ADMIN_TOKEN,
    workspaceId: 'workspace-1',
    cursor: pageOne.nextCursor,
    limit: 2,
  });
  assert.equal(pageTwo.kind, 'ok');
  assert.deepEqual(
    pageTwo.items.map((item) => item.id),
    [idC],
  );
  assert.equal(pageTwo.nextCursor, null);

  const pageOneIds = new Set(pageOne.items.map((item) => item.id));
  for (const item of pageTwo.items) {
    assert.ok(!pageOneIds.has(item.id), `page two repeated id ${item.id}`);
  }
});

test('each P0-04 filter in listEvents excludes non-matching rows', async () => {
  await reset();
  const integration1 = await seedIntegration({
    workspaceId: 'workspace-1',
    signingSecret: 'secret-1',
  });
  const integration2 = await seedIntegration({
    workspaceId: 'workspace-1',
    signingSecret: 'secret-2',
  });

  const event1 = randomUUID();
  const event2 = randomUUID();

  await db.orm.public.WebhookEvent.create({
    id: event1,
    integrationId: integration1,
    externalEventId: 'ext-match-1',
    eventType: 'invoice.failed',
    occurredAt: new Date('2026-11-08T08:00:00.000Z'),
    firstReceivedAt: new Date('2026-11-08T08:00:00.000Z'),
    traceId: '11111111111111111111111111111111',
    payloadDigest: '1'.repeat(64),
    processingState: 'PROCESSED',
    workspaceId: 'workspace-1',
  });
  await db.orm.public.DeliveryAttempt.create({
    id: randomUUID(),
    eventId: event1,
    integrationId: integration1,
    receivedAt: new Date('2026-11-08T08:00:01.000Z'),
    httpStatus: 401,
    durationMs: null,
    senderWaitMs: null,
    verificationState: 'VERIFIED',
    handlerState: 'FAILED',
    errorCode: null,
    correlationId: randomUUID(),
    workspaceId: 'workspace-1',
  });

  await db.orm.public.WebhookEvent.create({
    id: event2,
    integrationId: integration2,
    externalEventId: 'ext-match-2',
    eventType: 'invoice.paid',
    occurredAt: new Date('2026-11-08T12:00:00.000Z'),
    firstReceivedAt: new Date('2026-11-08T12:00:00.000Z'),
    traceId: '22222222222222222222222222222222',
    payloadDigest: '2'.repeat(64),
    processingState: 'RECEIVED',
    workspaceId: 'workspace-1',
  });
  await db.orm.public.DeliveryAttempt.create({
    id: randomUUID(),
    eventId: event2,
    integrationId: integration2,
    receivedAt: new Date('2026-11-08T12:00:01.000Z'),
    httpStatus: null,
    durationMs: 2_500,
    senderWaitMs: 2_000,
    verificationState: 'VERIFIED',
    handlerState: 'PENDING',
    errorCode: null,
    correlationId: randomUUID(),
    workspaceId: 'workspace-1',
  });

  await classifyJob(event1); // AUTH_FAILURE
  await classifyJob(event2); // NETWORK_TIMEOUT

  // 1. Filter by integration
  const byIntegration = await listEvents({
    adminToken: TEST_ADMIN_TOKEN,
    workspaceId: 'workspace-1',
    filters: { integrationId: integration1 },
  });
  assert.equal(byIntegration.kind, 'ok');
  assert.deepEqual(
    byIntegration.items.map((e) => e.id),
    [event1],
  );

  // 2. Filter by time range (from / to)
  const byTimeRange = await listEvents({
    adminToken: TEST_ADMIN_TOKEN,
    workspaceId: 'workspace-1',
    filters: {
      from: new Date('2026-11-08T10:00:00.000Z'),
      to: new Date('2026-11-08T13:00:00.000Z'),
    },
  });
  assert.equal(byTimeRange.kind, 'ok');
  assert.deepEqual(
    byTimeRange.items.map((e) => e.id),
    [event2],
  );

  // 3. Filter by externalEventId
  const byExternalId = await listEvents({
    adminToken: TEST_ADMIN_TOKEN,
    workspaceId: 'workspace-1',
    filters: { externalEventId: 'ext-match-1' },
  });
  assert.equal(byExternalId.kind, 'ok');
  assert.deepEqual(
    byExternalId.items.map((e) => e.id),
    [event1],
  );

  // 4. Filter by status (processingState)
  const byStatus = await listEvents({
    adminToken: TEST_ADMIN_TOKEN,
    workspaceId: 'workspace-1',
    filters: { status: 'PROCESSED' },
  });
  assert.equal(byStatus.kind, 'ok');
  assert.deepEqual(
    byStatus.items.map((e) => e.id),
    [event1],
  );

  // 5. Filter by errorClass
  const byErrorClass = await listEvents({
    adminToken: TEST_ADMIN_TOKEN,
    workspaceId: 'workspace-1',
    filters: { errorClass: 'NETWORK_TIMEOUT' },
  });
  assert.equal(byErrorClass.kind, 'ok');
  assert.deepEqual(
    byErrorClass.items.map((e) => e.id),
    [event2],
  );

  // 6. Filter by traceId
  const byTraceId = await listEvents({
    adminToken: TEST_ADMIN_TOKEN,
    workspaceId: 'workspace-1',
    filters: { traceId: '11111111111111111111111111111111' },
  });
  assert.equal(byTraceId.kind, 'ok');
  assert.deepEqual(
    byTraceId.items.map((e) => e.id),
    [event1],
  );
});

test('listAttempts returns only attempts for that event in that workspace, or an empty list', async () => {
  await reset();
  const integrationId = await seedIntegration({
    workspaceId: 'workspace-1',
    signingSecret: 'secret-1',
  });
  const otherWorkspaceIntegrationId = await seedIntegration({
    workspaceId: 'workspace-2',
    signingSecret: 'secret-2',
  });

  const event1 = randomUUID();
  const event2 = randomUUID();
  const eventWithoutAttempts = randomUUID();
  const attempt1 = randomUUID();
  const attempt2 = randomUUID();

  for (const id of [event1, event2, eventWithoutAttempts]) {
    await db.orm.public.WebhookEvent.create({
      id,
      integrationId,
      externalEventId: `ext-${id}`,
      eventType: 'invoice.paid',
      occurredAt: new Date('2026-11-08T10:00:00.000Z'),
      firstReceivedAt: new Date('2026-11-08T10:00:00.000Z'),
      traceId: null,
      payloadDigest: 'a'.repeat(64),
      processingState: 'RECEIVED',
      workspaceId: 'workspace-1',
    });
  }

  await db.orm.public.DeliveryAttempt.create({
    id: attempt1,
    eventId: event1,
    integrationId,
    receivedAt: new Date('2026-11-08T10:00:01.000Z'),
    httpStatus: 200,
    durationMs: 25,
    senderWaitMs: 1_000,
    verificationState: 'VERIFIED',
    handlerState: 'PROCESSED',
    errorCode: null,
    correlationId: randomUUID(),
    workspaceId: 'workspace-1',
  });

  await db.orm.public.DeliveryAttempt.create({
    id: attempt2,
    eventId: event2,
    integrationId,
    receivedAt: new Date('2026-11-08T10:00:02.000Z'),
    httpStatus: 500,
    durationMs: 40,
    senderWaitMs: 1_000,
    verificationState: 'VERIFIED',
    handlerState: 'FAILED',
    errorCode: 'upstream_500',
    correlationId: randomUUID(),
    workspaceId: 'workspace-1',
  });

  await db.orm.public.DeliveryAttempt.create({
    id: randomUUID(),
    eventId: null,
    integrationId: otherWorkspaceIntegrationId,
    receivedAt: new Date('2026-11-08T10:00:03.000Z'),
    httpStatus: 401,
    durationMs: null,
    senderWaitMs: null,
    verificationState: 'REJECTED',
    handlerState: 'PENDING',
    errorCode: null,
    correlationId: randomUUID(),
    workspaceId: 'workspace-2',
  });

  const event1Attempts = await listAttempts({
    adminToken: TEST_ADMIN_TOKEN,
    workspaceId: 'workspace-1',
    eventId: event1,
  });
  assert.equal(event1Attempts.kind, 'ok');
  assert.deepEqual(
    event1Attempts.items.map((a) => a.id),
    [attempt1],
  );

  const wrongWorkspaceAttempts = await listAttempts({
    adminToken: TEST_ADMIN_TOKEN,
    workspaceId: 'workspace-2',
    eventId: event1,
  });
  assert.equal(wrongWorkspaceAttempts.kind, 'ok');
  assert.deepEqual(wrongWorkspaceAttempts.items, []);

  const emptyAttempts = await listAttempts({
    adminToken: TEST_ADMIN_TOKEN,
    workspaceId: 'workspace-1',
    eventId: eventWithoutAttempts,
  });
  assert.equal(emptyAttempts.kind, 'ok');
  assert.deepEqual(emptyAttempts.items, []);
});

test('listIncidents filters by failureClass, scopes to workspace, and includes lifecycle status', async () => {
  await reset();
  const integrationId = await seedIntegration({
    workspaceId: 'workspace-1',
    signingSecret: 'secret-1',
  });
  const otherIntegrationId = await seedIntegration({
    workspaceId: 'workspace-2',
    signingSecret: 'secret-2',
  });

  const timeoutEventId = randomUUID();
  const authEventId = randomUUID();
  const otherWorkspaceEventId = randomUUID();

  await db.orm.public.WebhookEvent.create({
    id: timeoutEventId,
    integrationId,
    externalEventId: 'evt-timeout',
    eventType: 'invoice.paid',
    occurredAt: new Date('2026-11-08T10:00:00.000Z'),
    firstReceivedAt: new Date('2026-11-08T10:00:01.000Z'),
    traceId: null,
    payloadDigest: 'a'.repeat(64),
    processingState: 'RECEIVED',
    workspaceId: 'workspace-1',
  });
  await db.orm.public.DeliveryAttempt.create({
    id: randomUUID(),
    eventId: timeoutEventId,
    integrationId,
    receivedAt: new Date('2026-11-08T10:00:01.000Z'),
    httpStatus: null,
    durationMs: 2_200,
    senderWaitMs: 2_000,
    verificationState: 'VERIFIED',
    handlerState: 'PENDING',
    errorCode: null,
    correlationId: randomUUID(),
    workspaceId: 'workspace-1',
  });

  await db.orm.public.WebhookEvent.create({
    id: authEventId,
    integrationId,
    externalEventId: 'evt-auth',
    eventType: 'invoice.paid',
    occurredAt: new Date('2026-11-08T10:01:00.000Z'),
    firstReceivedAt: new Date('2026-11-08T10:01:01.000Z'),
    traceId: null,
    payloadDigest: 'b'.repeat(64),
    processingState: 'RECEIVED',
    workspaceId: 'workspace-1',
  });
  await db.orm.public.DeliveryAttempt.create({
    id: randomUUID(),
    eventId: authEventId,
    integrationId,
    receivedAt: new Date('2026-11-08T10:01:01.000Z'),
    httpStatus: 401,
    durationMs: null,
    senderWaitMs: null,
    verificationState: 'VERIFIED',
    handlerState: 'PENDING',
    errorCode: null,
    correlationId: randomUUID(),
    workspaceId: 'workspace-1',
  });

  await db.orm.public.WebhookEvent.create({
    id: otherWorkspaceEventId,
    integrationId: otherIntegrationId,
    externalEventId: 'evt-other-ws',
    eventType: 'invoice.paid',
    occurredAt: new Date('2026-11-08T10:02:00.000Z'),
    firstReceivedAt: new Date('2026-11-08T10:02:01.000Z'),
    traceId: null,
    payloadDigest: 'c'.repeat(64),
    processingState: 'RECEIVED',
    workspaceId: 'workspace-2',
  });
  await db.orm.public.DeliveryAttempt.create({
    id: randomUUID(),
    eventId: otherWorkspaceEventId,
    integrationId: otherIntegrationId,
    receivedAt: new Date('2026-11-08T10:02:01.000Z'),
    httpStatus: null,
    durationMs: 3_000,
    senderWaitMs: 1_000,
    verificationState: 'VERIFIED',
    handlerState: 'PENDING',
    errorCode: null,
    correlationId: randomUUID(),
    workspaceId: 'workspace-2',
  });

  await classifyJob(timeoutEventId);
  await classifyJob(authEventId);
  await classifyJob(otherWorkspaceEventId);

  const allWorkspace1 = await listIncidents({
    adminToken: TEST_ADMIN_TOKEN,
    workspaceId: 'workspace-1',
    failureClass: null,
  });
  assert.equal(allWorkspace1.kind, 'ok');
  assert.equal(allWorkspace1.items.length, 2);

  const timeoutIncident = allWorkspace1.items.find(
    (item) => item.failureClass === 'NETWORK_TIMEOUT',
  );
  assert.ok(timeoutIncident);
  assert.equal(timeoutIncident.status, 'OPEN');

  await transitionIncident({
    workspaceId: 'workspace-1',
    incidentId: timeoutIncident.id,
    status: 'INVESTIGATING',
  });

  const filteredTimeout = await listIncidents({
    adminToken: TEST_ADMIN_TOKEN,
    workspaceId: 'workspace-1',
    failureClass: 'NETWORK_TIMEOUT',
  });
  assert.equal(filteredTimeout.kind, 'ok');
  assert.equal(filteredTimeout.items.length, 1);
  assert.equal(filteredTimeout.items[0]?.id, timeoutIncident.id);
  assert.equal(filteredTimeout.items[0]?.failureClass, 'NETWORK_TIMEOUT');
  assert.equal(filteredTimeout.items[0]?.status, 'INVESTIGATING');
});

test('exportIncident returns timeline, attempts, and stored evidence ids with no signing secret or raw payload, and missing returns missing', async () => {
  await reset();
  const signingSecret = 'signing-secret-must-never-leak-in-export';
  const rawPayloadSecret = 'raw-payload-secret-must-never-leak';
  const integrationId = await seedIntegration({
    workspaceId: 'workspace-1',
    signingSecret,
  });

  const eventId = randomUUID();
  const attemptId = randomUUID();
  const evidenceId = randomUUID();

  await db.orm.public.WebhookEvent.create({
    id: eventId,
    integrationId,
    externalEventId: 'evt-export-1',
    eventType: 'invoice.failed',
    occurredAt: new Date('2026-11-08T10:00:00.000Z'),
    firstReceivedAt: new Date('2026-11-08T10:00:01.000Z'),
    traceId: 'abcdabcdabcdabcdabcdabcdabcdabcd',
    payloadDigest: 'e'.repeat(64),
    redactedPayloadJson: { secret: rawPayloadSecret },
    processingState: 'RECEIVED',
    workspaceId: 'workspace-1',
  });
  await db.orm.public.DeliveryAttempt.create({
    id: attemptId,
    eventId,
    integrationId,
    receivedAt: new Date('2026-11-08T10:00:01.000Z'),
    httpStatus: 401,
    durationMs: 40,
    senderWaitMs: 1_000,
    verificationState: 'VERIFIED',
    handlerState: 'FAILED',
    errorCode: 'auth_401',
    correlationId: randomUUID(),
    workspaceId: 'workspace-1',
  });
  await db.orm.public.Evidence.create({
    id: evidenceId,
    sourceKind: 'DELIVERY_ATTEMPT',
    sourceRecordId: attemptId,
    summary: 'HTTP 401 on delivery attempt',
    sha256Digest: 'f'.repeat(64),
    trustTier: 'A',
    workspaceId: 'workspace-1',
  });

  await classifyJob(eventId);

  const incidents = await db.orm.public.Incident.all();
  assert.equal(incidents.length, 1);
  const incidentId = incidents[0]!.id;

  const exported = await exportIncident({
    adminToken: TEST_ADMIN_TOKEN,
    workspaceId: 'workspace-1',
    incidentId,
  });
  assert.equal(exported.kind, 'ok');
  assert.equal(exported.incidentId, incidentId);
  assert.equal(exported.incident.id, incidentId);
  assert.equal(exported.incident.failureClass, 'AUTH_FAILURE');
  assert.deepEqual(
    exported.timeline.map((e) => e.id),
    [eventId],
  );
  assert.deepEqual(
    exported.attempts.map((a) => a.id),
    [attemptId],
  );
  assert.equal(exported.findings.length, 1);
  assert.deepEqual(exported.findings[0]?.evidenceIds, [evidenceId]);

  // Every evidence id in findings exists in the evidence table and in exported.evidence
  const storedEvidenceIds = new Set(
    (await db.orm.public.Evidence.all()).map((row) => row.id),
  );
  const exportedEvidenceIds = new Set(exported.evidence.map((row) => row.id));
  for (const finding of exported.findings) {
    for (const id of finding.evidenceIds) {
      assert.ok(storedEvidenceIds.has(id), `evidence id ${id} missing from evidence table`);
      assert.ok(exportedEvidenceIds.has(id), `evidence id ${id} missing from exported.evidence`);
    }
  }

  // Export JSON has no signing secret and no raw payload
  const serialized = JSON.stringify(exported);
  assert.ok(!serialized.includes(signingSecret), 'export leaked signingSecret');
  assert.ok(!serialized.includes(rawPayloadSecret), 'export leaked raw payload');
  assert.ok(!serialized.includes('signingSecret'), 'export contains signingSecret key');

  // Missing incident or wrong workspace returns { kind: 'missing' } and no other incident's rows
  const missingRes = await exportIncident({
    adminToken: TEST_ADMIN_TOKEN,
    workspaceId: 'workspace-1',
    incidentId: randomUUID(),
  });
  assert.deepEqual(missingRes, { kind: 'missing' });

  const wrongWorkspaceRes = await exportIncident({
    adminToken: TEST_ADMIN_TOKEN,
    workspaceId: 'workspace-2',
    incidentId,
  });
  assert.deepEqual(wrongWorkspaceRes, { kind: 'missing' });
});

async function seedIntegration(input: {
  workspaceId: string;
  signingSecret: string;
}): Promise<string> {
  const id = randomUUID();
  await db.orm.public.Integration.create({
    id,
    workspaceId: input.workspaceId,
    endpointToken: `token-${id}`,
    signingSecret: input.signingSecret,
    environment: 'production',
    endpoint: '/hooks/billing',
  });
  return id;
}

async function reset(): Promise<void> {
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
