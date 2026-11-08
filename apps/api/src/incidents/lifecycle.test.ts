import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { db } from '#db';
import { INCIDENT_TRANSITIONS, type IncidentStatus } from '#domain';
import { classifyJob } from '../../../worker/src/classify-job.ts';
import { canTransitionIncident, transitionIncident } from './lifecycle.ts';

after(async () => {
  await db.close();
});

test('a legal transition changes status and a second identical move stays on the same status', async () => {
  await reset();
  const incidentId = await seedIncident({ workspaceId: 'workspace-1', status: 'OPEN' });

  const toInvestigating = await transitionIncident({
    workspaceId: 'workspace-1',
    incidentId,
    status: 'INVESTIGATING',
    actor: 'tester',
  });
  assert.deepEqual(toInvestigating, {
    outcome: 'transitioned',
    previousStatus: 'OPEN',
    status: 'INVESTIGATING',
  });
  assert.equal(await storedStatus(incidentId), 'INVESTIGATING');

  const duplicateMove = await transitionIncident({
    workspaceId: 'workspace-1',
    incidentId,
    status: 'INVESTIGATING',
    actor: 'tester',
  });
  assert.deepEqual(duplicateMove, {
    outcome: 'unchanged',
    previousStatus: 'INVESTIGATING',
    status: 'INVESTIGATING',
  });
  assert.equal(await storedStatus(incidentId), 'INVESTIGATING');

  const toResolved = await transitionIncident({
    workspaceId: 'workspace-1',
    incidentId,
    status: 'RESOLVED',
    actor: 'tester',
  });
  assert.deepEqual(toResolved, {
    outcome: 'transitioned',
    previousStatus: 'INVESTIGATING',
    status: 'RESOLVED',
  });
  assert.equal(await storedStatus(incidentId), 'RESOLVED');

  const toArchived = await transitionIncident({
    workspaceId: 'workspace-1',
    incidentId,
    status: 'ARCHIVED',
    actor: 'tester',
  });
  assert.deepEqual(toArchived, {
    outcome: 'transitioned',
    previousStatus: 'RESOLVED',
    status: 'ARCHIVED',
  });
  assert.equal(await storedStatus(incidentId), 'ARCHIVED');
});

test('an illegal transition does not write and leaves the stored status unchanged', async () => {
  await reset();
  const statuses: readonly IncidentStatus[] = ['OPEN', 'INVESTIGATING', 'RESOLVED', 'ARCHIVED'];

  for (const from of statuses) {
    for (const to of statuses) {
      if (from === to || canTransitionIncident(from, to)) {
        continue;
      }
      const incidentId = await seedIncident({ workspaceId: 'workspace-1', status: from });
      const result = await transitionIncident({
        workspaceId: 'workspace-1',
        incidentId,
        status: to,
        actor: 'tester',
      });
      assert.deepEqual(
        result,
        {
          outcome: 'illegal',
          previousStatus: from,
          status: from,
        },
        `expected ${from} -> ${to} to be rejected`,
      );
      assert.equal(await storedStatus(incidentId), from);
    }
  }

  assert.deepEqual(INCIDENT_TRANSITIONS.ARCHIVED, []);
});

test('a manual override uses INCIDENT_TRANSITIONS and classification preserves the overridden status', async () => {
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
    await db.orm.public.WebhookEvent.create({
      id: eventId,
      integrationId,
      externalEventId: `evt-${eventId}`,
      eventType: 'invoice.failed',
      occurredAt: new Date('2026-11-08T10:00:00.000Z'),
      firstReceivedAt: new Date('2026-11-08T10:00:01.000Z'),
      traceId: null,
      payloadDigest: 'a'.repeat(64),
      processingState: 'RECEIVED',
      workspaceId: 'workspace-1',
    });
    await db.orm.public.DeliveryAttempt.create({
      id: randomUUID(),
      eventId,
      integrationId,
      receivedAt: new Date('2026-11-08T10:00:01.000Z'),
      httpStatus: 401,
      durationMs: null,
      senderWaitMs: null,
      verificationState: 'VERIFIED',
      handlerState: 'PENDING',
      errorCode: null,
      correlationId: randomUUID(),
      workspaceId: 'workspace-1',
    });
  }

  await classifyJob(firstEventId);
  const incidents = await db.orm.public.Incident.all();
  assert.equal(incidents.length, 1);
  const incidentId = incidents[0]!.id;
  assert.equal(incidents[0]!.status, 'OPEN');

  const overrideResult = await transitionIncident({
    workspaceId: 'workspace-1',
    incidentId,
    status: 'RESOLVED',
    actor: 'tester',
  });
  assert.deepEqual(overrideResult, {
    outcome: 'transitioned',
    previousStatus: 'OPEN',
    status: 'RESOLVED',
  });

  await classifyJob(secondEventId);
  const updated = await db.orm.public.Incident.where({ id: incidentId }).first();
  assert.ok(updated);
  assert.equal(updated.eventCount, 2);
  assert.equal(updated.status, 'RESOLVED');
});

test('transitionIncident enforces workspace isolation and returns missing for unknown incidents', async () => {
  await reset();
  const incidentId = await seedIncident({ workspaceId: 'workspace-1', status: 'OPEN' });

  const wrongWorkspace = await transitionIncident({
    workspaceId: 'workspace-2',
    incidentId,
    status: 'INVESTIGATING',
    actor: 'tester',
  });
  assert.deepEqual(wrongWorkspace, { outcome: 'missing', status: null });
  assert.equal(await storedStatus(incidentId), 'OPEN');

  const missingIncident = await transitionIncident({
    workspaceId: 'workspace-1',
    incidentId: randomUUID(),
    status: 'INVESTIGATING',
    actor: 'tester',
  });
  assert.deepEqual(missingIncident, { outcome: 'missing', status: null });
});

async function seedIncident(input: {
  workspaceId: string;
  status: IncidentStatus;
}): Promise<string> {
  const id = randomUUID();
  const now = new Date('2026-11-08T10:00:00.000Z');
  await db.orm.public.Incident.create({
    id,
    workspaceId: input.workspaceId,
    fingerprint: `fp-${id}`,
    integrationId: randomUUID(),
    environment: 'production',
    failureClass: 'AUTH_FAILURE',
    endpoint: '/hooks/billing',
    ruleVersion: '0',
    status: input.status,
    firstSeenAt: now,
    lastSeenAt: now,
    eventCount: 1,
  });
  return id;
}

async function storedStatus(incidentId: string): Promise<IncidentStatus | null> {
  const row = await db.orm.public.Incident.where({ id: incidentId }).first();
  return row?.status ?? null;
}

async function reset(): Promise<void> {
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
