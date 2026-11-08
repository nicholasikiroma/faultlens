import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, beforeEach, test } from 'node:test';
import { db } from '#db';
import { toAuditEvent, listAuditEvents } from '../audit/audit.ts';
import { transitionIncident } from '../incidents/lifecycle.ts';
import { listFindingFeedback, rateFinding } from './feedback.ts';

const TEST_ADMIN_TOKEN = 'test-admin-token-secret-value';

beforeEach(() => {
  process.env['WIRESLEUTH_ADMIN_TOKEN'] = TEST_ADMIN_TOKEN;
});

after(async () => {
  await db.close();
});

test('two ratings from the same actor leave one feedback row and two audit events', async () => {
  await reset();
  const { findingId } = await seedFinding('workspace-1');

  const first = await rateFinding({
    workspaceId: 'workspace-1',
    findingId,
    actor: 'ada',
    rating: 'USEFUL',
    note: 'Matched the timeout.',
  });
  const second = await rateFinding({
    workspaceId: 'workspace-1',
    findingId,
    actor: 'ada',
    rating: 'INCORRECT',
    note: 'Sender retried.',
  });

  assert.equal(first.outcome, 'rated');
  assert.equal(second.outcome, 'replaced');
  if (first.outcome !== 'rated' || second.outcome !== 'replaced') {
    return;
  }
  assert.equal(first.previousRating, null);
  assert.equal(first.feedback.rating, 'USEFUL');
  assert.equal(second.previousRating, 'USEFUL');
  assert.equal(second.feedback.rating, 'INCORRECT');
  assert.equal(second.feedback.note, 'Sender retried.');
  assert.equal(second.feedback.id, first.feedback.id);
  assert.equal(second.feedback.actor, 'ada');

  const stored = (await db.orm.public.Feedback.all()).filter(
    (row) => row.findingId === findingId,
  );
  assert.equal(stored.length, 1);
  assert.equal(stored[0]?.rating, 'INCORRECT');
  assert.equal(stored[0]?.id, first.feedback.id);

  const ratings = await listFindingFeedback({
    adminToken: TEST_ADMIN_TOKEN,
    workspaceId: 'workspace-1',
    findingId,
  });
  assert.equal(ratings.kind, 'ok');
  if (ratings.kind !== 'ok') {
    return;
  }
  assert.equal(ratings.items.length, 1);
  assert.equal(ratings.items[0]?.rating, 'INCORRECT');
  assert.equal(ratings.items[0]?.note, 'Sender retried.');

  const trail = await listAuditEvents({
    adminToken: TEST_ADMIN_TOKEN,
    workspaceId: 'workspace-1',
    objectType: 'FINDING',
    objectId: findingId,
  });
  assert.equal(trail.kind, 'ok');
  if (trail.kind !== 'ok') {
    return;
  }
  assert.equal(trail.items.length, 2);
  const [opened, replaced] = trail.items;
  assert.equal(opened?.action, 'FINDING_RATED');
  assert.equal(replaced?.action, 'FINDING_RATED');
  if (opened?.action !== 'FINDING_RATED' || replaced?.action !== 'FINDING_RATED') {
    return;
  }
  assert.equal(opened.actor, 'ada');
  assert.equal(opened.oldState, null);
  assert.equal(opened.newState, 'USEFUL');
  assert.equal(opened.objectType, 'FINDING');
  assert.equal(replaced.actor, 'ada');
  assert.equal(replaced.oldState, 'USEFUL');
  assert.equal(replaced.newState, 'INCORRECT');
  assert.equal(replaced.objectId, findingId);
});

test('two actors rating one finding leave two feedback rows', async () => {
  await reset();
  const { findingId } = await seedFinding('workspace-1');

  await rateFinding({
    workspaceId: 'workspace-1',
    findingId,
    actor: 'ada',
    rating: 'USEFUL',
  });
  await rateFinding({
    workspaceId: 'workspace-1',
    findingId,
    actor: 'ben',
    rating: 'INCORRECT',
  });

  const ratings = await listFindingFeedback({
    adminToken: TEST_ADMIN_TOKEN,
    workspaceId: 'workspace-1',
    findingId,
  });
  assert.equal(ratings.kind, 'ok');
  if (ratings.kind !== 'ok') {
    return;
  }
  assert.equal(ratings.items.length, 2);
  const byActor = new Map(ratings.items.map((item) => [item.actor, item.rating]));
  assert.equal(byActor.get('ada'), 'USEFUL');
  assert.equal(byActor.get('ben'), 'INCORRECT');
});

test('a status change reads back as who moved it and from which status', async () => {
  await reset();
  const incidentId = await seedIncident('workspace-1');

  const moved = await transitionIncident({
    workspaceId: 'workspace-1',
    incidentId,
    status: 'INVESTIGATING',
    actor: 'alice',
  });
  assert.deepEqual(moved, {
    outcome: 'transitioned',
    previousStatus: 'OPEN',
    status: 'INVESTIGATING',
  });

  const unchanged = await transitionIncident({
    workspaceId: 'workspace-1',
    incidentId,
    status: 'INVESTIGATING',
    actor: 'ben',
  });
  assert.equal(unchanged.outcome, 'unchanged');

  const illegal = await transitionIncident({
    workspaceId: 'workspace-1',
    incidentId,
    status: 'OPEN',
    actor: 'cara',
  });
  assert.equal(illegal.outcome, 'illegal');

  const missing = await transitionIncident({
    workspaceId: 'workspace-1',
    incidentId: randomUUID(),
    status: 'RESOLVED',
    actor: 'cara',
  });
  assert.deepEqual(missing, { outcome: 'missing', status: null });

  const trail = await listAuditEvents({
    adminToken: TEST_ADMIN_TOKEN,
    workspaceId: 'workspace-1',
    objectType: 'INCIDENT',
    objectId: incidentId,
  });
  assert.equal(trail.kind, 'ok');
  if (trail.kind !== 'ok') {
    return;
  }
  assert.equal(trail.items.length, 1);
  const [move] = trail.items;
  assert.equal(move?.action, 'INCIDENT_STATUS_CHANGED');
  if (move?.action !== 'INCIDENT_STATUS_CHANGED') {
    return;
  }
  assert.equal(move.actor, 'alice');
  assert.equal(move.oldState, 'OPEN');
  assert.equal(move.newState, 'INVESTIGATING');
  assert.equal(move.objectType, 'INCIDENT');
  assert.equal(move.objectId, incidentId);
});

test('a forced rollback leaves feedback, incident status, and audit rows unchanged', async () => {
  await reset();
  const { findingId, incidentId } = await seedFinding('workspace-1');
  await db.execute(
    db.raw.sql`ALTER TABLE audit_events ADD CONSTRAINT sim_audit_rollback CHECK (false)`.affectedCount().build(),
  );

  try {
    await assert.rejects(
      transitionIncident({
        workspaceId: 'workspace-1',
        incidentId,
        status: 'INVESTIGATING',
        actor: 'ada',
      }),
    );
    await assert.rejects(
      rateFinding({
        workspaceId: 'workspace-1',
        findingId,
        actor: 'ada',
        rating: 'USEFUL',
      }),
    );

    const incident = await db.orm.public.Incident.where({ id: incidentId }).first();
    assert.equal(incident?.status, 'OPEN');
    assert.equal((await db.orm.public.Feedback.all()).length, 0);
    assert.equal((await db.orm.public.AuditEvent.all()).length, 0);
  } finally {
    await db.execute(
      db.raw.sql`ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS sim_audit_rollback`.affectedCount().build(),
    );
  }
});

test('toAuditEvent throws when a stored state is not a status or a rating', async () => {
  await reset();
  const id = randomUUID();
  await db.orm.public.AuditEvent.create({
    id,
    workspaceId: 'workspace-1',
    actor: 'ada',
    action: 'INCIDENT_STATUS_CHANGED',
    objectType: 'INCIDENT',
    objectId: randomUUID(),
    oldState: 'NOT_A_STATUS',
    newState: 'OPEN',
    timestamp: new Date('2026-11-08T10:00:00.000Z'),
  });
  const row = await db.orm.public.AuditEvent.where({ id }).first();
  assert.ok(row);
  assert.throws(
    () => toAuditEvent(row),
    (error: unknown) =>
      error instanceof Error && error.message === `audit row ${id} has invalid incident status`,
  );
});

test('feedback and audit reads reject a bad token and stay inside the workspace', async () => {
  await reset();
  const first = await seedFinding('workspace-1');
  const second = await seedFinding('workspace-2');
  await rateFinding({
    workspaceId: 'workspace-1',
    findingId: first.findingId,
    actor: 'ada',
    rating: 'USEFUL',
  });
  await rateFinding({
    workspaceId: 'workspace-2',
    findingId: second.findingId,
    actor: 'ben',
    rating: 'INCORRECT',
  });
  const missing = await rateFinding({
    workspaceId: 'workspace-2',
    findingId: first.findingId,
    actor: 'ada',
    rating: 'INCORRECT',
  });
  assert.deepEqual(missing, { outcome: 'missing' });

  for (const adminToken of [null, undefined, '', 'wrong-token'] as const) {
    assert.deepEqual(
      await listFindingFeedback({
        adminToken,
        workspaceId: 'workspace-1',
        findingId: first.findingId,
      }),
      { kind: 'unauthorized' },
    );
    assert.deepEqual(
      await listAuditEvents({
        adminToken,
        workspaceId: 'workspace-1',
        objectType: 'FINDING',
        objectId: first.findingId,
      }),
      { kind: 'unauthorized' },
    );
  }

  assert.deepEqual(
    await listFindingFeedback({
      adminToken: TEST_ADMIN_TOKEN,
      workspaceId: ' ',
      findingId: first.findingId,
    }),
    { kind: 'unauthorized' },
  );
  assert.deepEqual(
    await listAuditEvents({
      adminToken: TEST_ADMIN_TOKEN,
      workspaceId: '',
    }),
    { kind: 'unauthorized' },
  );

  const ownRatings = await listFindingFeedback({
    adminToken: TEST_ADMIN_TOKEN,
    workspaceId: 'workspace-1',
    findingId: first.findingId,
  });
  const otherRatings = await listFindingFeedback({
    adminToken: TEST_ADMIN_TOKEN,
    workspaceId: 'workspace-2',
    findingId: first.findingId,
  });
  assert.equal(ownRatings.kind, 'ok');
  assert.equal(otherRatings.kind, 'ok');
  if (ownRatings.kind !== 'ok' || otherRatings.kind !== 'ok') {
    return;
  }
  assert.equal(ownRatings.items.length, 1);
  assert.equal(ownRatings.items[0]?.rating, 'USEFUL');
  assert.equal(otherRatings.items.length, 0);

  const ownTrail = await listAuditEvents({
    adminToken: TEST_ADMIN_TOKEN,
    workspaceId: 'workspace-1',
    objectId: first.findingId,
  });
  const otherTrail = await listAuditEvents({
    adminToken: TEST_ADMIN_TOKEN,
    workspaceId: 'workspace-2',
    objectId: first.findingId,
  });
  assert.equal(ownTrail.kind, 'ok');
  assert.equal(otherTrail.kind, 'ok');
  if (ownTrail.kind !== 'ok' || otherTrail.kind !== 'ok') {
    return;
  }
  assert.equal(ownTrail.items.length, 1);
  assert.equal(ownTrail.items[0]?.actor, 'ada');
  assert.equal(otherTrail.items.length, 0);
});

async function seedFinding(
  workspaceId: string,
): Promise<{ findingId: string; incidentId: string }> {
  const integrationId = randomUUID();
  const eventId = randomUUID();
  const incidentId = await seedIncident(workspaceId);
  const findingId = randomUUID();
  const now = new Date('2026-11-08T10:00:00.000Z');

  await db.orm.public.Integration.create({
    id: integrationId,
    workspaceId,
    endpointToken: `token-${integrationId}`,
    signingSecret: 'secret',
    environment: 'production',
    endpoint: '/hooks/billing',
  });
  await db.orm.public.WebhookEvent.create({
    id: eventId,
    integrationId,
    externalEventId: `evt-${eventId}`,
    eventType: 'invoice.failed',
    occurredAt: now,
    firstReceivedAt: now,
    traceId: null,
    payloadDigest: 'a'.repeat(64),
    processingState: 'RECEIVED',
    workspaceId,
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
    workspaceId,
  });

  return { findingId, incidentId };
}

async function seedIncident(workspaceId: string): Promise<string> {
  const id = randomUUID();
  const now = new Date('2026-11-08T10:00:00.000Z');
  await db.orm.public.Incident.create({
    id,
    workspaceId,
    fingerprint: `fp-${id}`,
    integrationId: randomUUID(),
    environment: 'production',
    failureClass: 'AUTH_FAILURE',
    endpoint: '/hooks/billing',
    ruleVersion: '0',
    status: 'OPEN',
    firstSeenAt: now,
    lastSeenAt: now,
    eventCount: 1,
  });
  return id;
}

async function reset(): Promise<void> {
  await db.execute(
    db.raw.sql`ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS sim_audit_rollback`.affectedCount().build(),
  );
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
