import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { db } from '#db';
import { ingest } from '../../api/src/ingest/ingest.ts';
import { SIGNATURE_HEADER } from '../../api/src/ingest/verify.ts';
import { classifyJob } from './classify-job.ts';
import { createOutboxWorker, handleOutboxJob } from './consumer.ts';
import { dispatchPending } from './dispatcher.ts';
import { closeQueue, getQueue } from './queue.ts';

after(async () => {
  await closeQueue();
  await db.close();
});

test('two calls for one event leave one finding', async () => {
  await reset();
  const integrationId = randomUUID();
  const eventId = randomUUID();
  const attemptId = randomUUID();
  const evidenceId = randomUUID();
  await db.orm.public.Integration.create({
    id: integrationId,
    workspaceId: 'workspace-1',
    endpointToken: `token-${integrationId}`,
    signingSecret: 'secret',
    environment: 'production',
    endpoint: '/hooks/billing',
  });
  await db.orm.public.WebhookEvent.create({
    id: eventId,
    integrationId,
    externalEventId: 'evt-classify',
    eventType: 'invoice.paid',
    occurredAt: new Date('2026-11-07T20:00:00.000Z'),
    firstReceivedAt: new Date('2026-11-07T20:00:01.000Z'),
    traceId: null,
    payloadDigest: 'a'.repeat(64),
    processingState: 'RECEIVED',
    workspaceId: 'workspace-1',
  });
  await db.orm.public.DeliveryAttempt.create({
    id: attemptId,
    eventId,
    integrationId,
    receivedAt: new Date('2026-11-07T20:00:01.000Z'),
    httpStatus: 401,
    durationMs: null,
    verificationState: 'VERIFIED',
    handlerState: 'PENDING',
    errorCode: null,
    correlationId: randomUUID(),
    workspaceId: 'workspace-1',
  });
  await db.orm.public.Evidence.create({
    id: evidenceId,
    sourceKind: 'DELIVERY_ATTEMPT',
    sourceRecordId: attemptId,
    summary: 'HTTP 401',
    sha256Digest: 'b'.repeat(64),
    trustTier: 'A',
    workspaceId: 'workspace-1',
  });

  await classifyJob(eventId);
  await classifyJob(eventId);

  const findings = (await db.orm.public.Finding.all()).filter((row) => row.eventId === eventId);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.failureClass, 'AUTH_FAILURE');
  assert.equal(findings[0]?.certainty, 'observed');
  const incidents = await db.orm.public.Incident.all();
  assert.equal(incidents.length, 1);
  assert.equal(incidents[0]?.eventCount, 1);
  assert.equal(incidents[0]?.status, 'OPEN');
  const runs = (await db.orm.public.InvestigationRun.all()).filter((row) => row.eventId === eventId);
  assert.equal(runs.length, 1);
  assert.equal(runs[0]?.mode, 'RULES');
  const links = (await db.orm.public.FindingEvidence.all()).filter(
    (row) => row.findingId === findings[0]?.id,
  );
  assert.deepEqual(
    links.map((row) => row.evidenceId),
    [evidenceId],
  );
});

test('two events with one fingerprint share one incident', async () => {
  await reset();
  const integrationId = randomUUID();
  const firstEventId = randomUUID();
  const secondEventId = randomUUID();
  await db.orm.public.Integration.create({
    id: integrationId,
    workspaceId: 'workspace-1',
    endpointToken: `token-${integrationId}`,
    signingSecret: 'secret',
    environment: 'production',
    endpoint: '/hooks/billing',
  });
  for (const eventId of [firstEventId, secondEventId]) {
    const attemptId = randomUUID();
    await db.orm.public.WebhookEvent.create({
      id: eventId,
      integrationId,
      externalEventId: `evt-${eventId}`,
      eventType: 'invoice.paid',
      occurredAt: new Date('2026-11-07T20:00:00.000Z'),
      firstReceivedAt: new Date('2026-11-07T20:00:01.000Z'),
      traceId: null,
      payloadDigest: 'a'.repeat(64),
      processingState: 'RECEIVED',
      workspaceId: 'workspace-1',
    });
    await db.orm.public.DeliveryAttempt.create({
      id: attemptId,
      eventId,
      integrationId,
      receivedAt: new Date('2026-11-07T20:00:01.000Z'),
      httpStatus: 401,
      durationMs: null,
      verificationState: 'VERIFIED',
      handlerState: 'PENDING',
      errorCode: null,
      correlationId: randomUUID(),
      workspaceId: 'workspace-1',
    });
  }

  await classifyJob(firstEventId);
  await classifyJob(secondEventId);
  await classifyJob(firstEventId);

  const incidents = await db.orm.public.Incident.all();
  assert.equal(incidents.length, 1);
  assert.equal(incidents[0]?.eventCount, 2);
  const findings = await db.orm.public.Finding.all();
  assert.equal(findings.length, 2);
});

test('a second dispatchPending does not enqueue the same row', async () => {
  await reset();
  const queue = getQueue();
  await queue.obliterate({ force: true });

  const integrationId = randomUUID();
  const eventId = randomUUID();
  const verifiedAttemptId = randomUUID();
  const verifiedOutboxId = randomUUID();
  const rejectedAttemptId = randomUUID();
  const rejectedOutboxId = randomUUID();

  await db.orm.public.Integration.create({
    id: integrationId,
    workspaceId: 'workspace-1',
    endpointToken: `token-${integrationId}`,
    signingSecret: 'secret',
    environment: 'production',
    endpoint: '/hooks/billing',
  });

  await db.orm.public.WebhookEvent.create({
    id: eventId,
    integrationId,
    externalEventId: 'evt-outbox',
    eventType: 'invoice.paid',
    occurredAt: new Date('2026-11-07T20:00:00.000Z'),
    firstReceivedAt: new Date('2026-11-07T20:00:01.000Z'),
    traceId: null,
    payloadDigest: 'a'.repeat(64),
    processingState: 'RECEIVED',
    workspaceId: 'workspace-1',
  });

  await db.orm.public.DeliveryAttempt.create({
    id: verifiedAttemptId,
    eventId,
    integrationId,
    receivedAt: new Date('2026-11-07T20:00:01.000Z'),
    httpStatus: 200,
    durationMs: null,
    verificationState: 'VERIFIED',
    handlerState: 'PENDING',
    errorCode: null,
    correlationId: randomUUID(),
    workspaceId: 'workspace-1',
  });

  await db.orm.public.Outbox.create({
    id: verifiedOutboxId,
    eventId,
    attemptId: verifiedAttemptId,
    enqueuedAt: null,
  });

  await db.orm.public.DeliveryAttempt.create({
    id: rejectedAttemptId,
    eventId: null,
    integrationId,
    receivedAt: new Date('2026-11-07T20:00:02.000Z'),
    httpStatus: 401,
    durationMs: null,
    verificationState: 'REJECTED',
    handlerState: 'PENDING',
    errorCode: null,
    correlationId: randomUUID(),
    workspaceId: 'workspace-1',
  });

  await db.orm.public.Outbox.create({
    id: rejectedOutboxId,
    eventId: null,
    attemptId: rejectedAttemptId,
    enqueuedAt: null,
  });

  const markedFirst = await dispatchPending();
  assert.equal(markedFirst, 2);

  const outboxRowsAfterFirst = await db.orm.public.Outbox.all();
  assert.equal(outboxRowsAfterFirst.length, 2);
  assert.ok(outboxRowsAfterFirst[0]?.enqueuedAt !== null);
  assert.ok(outboxRowsAfterFirst[1]?.enqueuedAt !== null);

  const jobs = await queue.getJobs(['waiting', 'active', 'completed', 'delayed']);
  assert.equal(jobs.length, 2);
  const jobIds = new Set(jobs.map((j) => j.id));
  assert.ok(jobIds.has(eventId));
  assert.ok(jobIds.has(rejectedAttemptId));

  const markedSecond = await dispatchPending();
  assert.equal(markedSecond, 0);

  const jobsAfterSecond = await queue.getJobs(['waiting', 'active', 'completed', 'delayed']);
  assert.equal(jobsAfterSecond.length, 2);
});

test('a failed Redis connection leaves enqueuedAt null', async () => {
  await reset();
  const integrationId = randomUUID();
  const attemptId = randomUUID();
  const outboxId = randomUUID();

  await db.orm.public.Integration.create({
    id: integrationId,
    workspaceId: 'workspace-1',
    endpointToken: `token-${integrationId}`,
    signingSecret: 'secret',
    environment: 'production',
    endpoint: '/hooks/billing',
  });

  await db.orm.public.DeliveryAttempt.create({
    id: attemptId,
    eventId: null,
    integrationId,
    receivedAt: new Date('2026-11-07T20:00:01.000Z'),
    httpStatus: 401,
    durationMs: null,
    verificationState: 'REJECTED',
    handlerState: 'PENDING',
    errorCode: null,
    correlationId: randomUUID(),
    workspaceId: 'workspace-1',
  });

  await db.orm.public.Outbox.create({
    id: outboxId,
    eventId: null,
    attemptId,
    enqueuedAt: null,
  });

  const marked = await dispatchPending({ redisUrl: 'redis://127.0.0.1:6378' });
  assert.equal(marked, 0);

  const row = await db.orm.public.Outbox.where({ id: outboxId }).first();
  assert.equal(row?.enqueuedAt, null);
});

test('one verified ingest, one dispatchPending call, and the handler leave one finding; running that path again leaves the same finding', async () => {
  await reset();
  const queue = getQueue();
  await queue.obliterate({ force: true });

  const integrationId = randomUUID();
  const endpointToken = `token-${integrationId}`;
  const signingSecret = 'secret-signing-key-1';

  await db.orm.public.Integration.create({
    id: integrationId,
    workspaceId: 'workspace-1',
    endpointToken,
    signingSecret,
    environment: 'production',
    endpoint: '/hooks/billing',
  });

  const rawBody = Buffer.from(
    JSON.stringify({
      event_id: 'evt-m4-1',
      type: 'invoice.failed',
      occurred_at: '2026-11-07T20:00:00.000Z',
    }),
  );
  const signature = createHmac('sha256', signingSecret).update(rawBody).digest('hex');
  const headers = { [SIGNATURE_HEADER]: signature };

  // 1. One verified ingest
  const firstIngest = await ingest({ token: endpointToken, rawBody, headers });
  assert.equal(firstIngest.outcome, 'stored');
  assert.ok(firstIngest.eventId);

  // 2. One dispatchPending call
  const markedFirst = await dispatchPending();
  assert.equal(markedFirst, 1);

  // 3. Worker handler takes the job
  const worker = createOutboxWorker();
  await new Promise((resolve) => worker.on('completed', resolve));
  await worker.close();

  // Leaves one finding
  const findingsFirst = await db.orm.public.Finding.all();
  assert.equal(findingsFirst.length, 1);
  assert.equal(findingsFirst[0]?.eventId, firstIngest.eventId);
  const incidentsFirst = await db.orm.public.Incident.all();
  assert.equal(incidentsFirst.length, 1);
  assert.equal(incidentsFirst[0]?.eventCount, 1);

  // 4. Running that path again
  const secondIngest = await ingest({ token: endpointToken, rawBody, headers });
  assert.equal(secondIngest.outcome, 'duplicate');
  assert.equal(secondIngest.eventId, firstIngest.eventId);

  const markedSecond = await dispatchPending();
  assert.equal(markedSecond, 1);

  const secondWorker = createOutboxWorker();
  await new Promise((resolve) => setTimeout(resolve, 200));
  await secondWorker.close();

  // Leaves the same finding
  const findingsSecond = await db.orm.public.Finding.all();
  assert.equal(findingsSecond.length, 1);
  assert.equal(findingsSecond[0]?.id, findingsFirst[0]?.id);
  const incidentsSecond = await db.orm.public.Incident.all();
  assert.equal(incidentsSecond.length, 1);
  assert.equal(incidentsSecond[0]?.eventCount, 1);
});

test('a job with only an attempt id is a rejected delivery and finishes without classifying', async () => {
  await reset();
  const queue = getQueue();
  await queue.obliterate({ force: true });

  const integrationId = randomUUID();
  const endpointToken = `token-${integrationId}`;
  const signingSecret = 'secret-signing-key-1';

  await db.orm.public.Integration.create({
    id: integrationId,
    workspaceId: 'workspace-1',
    endpointToken,
    signingSecret,
    environment: 'production',
    endpoint: '/hooks/billing',
  });

  const rawBody = Buffer.from(JSON.stringify({ event_id: 'evt-m4-rejected' }));
  const headers = { [SIGNATURE_HEADER]: 'wrong-signature-hex' };

  // Ingest with wrong signature -> rejected (eventId is null)
  const rejectedIngest = await ingest({ token: endpointToken, rawBody, headers });
  assert.equal(rejectedIngest.outcome, 'rejected');
  assert.equal(rejectedIngest.eventId, null);
  assert.ok(rejectedIngest.attemptId);

  const marked = await dispatchPending();
  assert.equal(marked, 1);

  const worker = createOutboxWorker();
  await new Promise((resolve) => worker.on('completed', resolve));
  await worker.close();

  // No finding or incident should be created
  const findings = await db.orm.public.Finding.all();
  assert.equal(findings.length, 0);
  const incidents = await db.orm.public.Incident.all();
  assert.equal(incidents.length, 0);
});

test('database interruption during ingest rolls back all tables and retrying succeeds', async () => {
  await reset();

  const integrationId = randomUUID();
  const endpointToken = `token-${integrationId}`;
  const signingSecret = 'secret-db-crash-test';

  await db.orm.public.Integration.create({
    id: integrationId,
    workspaceId: 'workspace-1',
    endpointToken,
    signingSecret,
    environment: 'production',
    endpoint: '/hooks/billing',
  });

  const rawBody = Buffer.from(
    JSON.stringify({
      event_id: 'evt-db-interrupt',
      type: 'invoice.failed',
      occurred_at: '2026-11-07T20:00:00.000Z',
    }),
  );
  const signature = createHmac('sha256', signingSecret).update(rawBody).digest('hex');
  const headers = { [SIGNATURE_HEADER]: signature };

  // Ensure constraint does not exist prior to test
  await db.execute(
    db.raw.sql`ALTER TABLE outbox DROP CONSTRAINT IF EXISTS sim_db_interruption`.affectedCount().build(),
  );

  // Add constraint that fails any insert into outbox (the final step in ingest)
  await db.execute(
    db.raw.sql`ALTER TABLE outbox ADD CONSTRAINT sim_db_interruption CHECK (false)`.affectedCount().build(),
  );

  try {
    // Assert that ingest rejects due to database interruption
    await assert.rejects(
      ingest({ token: endpointToken, rawBody, headers }),
      (err: unknown) =>
        err instanceof Error && /sim_db_interruption/i.test(err.message),
    );

    // Assert all tables remain completely empty (rolled back atomically)
    const events = await db.orm.public.WebhookEvent.all();
    const attempts = await db.orm.public.DeliveryAttempt.all();
    const outboxRows = await db.orm.public.Outbox.all();

    assert.equal(events.length, 0, 'webhook_events must be empty after rollback');
    assert.equal(attempts.length, 0, 'delivery_attempts must be empty after rollback');
    assert.equal(outboxRows.length, 0, 'outbox must be empty after rollback');
  } finally {
    // Always drop the constraint to restore database health
    await db.execute(
      db.raw.sql`ALTER TABLE outbox DROP CONSTRAINT IF EXISTS sim_db_interruption`.affectedCount().build(),
    );
  }

  // Assert retry with identical payload succeeds and inserts records cleanly
  const retryResult = await ingest({ token: endpointToken, rawBody, headers });
  assert.equal(retryResult.outcome, 'stored');
  assert.ok(retryResult.eventId);

  assert.equal((await db.orm.public.WebhookEvent.all()).length, 1);
  assert.equal((await db.orm.public.DeliveryAttempt.all()).length, 1);
  assert.equal((await db.orm.public.Outbox.all()).length, 1);
});

test('worker crash after outbox insert and before enqueuedAt is set retries cleanly without duplicate processing', async () => {
  await reset();
  const queue = getQueue();
  await queue.obliterate({ force: true });

  const integrationId = randomUUID();
  const endpointToken = `token-${integrationId}`;
  const signingSecret = 'secret-worker-crash-test';

  await db.orm.public.Integration.create({
    id: integrationId,
    workspaceId: 'workspace-1',
    endpointToken,
    signingSecret,
    environment: 'production',
    endpoint: '/hooks/billing',
  });

  const rawBody = Buffer.from(
    JSON.stringify({
      event_id: 'evt-worker-crash',
      type: 'invoice.failed',
      occurred_at: '2026-11-07T20:00:00.000Z',
    }),
  );
  const signature = createHmac('sha256', signingSecret).update(rawBody).digest('hex');
  const headers = { [SIGNATURE_HEADER]: signature };

  // 1. Ingest a delivery (outcome: 'stored')
  const ingestResult = await ingest({ token: endpointToken, rawBody, headers });
  assert.equal(ingestResult.outcome, 'stored');
  assert.ok(ingestResult.eventId);

  // 2. Simulate worker crashing mid-dispatch:
  // Job was added to BullMQ with jobId, but process died before Outbox.enqueuedAt was updated.
  const row = (await db.orm.public.Outbox.where({ enqueuedAt: null }).all())[0];
  assert.ok(row);

  await queue.add(
    'outbox',
    { eventId: row.eventId, attemptId: row.attemptId },
    { jobId: row.eventId ?? row.attemptId },
  );

  // Assert delivery in webhook_events is committed and intact
  const eventBefore = await db.orm.public.WebhookEvent.where({ id: ingestResult.eventId }).first();
  assert.ok(eventBefore);
  assert.equal(eventBefore.processingState, 'RECEIVED');

  // Assert Outbox.enqueuedAt is null, and queue has 1 job
  const outboxBefore = await db.orm.public.Outbox.where({ id: row.id }).first();
  assert.equal(outboxBefore?.enqueuedAt, null);

  const jobsBefore = await queue.getJobs(['waiting', 'active', 'completed', 'delayed']);
  assert.equal(jobsBefore.length, 1);

  // 3. Call dispatchPending(): assert it marks 1 row, retrying and setting enqueuedAt
  const marked = await dispatchPending();
  assert.equal(marked, 1);

  const outboxAfter = await db.orm.public.Outbox.where({ id: row.id }).first();
  assert.ok(outboxAfter?.enqueuedAt !== null);

  // BullMQ deduplicates by jobId, queue still has 1 job
  const jobsAfter = await queue.getJobs(['waiting', 'active', 'completed', 'delayed']);
  assert.equal(jobsAfter.length, 1);

  // 4. Run worker consumer: assert job completes, generating exactly 1 finding and 1 incident (eventCount: 1)
  const worker = createOutboxWorker();
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout waiting for worker to complete job')), 10000);
    worker.on('completed', () => {
      clearTimeout(timeout);
      resolve();
    });
    worker.on('failed', (_job, err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
  await worker.close();

  const findings = await db.orm.public.Finding.all();
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.eventId, ingestResult.eventId);

  const incidents = await db.orm.public.Incident.all();
  assert.equal(incidents.length, 1);
  assert.equal(incidents[0]?.eventCount, 1);
});

test('queue outage leaves committed deliveries unchanged and recovered dispatch finishes all jobs', async () => {
  await reset();
  const queue = getQueue();
  await queue.obliterate({ force: true });

  const integrationId = randomUUID();
  const endpointToken = `token-${integrationId}`;
  const signingSecret = 'secret-queue-outage-test';

  await db.orm.public.Integration.create({
    id: integrationId,
    workspaceId: 'workspace-1',
    endpointToken,
    signingSecret,
    environment: 'production',
    endpoint: '/hooks/billing',
  });

  // 1. Ingest 2 deliveries
  const body1 = Buffer.from(
    JSON.stringify({
      event_id: 'evt-outage-1',
      type: 'invoice.failed',
      occurred_at: '2026-11-07T20:00:00.000Z',
    }),
  );
  const sig1 = createHmac('sha256', signingSecret).update(body1).digest('hex');
  const res1 = await ingest({ token: endpointToken, rawBody: body1, headers: { [SIGNATURE_HEADER]: sig1 } });
  assert.equal(res1.outcome, 'stored');
  assert.ok(res1.eventId);

  const body2 = Buffer.from(
    JSON.stringify({
      event_id: 'evt-outage-2',
      type: 'invoice.failed',
      occurred_at: '2026-11-07T20:00:01.000Z',
    }),
  );
  const sig2 = createHmac('sha256', signingSecret).update(body2).digest('hex');
  const res2 = await ingest({ token: endpointToken, rawBody: body2, headers: { [SIGNATURE_HEADER]: sig2 } });
  assert.equal(res2.outcome, 'stored');
  assert.ok(res2.eventId);

  const eventsBefore = await db.orm.public.WebhookEvent.all();
  const attemptsBefore = await db.orm.public.DeliveryAttempt.all();
  const outboxBefore = await db.orm.public.Outbox.all();
  assert.equal(eventsBefore.length, 2);
  assert.equal(attemptsBefore.length, 2);
  assert.equal(outboxBefore.length, 2);
  assert.ok(outboxBefore.every((row) => row.enqueuedAt === null));

  // 2. Run dispatchPending({ redisUrl: 'redis://127.0.0.1:6378' }) (unbound port triggering real TCP connection refusal)
  const markedOutage = await dispatchPending({ redisUrl: 'redis://127.0.0.1:6378' });
  assert.equal(markedOutage, 0);

  // 3. Assert committed deliveries (webhook_events and delivery_attempts) are completely unchanged, and enqueuedAt stays null
  const eventsDuring = await db.orm.public.WebhookEvent.all();
  assert.equal(eventsDuring.length, 2);
  assert.equal(eventsDuring[0]?.id, eventsBefore[0]?.id);
  assert.equal(eventsDuring[0]?.payloadDigest, eventsBefore[0]?.payloadDigest);
  assert.equal(eventsDuring[0]?.processingState, 'RECEIVED');
  assert.equal(eventsDuring[1]?.id, eventsBefore[1]?.id);
  assert.equal(eventsDuring[1]?.payloadDigest, eventsBefore[1]?.payloadDigest);
  assert.equal(eventsDuring[1]?.processingState, 'RECEIVED');

  const attemptsDuring = await db.orm.public.DeliveryAttempt.all();
  assert.equal(attemptsDuring.length, 2);
  assert.equal(attemptsDuring[0]?.id, attemptsBefore[0]?.id);
  assert.equal(attemptsDuring[0]?.verificationState, 'VERIFIED');
  assert.equal(attemptsDuring[0]?.handlerState, 'PENDING');
  assert.equal(attemptsDuring[1]?.id, attemptsBefore[1]?.id);
  assert.equal(attemptsDuring[1]?.verificationState, 'VERIFIED');
  assert.equal(attemptsDuring[1]?.handlerState, 'PENDING');

  const outboxDuring = await db.orm.public.Outbox.all();
  assert.equal(outboxDuring.length, 2);
  assert.equal(outboxDuring[0]?.enqueuedAt, null);
  assert.equal(outboxDuring[1]?.enqueuedAt, null);

  const liveJobsOutage = await queue.getJobs(['waiting', 'active', 'completed', 'delayed']);
  assert.equal(liveJobsOutage.length, 0);

  // 4. Once queue recovers (calling dispatchPending() with default options):
  // Assert marked is 2, enqueuedAt is set, and worker consumer finishes all jobs producing findings
  const markedRecovered = await dispatchPending();
  assert.equal(markedRecovered, 2);

  const outboxAfter = await db.orm.public.Outbox.all();
  assert.equal(outboxAfter.length, 2);
  assert.ok(outboxAfter[0]?.enqueuedAt !== null);
  assert.ok(outboxAfter[1]?.enqueuedAt !== null);

  const liveJobsRecovered = await queue.getJobs(['waiting', 'active', 'completed', 'delayed']);
  assert.equal(liveJobsRecovered.length, 2);
  const queuedJobIds = new Set(liveJobsRecovered.map((j) => j.id));
  assert.ok(queuedJobIds.has(res1.eventId));
  assert.ok(queuedJobIds.has(res2.eventId));

  let completedCount = 0;
  const worker = createOutboxWorker();
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout waiting for worker to finish 2 jobs')), 10000);
    worker.on('completed', () => {
      completedCount++;
      if (completedCount === 2) {
        clearTimeout(timeout);
        resolve();
      }
    });
    worker.on('failed', (_job, err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
  await worker.close();

  const findings = await db.orm.public.Finding.all();
  assert.equal(findings.length, 2);
});

test('rejected signature vectors store attempts without creating events or findings, and valid retry succeeds', async () => {
  await reset();
  const queue = getQueue();
  await queue.obliterate({ force: true });

  const integrationId = randomUUID();
  const endpointToken = `token-${integrationId}`;
  const signingSecret = 'secret-real-key-sig-test';

  await db.orm.public.Integration.create({
    id: integrationId,
    workspaceId: 'workspace-1',
    endpointToken,
    signingSecret,
    environment: 'production',
    endpoint: '/hooks/billing',
  });

  const legitimateBody = Buffer.from(
    JSON.stringify({
      event_id: 'evt-sig-rejection-test',
      type: 'invoice.failed',
      occurred_at: '2026-11-07T20:00:00.000Z',
    }),
  );
  const legitimateSignature = createHmac('sha256', signingSecret).update(legitimateBody).digest('hex');

  // Vector 1: Tampered payload (signature from legitimate body, but payload modified)
  const tamperedBody = Buffer.from(
    JSON.stringify({
      event_id: 'evt-sig-rejection-test',
      type: 'invoice.failed',
      occurred_at: '2026-11-07T20:00:00.000Z',
      tampered: true,
    }),
  );
  const resTampered = await ingest({
    token: endpointToken,
    rawBody: tamperedBody,
    headers: { [SIGNATURE_HEADER]: legitimateSignature },
  });
  assert.equal(resTampered.outcome, 'rejected');
  assert.equal(resTampered.eventId, null);
  assert.ok(resTampered.attemptId);

  // Vector 2: Mismatched secret key
  const wrongSecretSignature = createHmac('sha256', 'wrong-secret-key').update(legitimateBody).digest('hex');
  const resWrongSecret = await ingest({
    token: endpointToken,
    rawBody: legitimateBody,
    headers: { [SIGNATURE_HEADER]: wrongSecretSignature },
  });
  assert.equal(resWrongSecret.outcome, 'rejected');
  assert.equal(resWrongSecret.eventId, null);
  assert.ok(resWrongSecret.attemptId);

  // Vector 3: Missing signature header
  const resMissing = await ingest({
    token: endpointToken,
    rawBody: legitimateBody,
    headers: {},
  });
  assert.equal(resMissing.outcome, 'rejected');
  assert.equal(resMissing.eventId, null);
  assert.ok(resMissing.attemptId);

  // Vector 4: Malformed hex signature
  const resMalformed = await ingest({
    token: endpointToken,
    rawBody: legitimateBody,
    headers: { [SIGNATURE_HEADER]: 'malformed-non-hex-sig' },
  });
  assert.equal(resMalformed.outcome, 'rejected');
  assert.equal(resMalformed.eventId, null);
  assert.ok(resMalformed.attemptId);

  // Assert 0 rows in webhook_events
  const events = await db.orm.public.WebhookEvent.all();
  assert.equal(events.length, 0);

  // Assert 4 rows in delivery_attempts (verificationState: 'REJECTED')
  const attempts = await db.orm.public.DeliveryAttempt.all();
  assert.equal(attempts.length, 4);
  assert.ok(attempts.every((a) => a.verificationState === 'REJECTED' && a.eventId === null));

  // Assert 4 outbox rows (eventId: null)
  const outboxRows = await db.orm.public.Outbox.all();
  assert.equal(outboxRows.length, 4);
  assert.ok(outboxRows.every((o) => o.eventId === null && o.enqueuedAt === null));

  // Run dispatchPending(): enqueues with jobId = attemptId
  const marked = await dispatchPending();
  assert.equal(marked, 4);

  const jobs = await queue.getJobs(['waiting', 'active', 'completed', 'delayed']);
  assert.equal(jobs.length, 4);
  const attemptIds = new Set(attempts.map((a) => a.id));
  assert.ok(jobs.every((j) => attemptIds.has(j.id!)));

  // Worker consumer finishes without classifying (0 findings, 0 incidents)
  let completedCount = 0;
  const worker = createOutboxWorker();
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout waiting for worker to finish 4 rejected jobs')), 10000);
    worker.on('completed', () => {
      completedCount++;
      if (completedCount === 4) {
        clearTimeout(timeout);
        resolve();
      }
    });
    worker.on('failed', (_job, err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
  await worker.close();

  assert.equal((await db.orm.public.Finding.all()).length, 0);
  assert.equal((await db.orm.public.Incident.all()).length, 0);

  // Verify subsequent valid delivery with same external event id succeeds cleanly (outcome: 'stored') and is classified into 1 finding
  const resValid = await ingest({
    token: endpointToken,
    rawBody: legitimateBody,
    headers: { [SIGNATURE_HEADER]: legitimateSignature },
  });
  assert.equal(resValid.outcome, 'stored');
  assert.ok(resValid.eventId);

  const markedValid = await dispatchPending();
  assert.equal(markedValid, 1);

  const worker2 = createOutboxWorker();
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout waiting for worker to finish valid job')), 10000);
    worker2.on('completed', () => {
      clearTimeout(timeout);
      resolve();
    });
    worker2.on('failed', (_job, err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
  await worker2.close();

  assert.equal((await db.orm.public.WebhookEvent.all()).length, 1);
  const finalFindings = await db.orm.public.Finding.all();
  assert.equal(finalFindings.length, 1);
  assert.equal(finalFindings[0]?.eventId, resValid.eventId);
  const finalIncidents = await db.orm.public.Incident.all();
  assert.equal(finalIncidents.length, 1);
  assert.equal(finalIncidents[0]?.eventCount, 1);
  assert.equal((await db.orm.public.DeliveryAttempt.all()).length, 5); // 4 rejected + 1 valid
});

async function reset(): Promise<void> {
  await db.execute(
    db.raw.sql`ALTER TABLE outbox DROP CONSTRAINT IF EXISTS sim_db_interruption`.affectedCount().build(),
  );
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
