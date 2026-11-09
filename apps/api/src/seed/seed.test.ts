import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { db } from '#db';
import { startWorker } from '../../../worker/src/main.ts';
import { startApiServer } from '../http/server.ts';
import { SEED_SCENARIOS, seedProductFixtures } from './seed.ts';

const TEST_ADMIN_TOKEN = 'local-dev-admin-token';
const WORKSPACE = 'workspace-1';

beforeEach(() => {
  process.env['WIRESLEUTH_ADMIN_TOKEN'] = TEST_ADMIN_TOKEN;
  process.env['WIRESLEUTH_WORKSPACE_ID'] = WORKSPACE;
  process.env['WIRESLEUTH_ADMIN_ACTOR'] = 'local-admin';
});

after(async () => {
  await db.close();
});

test('seedProductFixtures loads two integrations and eight scenarios and a second run does not duplicate events', async () => {
  await reset();

  const firstRun = await seedProductFixtures({ workspaceId: WORKSPACE });
  assert.equal(firstRun.integrations.length, 2);
  assert.equal(firstRun.scenarios.length, 8);
  assert.equal(firstRun.incidentIds.length, 8);

  const eventsAfterFirst = (await db.orm.public.WebhookEvent.all()).filter(
    (row) => row.workspaceId === WORKSPACE,
  );
  const attemptsAfterFirst = (await db.orm.public.DeliveryAttempt.all()).filter(
    (row) => row.workspaceId === WORKSPACE,
  );
  const evidenceAfterFirst = (await db.orm.public.Evidence.all()).filter(
    (row) => row.workspaceId === WORKSPACE,
  );
  const findingsAfterFirst = (await db.orm.public.Finding.all()).filter(
    (row) => row.workspaceId === WORKSPACE,
  );
  const incidentsAfterFirst = (await db.orm.public.Incident.all()).filter(
    (row) => row.workspaceId === WORKSPACE,
  );

  assert.equal(eventsAfterFirst.length, 8);
  assert.equal(attemptsAfterFirst.length, 9);
  assert.equal(evidenceAfterFirst.length, 9);
  assert.equal(findingsAfterFirst.length, 8);
  assert.equal(incidentsAfterFirst.length, 8);
  assert.ok(incidentsAfterFirst.every((incident) => incident.eventCount === 1));

  const expectedClasses = SEED_SCENARIOS.map((item) => item.expectedFailureClass).sort();
  const actualClasses = findingsAfterFirst.map((item) => item.failureClass).sort();
  assert.deepEqual(actualClasses, expectedClasses);

  const secondRun = await seedProductFixtures({ workspaceId: WORKSPACE });
  assert.deepEqual(secondRun.incidentIds, firstRun.incidentIds);
  assert.deepEqual(
    secondRun.scenarios.map((item) => item.eventId),
    firstRun.scenarios.map((item) => item.eventId),
  );

  const eventsAfterSecond = (await db.orm.public.WebhookEvent.all()).filter(
    (row) => row.workspaceId === WORKSPACE,
  );
  const attemptsAfterSecond = (await db.orm.public.DeliveryAttempt.all()).filter(
    (row) => row.workspaceId === WORKSPACE,
  );
  const evidenceAfterSecond = (await db.orm.public.Evidence.all()).filter(
    (row) => row.workspaceId === WORKSPACE,
  );
  const findingsAfterSecond = (await db.orm.public.Finding.all()).filter(
    (row) => row.workspaceId === WORKSPACE,
  );
  const incidentsAfterSecond = (await db.orm.public.Incident.all()).filter(
    (row) => row.workspaceId === WORKSPACE,
  );

  assert.equal(eventsAfterSecond.length, 8);
  assert.equal(attemptsAfterSecond.length, 9);
  assert.equal(evidenceAfterSecond.length, 9);
  assert.equal(findingsAfterSecond.length, 8);
  assert.equal(incidentsAfterSecond.length, 8);
  assert.ok(incidentsAfterSecond.every((incident) => incident.eventCount === 1));
});

test('local API and worker start with no model key and serve a seeded incident export over HTTP', async () => {
  await reset();
  const seeded = await seedProductFixtures({ workspaceId: WORKSPACE });
  const worker = await startWorker({ dispatchIntervalMs: 500 });
  const api = await startApiServer({ port: 0, host: '127.0.0.1' });

  try {
    const listRes = await fetch(`${api.url}/v1/incidents`, {
      headers: { authorization: `Bearer ${TEST_ADMIN_TOKEN}` },
    });
    assert.equal(listRes.status, 200);
    const listBody = (await listRes.json()) as {
      kind: string;
      items: Array<{ id: string; failureClass: string; eventCount: number }>;
    };
    assert.equal(listBody.kind, 'ok');
    assert.equal(listBody.items.length, 8);

    const timeoutIncident = listBody.items.find(
      (item) => item.failureClass === 'NETWORK_TIMEOUT',
    );
    assert.ok(timeoutIncident);
    assert.ok(seeded.incidentIds.includes(timeoutIncident.id));

    const exportRes = await fetch(
      `${api.url}/v1/incidents/${timeoutIncident.id}/export`,
      {
        headers: { authorization: `Bearer ${TEST_ADMIN_TOKEN}` },
      },
    );
    assert.equal(exportRes.status, 200);
    const exportText = await exportRes.text();
    assert.ok(!exportText.includes('seed-signing-secret'));

    const exported = JSON.parse(exportText) as {
      kind: string;
      incidentId: string;
      timeline: Array<{ externalEventId: string }>;
      attempts: Array<{ durationMs: number | null; senderWaitMs: number | null }>;
      evidence: Array<{ id: string }>;
      findings: Array<{ failureClass: string; certainty: string; evidenceIds: string[] }>;
    };
    assert.equal(exported.kind, 'ok');
    assert.equal(exported.incidentId, timeoutIncident.id);
    assert.equal(exported.timeline.length, 1);
    assert.equal(exported.timeline[0]?.externalEventId, 'seed-evt-network-timeout');
    assert.equal(exported.attempts.length, 1);
    assert.equal(exported.attempts[0]?.durationMs, 2450);
    assert.equal(exported.attempts[0]?.senderWaitMs, 2000);
    assert.equal(exported.findings.length, 1);
    assert.equal(exported.findings[0]?.failureClass, 'NETWORK_TIMEOUT');
    assert.equal(exported.findings[0]?.certainty, 'inferred');
    assert.equal(exported.findings[0]?.evidenceIds.length, 1);
    assert.equal(exported.evidence.length, 1);
    assert.equal(exported.findings[0]?.evidenceIds[0], exported.evidence[0]?.id);
  } finally {
    await api.close(0);
    await worker.close();
  }
});

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
  await db.execute(db.raw.sql`DELETE FROM ingest_keys`.affectedCount().build());
  await db.execute(db.raw.sql`DELETE FROM integrations`.affectedCount().build());
}
