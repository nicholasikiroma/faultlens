import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { db } from '#db';
import type { Episode } from '#sdk';
import { classifyJob } from '../../../worker/src/classify-job.ts';
import { ensureProductSchema } from '../seed/seed.ts';
import { ingestEpisode } from './episode-ingest.ts';
import { hashIngestKey } from './keys.ts';

const token = 'episode-ingest-test-key';
const workspaceId = 'workspace-1';

after(async () => {
  await db.close();
});

test('episode ingest rejects unknown token without writing rows', async () => {
  await ensureProductSchema();
  await reset();
  const result = await ingestEpisode({
    token: 'wrong-key',
    rawBody: Buffer.from(JSON.stringify(sampleEpisode('ep_bad_tok'))),
  });
  assert.deepEqual(result, { outcome: 'unknown-token' });
  assert.equal((await db.orm.public.WebhookEvent.all()).length, 0);
});

test('episode ingest scrubs secrets, stores runtime evidence, and classifies INGRESS_ABORTED + DOWNSTREAM_NETWORK_ERROR', async () => {
  await ensureProductSchema();
  await reset();
  await seed();

  const ep = sampleEpisode('ep_runtime_1');
  const result = await ingestEpisode({
    token,
    rawBody: Buffer.from(JSON.stringify(ep)),
  });

  assert.equal(result.outcome, 'stored');
  if (result.outcome !== 'stored') return;
  assert.ok(result.evidenceIds.length >= 3);

  const storedEvidence = await db.orm.public.Evidence.where({ workspaceId }).all();
  const serialized = JSON.stringify(storedEvidence);
  assert.ok(!serialized.includes('sk_live_secret_987654321'));
  assert.ok(!serialized.includes('Bearer top_secret_bearer_token_1234'));

  // Classify job derives deterministic findings & incidents from runtime evidence
  await classifyJob(result.eventId);

  const incidentsAfterFirst = await db.orm.public.Incident.where({ workspaceId }).all();
  const classesAfterFirst = incidentsAfterFirst.map((i) => i.failureClass).sort();
  assert.deepEqual(classesAfterFirst, [
    'DOWNSTREAM_NETWORK_ERROR',
    'INGRESS_ABORTED',
    'UPSTREAM_5XX',
  ]);

  // Re-sending the same episode deduplicates cleanly and creates a second attempt
  const dup = await ingestEpisode({
    token,
    rawBody: Buffer.from(JSON.stringify(ep)),
  });
  assert.equal(dup.outcome, 'duplicate');

  await classifyJob(result.eventId);
  const incidentsAfterDup = await db.orm.public.Incident.where({ workspaceId }).all();
  assert.ok(incidentsAfterDup.some((i) => i.failureClass === 'DUPLICATE_DELIVERY'));
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

async function seed(): Promise<void> {
  const integrationId = randomUUID();
  await db.orm.public.Integration.create({
    id: integrationId,
    workspaceId,
    endpointToken: `sim-${integrationId}`,
    signingSecret: 'signing-secret',
    environment: 'production',
    endpoint: '/webhooks/orders',
  });
  await db.orm.public.IngestKey.create({
    id: randomUUID(),
    integrationId,
    workspaceId,
    environment: 'production',
    keyHash: hashIngestKey(token),
    createdAt: new Date(),
    revokedAt: null,
  });
}

function sampleEpisode(episodeId: string): Episode {
  const now = Date.now();
  return {
    episodeId,
    framework: 'node-http',
    method: 'POST',
    rawUrl: '/webhooks/orders?token=sk_live_secret_987654321',
    routeTemplate: '/webhooks/orders',
    headers: {
      authorization: 'Bearer top_secret_bearer_token_1234',
      'content-type': 'application/json',
    },
    statusCode: 504,
    verification: {
      state: 'VERIFIED',
      provider: 'shopify',
      recordedAtMs: now,
    },
    encryption: {
      scheme: 'NONE',
      authenticatesSender: false,
      decryptedOk: true,
    },
    identity: {
      provider: 'shopify',
      eventId: `evt_${episodeId}`,
      eventType: 'order.created',
    },
    idempotency: {
      handlerIdempotent: true,
      committedSideEffect: false,
    },
    downstreamCalls: [
      {
        spanId: 'span-1',
        method: 'POST',
        origin: 'http://inventory.internal:3002',
        path: '/reserve?api_key=sk_live_secret_987654321',
        startedAtMs: now,
        durationMs: 120,
        errorCode: 'ECONNREFUSED',
        errorMessage: 'connect ECONNREFUSED using Bearer top_secret_bearer_token_1234',
        subHttpFailureType: 'TCP_REFUSED',
      },
    ],
    exceptions: [],
    socket: {
      ingressReceivedAtMs: now - 5100,
      finishFired: false,
      closeFired: true,
      closeAtMs: now,
      writableEndedAtClose: false,
      headersSentAtClose: false,
      handlerSettled: false,
      committedAfterAbort: false,
      eventLoopMaxLagMs: 72,
      activeCpuBlockMs: 45,
    },
    bodyTap: {
      totalBytesSeen: 64,
      tappedBytes: 64,
      truncatedByCap: false,
      wireBodyHmac: 'hmac-1',
      previewJson: {
        orderId: 'ord_1',
        signing_secret: 'must_be_removed',
      },
    },
    isDuplicateDelivery: false,
    isOutOfOrderDelivery: false,
    sealed: true,
    decision: {
      shouldShip: true,
      primaryClass: 'INGRESS_ABORTED',
      secondaryClasses: ['DOWNSTREAM_NETWORK_ERROR'],
      rootCauseSummary: 'Downstream inventory refused connection and socket aborted',
      autoReplaySafe: true,
      replayGateReasons: [],
      evidenceChain: [],
    },
  };
}
