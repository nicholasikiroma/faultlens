import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { MockModelProvider } from '#agent';
import { db } from '#db';
import {
  listIncidentInvestigations,
  rateHypothesis,
  triggerInvestigation,
} from '../../api/src/investigations/investigate.ts';
import { exportIncident } from '../../api/src/read/export.ts';
import { ensureProductSchema } from '../../api/src/seed/seed.ts';
import { config as apiConfig } from '../../api/src/config.ts';
import { createPostgresAgentRepository } from './agent-repo.ts';
import { classifyJob } from './classify-job.ts';
import { investigateJob } from './investigation-job.ts';

after(async () => {
  await db.close();
});

test('investigateJob persists ToolCalls, Hypotheses, supports feedback and export without leaking secrets', async () => {
  await ensureProductSchema();
  await reset();

  const integrationId = randomUUID();
  const eventId = randomUUID();
  const attemptId = randomUUID();
  const evidenceId = randomUUID();

  await db.orm.public.Integration.create({
    id: integrationId,
    workspaceId: 'workspace-1',
    endpointToken: `tok-${integrationId}`,
    signingSecret: 'ultra_secret_signing_key_do_not_leak',
    environment: 'production',
    endpoint: '/hooks/billing',
  });
  await db.orm.public.WebhookEvent.create({
    id: eventId,
    integrationId,
    externalEventId: 'evt-agent-1',
    eventType: 'invoice.failed',
    occurredAt: new Date('2026-11-17T10:00:00.000Z'),
    firstReceivedAt: new Date('2026-11-17T10:00:01.000Z'),
    traceId: 'trace-agent-1',
    payloadDigest: 'a'.repeat(64),
    processingState: 'FAILED',
    workspaceId: 'workspace-1',
  });
  await db.orm.public.DeliveryAttempt.create({
    id: attemptId,
    eventId,
    integrationId,
    receivedAt: new Date('2026-11-17T10:00:01.000Z'),
    httpStatus: 429,
    durationMs: 25,
    verificationState: 'VERIFIED',
    handlerState: 'FAILED',
    errorCode: 'rate_limit',
    correlationId: randomUUID(),
    workspaceId: 'workspace-1',
  });
  await db.orm.public.Evidence.create({
    id: evidenceId,
    sourceKind: 'DELIVERY_ATTEMPT',
    sourceRecordId: attemptId,
    summary: 'Upstream returned 429 Too Many Requests',
    sha256Digest: 'b'.repeat(64),
    trustTier: 'A',
    workspaceId: 'workspace-1',
  });

  // Deterministic mode runs with AI disabled
  process.env['FAULTLENS_AI_ENABLED'] = '0';
  await classifyJob(eventId);

  const incident = await db.orm.public.Incident.where({ workspaceId: 'workspace-1' }).first();
  assert.ok(incident);

  // Trigger disabled returns ai-disabled
  const disabledRes = await triggerInvestigation({
    workspaceId: 'workspace-1',
    incidentId: incident.id,
    actor: 'local-admin',
  });
  assert.deepEqual(disabledRes, { outcome: 'ai-disabled' });

  // Enable AI and trigger manually with injected enqueue stub (avoids requiring live Redis)
  process.env['FAULTLENS_AI_ENABLED'] = '1';
  let enqueuedRunId: string | null = null;
  const queued = await triggerInvestigation({
    workspaceId: 'workspace-1',
    incidentId: incident.id,
    actor: 'local-admin',
    reason: 'operator_requested',
    enqueueFn: async (runId) => {
      enqueuedRunId = runId;
    },
  });
  assert.equal(queued.outcome, 'queued');
  assert.ok(enqueuedRunId);

  // Check workspace isolation in Postgres AgentToolRepository
  const repo = createPostgresAgentRepository();
  assert.equal(await repo.getIncident('workspace-2', incident.id), null);
  const cfgSummary = await repo.getIntegrationConfigSummary('workspace-1', integrationId);
  assert.equal(cfgSummary?.hasSigningSecret, true);
  assert.ok(!JSON.stringify(cfgSummary).includes('ultra_secret_signing_key_do_not_leak'));

  const mockProvider = new MockModelProvider([
    {
      content: null,
      toolCalls: [
        { id: 'tc1', name: 'get_incident', arguments: {} },
        { id: 'tc2', name: 'get_rule_findings', arguments: {} },
        { id: 'tc3', name: 'get_evidence', arguments: { evidenceIds: [evidenceId] } },
      ],
      usage: { promptTokens: 120, completionTokens: 40, totalTokens: 160 },
    },
    {
      content: JSON.stringify({
        knownSummary: 'HTTP 429 observed on billing webhook attempt.',
        suspectSummary: 'Worker burst exceeded provider rate limit.',
        nextSafeCheckSummary: 'Lower worker concurrency and enable backoff.',
        hypotheses: [
          {
            title: 'Rate limit exceeded during billing burst',
            reasoning: `Evidence ${evidenceId} recorded HTTP 429.`,
            epistemicStatus: 'OBSERVED',
            confidence: 'HIGH',
            citedEvidenceIds: [evidenceId],
            missingInformation: ['Retry-After header value'],
            suggestedCheck: 'Inspect provider rate-limit dashboard.',
            remediation: {
              kind: 'config_diff',
              summary: 'Throttle BullMQ worker concurrency.',
              snippet: 'concurrency: 5',
              safetyNote: 'Monitor queue depth after lowering concurrency.',
            },
          },
        ],
      }),
      toolCalls: [],
      usage: { promptTokens: 200, completionTokens: 90, totalTokens: 290 },
    },
  ]);

  await investigateJob(enqueuedRunId!, { provider: mockProvider });

  const listed = await listIncidentInvestigations({
    adminToken: apiConfig.adminToken,
    workspaceId: 'workspace-1',
    incidentId: incident.id,
  });
  assert.equal(listed.kind, 'ok');
  if (listed.kind !== 'ok') return;

  const aiRun = listed.runs.find((r) => r.id === enqueuedRunId);
  assert.equal(aiRun?.state, 'COMPLETED');
  assert.equal(aiRun?.toolCallCount, 3);
  assert.equal(listed.toolCalls.length, 3);
  assert.equal(listed.hypotheses.length, 1);

  const hyp = listed.hypotheses[0]!;
  const rated = await rateHypothesis({
    workspaceId: 'workspace-1',
    hypothesisId: hyp.id,
    actor: 'local-admin',
    rating: 'USEFUL',
  });
  assert.equal(rated.outcome, 'rated');

  const exported = await exportIncident({
    adminToken: apiConfig.adminToken,
    workspaceId: 'workspace-1',
    incidentId: incident.id,
  });
  assert.equal(exported.kind, 'ok');
  if (exported.kind !== 'ok') return;
  assert.equal(exported.hypotheses.length, 1);
  assert.equal(exported.hypotheses[0]?.feedback, 'USEFUL');
  assert.equal(exported.agentRuns.length, 1);
  assert.equal(exported.toolCalls.length, 3);
  assert.ok(!JSON.stringify(exported).includes('ultra_secret_signing_key_do_not_leak'));

  process.env['FAULTLENS_AI_ENABLED'] = '0';
});

async function reset(): Promise<void> {
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
