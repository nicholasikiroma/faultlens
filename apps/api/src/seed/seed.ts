import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PostgresTransactionContext } from '@prisma/orm-postgres/runtime';
import { db, type Contract } from '#db';
import type {
  FailureClass,
  HandlerState,
  ProcessingState,
  VerificationState,
} from '#domain';
import { sqlText, sqlTimestamp } from '#sql';
import { classifyJob } from '../../../worker/src/classify-job.ts';
import { config } from '../config.ts';
import { hashIngestKey } from '../ingest/keys.ts';

type Tx = PostgresTransactionContext<Contract>;

export interface SeedIntegrationSpec {
  readonly slug: 'billing' | 'orders';
  readonly endpointToken: string;
  readonly signingSecret: string;
  readonly rawIngestKey: string;
  readonly environment: string;
  readonly endpoint: string;
}

export interface SeedAttemptSpec {
  readonly index: number;
  readonly receivedAt: string;
  readonly httpStatus: number | null;
  readonly durationMs: number | null;
  readonly senderWaitMs: number | null;
  readonly verificationState: Exclude<VerificationState, 'RECEIVED'>;
  readonly handlerState: HandlerState;
  readonly errorCode: string | null;
  readonly evidenceSummary: string;
}

export interface SeedScenarioSpec {
  readonly index: number;
  readonly scenario:
    | 'auth-401'
    | 'rate-limit-429'
    | 'upstream-503'
    | 'network-timeout'
    | 'schema-mismatch'
    | 'invalid-signature'
    | 'duplicate-delivery'
    | 'out-of-order';
  readonly expectedFailureClass: FailureClass;
  readonly integrationSlug: 'billing' | 'orders';
  readonly externalEventId: string;
  readonly eventType: string;
  readonly occurredAt: string;
  readonly firstReceivedAt: string;
  readonly traceId: string;
  readonly processingState: ProcessingState;
  readonly attempts: readonly SeedAttemptSpec[];
}

export const SEED_INTEGRATIONS: readonly SeedIntegrationSpec[] = [
  {
    slug: 'billing',
    endpointToken: 'seed-token-billing',
    signingSecret: 'seed-signing-secret-billing',
    rawIngestKey: 'flk_seed_billing_local_ingest_key_00000001',
    environment: 'local',
    endpoint: '/hooks/billing',
  },
  {
    slug: 'orders',
    endpointToken: 'seed-token-orders',
    signingSecret: 'seed-signing-secret-orders',
    rawIngestKey: 'flk_seed_orders_local_ingest_key_00000002',
    environment: 'local',
    endpoint: '/hooks/orders',
  },
] as const;

export const SEED_SCENARIOS: readonly SeedScenarioSpec[] = [
  {
    index: 1,
    scenario: 'auth-401',
    expectedFailureClass: 'AUTH_FAILURE',
    integrationSlug: 'billing',
    externalEventId: 'seed-evt-auth-401',
    eventType: 'invoice.payment_failed',
    occurredAt: '2026-11-08T10:00:00.000Z',
    firstReceivedAt: '2026-11-08T10:00:01.000Z',
    traceId: '10000000000000000000000000000001',
    processingState: 'FAILED',
    attempts: [
      {
        index: 1,
        receivedAt: '2026-11-08T10:00:01.000Z',
        httpStatus: 401,
        durationMs: 35,
        senderWaitMs: 2_000,
        verificationState: 'VERIFIED',
        handlerState: 'FAILED',
        errorCode: 'http_401',
        evidenceSummary: 'Receiver returned HTTP 401 Unauthorized on webhook delivery.',
      },
    ],
  },
  {
    index: 2,
    scenario: 'rate-limit-429',
    expectedFailureClass: 'RATE_LIMIT',
    integrationSlug: 'billing',
    externalEventId: 'seed-evt-rate-limit-429',
    eventType: 'customer.subscription.updated',
    occurredAt: '2026-11-08T10:01:00.000Z',
    firstReceivedAt: '2026-11-08T10:01:01.000Z',
    traceId: '10000000000000000000000000000002',
    processingState: 'FAILED',
    attempts: [
      {
        index: 1,
        receivedAt: '2026-11-08T10:01:01.000Z',
        httpStatus: 429,
        durationMs: 18,
        senderWaitMs: 2_000,
        verificationState: 'VERIFIED',
        handlerState: 'FAILED',
        errorCode: 'http_429',
        evidenceSummary: 'Receiver returned HTTP 429 Too Many Requests.',
      },
    ],
  },
  {
    index: 3,
    scenario: 'upstream-503',
    expectedFailureClass: 'UPSTREAM_5XX',
    integrationSlug: 'billing',
    externalEventId: 'seed-evt-upstream-503',
    eventType: 'payout.paid',
    occurredAt: '2026-11-08T10:02:00.000Z',
    firstReceivedAt: '2026-11-08T10:02:01.000Z',
    traceId: '10000000000000000000000000000003',
    processingState: 'FAILED',
    attempts: [
      {
        index: 1,
        receivedAt: '2026-11-08T10:02:01.000Z',
        httpStatus: 503,
        durationMs: 420,
        senderWaitMs: 2_000,
        verificationState: 'VERIFIED',
        handlerState: 'FAILED',
        errorCode: 'http_503',
        evidenceSummary: 'Receiver returned HTTP 503 Service Unavailable.',
      },
    ],
  },
  {
    index: 4,
    scenario: 'network-timeout',
    expectedFailureClass: 'NETWORK_TIMEOUT',
    integrationSlug: 'billing',
    externalEventId: 'seed-evt-network-timeout',
    eventType: 'charge.succeeded',
    occurredAt: '2026-11-08T10:03:00.000Z',
    firstReceivedAt: '2026-11-08T10:03:01.000Z',
    traceId: '10000000000000000000000000000004',
    processingState: 'FAILED',
    attempts: [
      {
        index: 1,
        receivedAt: '2026-11-08T10:03:01.000Z',
        httpStatus: null,
        durationMs: 2_450,
        senderWaitMs: 2_000,
        verificationState: 'VERIFIED',
        handlerState: 'PENDING',
        errorCode: 'timeout',
        evidenceSummary: 'Receiver processing took 2450 ms while sender timed out at 2000 ms.',
      },
    ],
  },
  {
    index: 5,
    scenario: 'schema-mismatch',
    expectedFailureClass: 'SCHEMA_MISMATCH',
    integrationSlug: 'orders',
    externalEventId: 'seed-evt-schema-mismatch',
    eventType: 'checkout.session.completed',
    occurredAt: '2026-11-08T10:04:00.000Z',
    firstReceivedAt: '2026-11-08T10:04:01.000Z',
    traceId: '10000000000000000000000000000005',
    processingState: 'FAILED',
    attempts: [
      {
        index: 1,
        receivedAt: '2026-11-08T10:04:01.000Z',
        httpStatus: 400,
        durationMs: 12,
        senderWaitMs: 2_000,
        verificationState: 'VERIFIED',
        handlerState: 'FAILED',
        errorCode: 'schema_error',
        evidenceSummary: 'Receiver rejected payload with HTTP 400 schema validation error.',
      },
    ],
  },
  {
    index: 6,
    scenario: 'invalid-signature',
    expectedFailureClass: 'INVALID_SIGNATURE',
    integrationSlug: 'orders',
    externalEventId: 'seed-evt-invalid-signature',
    eventType: 'invoice.finalized',
    occurredAt: '2026-11-08T10:05:00.000Z',
    firstReceivedAt: '2026-11-08T10:05:01.000Z',
    traceId: '10000000000000000000000000000006',
    processingState: 'FAILED',
    attempts: [
      {
        index: 1,
        receivedAt: '2026-11-08T10:05:01.000Z',
        httpStatus: null,
        durationMs: 9,
        senderWaitMs: 2_000,
        verificationState: 'REJECTED',
        handlerState: 'FAILED',
        errorCode: 'invalid_signature',
        evidenceSummary: 'Webhook HMAC-SHA256 signature verification returned REJECTED.',
      },
    ],
  },
  {
    index: 7,
    scenario: 'duplicate-delivery',
    expectedFailureClass: 'DUPLICATE_DELIVERY',
    integrationSlug: 'orders',
    externalEventId: 'seed-evt-duplicate-delivery',
    eventType: 'order.fulfilled',
    occurredAt: '2026-11-08T10:06:00.000Z',
    firstReceivedAt: '2026-11-08T10:06:01.000Z',
    traceId: '10000000000000000000000000000007',
    processingState: 'PROCESSED',
    attempts: [
      {
        index: 1,
        receivedAt: '2026-11-08T10:06:01.000Z',
        httpStatus: 200,
        durationMs: 45,
        senderWaitMs: 2_000,
        verificationState: 'VERIFIED',
        handlerState: 'PROCESSED',
        errorCode: null,
        evidenceSummary: 'Initial verified delivery stored for order.fulfilled.',
      },
      {
        index: 2,
        receivedAt: '2026-11-08T10:06:02.000Z',
        httpStatus: 200,
        durationMs: 30,
        senderWaitMs: 2_000,
        verificationState: 'VERIFIED',
        handlerState: 'PROCESSED',
        errorCode: null,
        evidenceSummary: 'Repeat verified delivery with identical external event id and payload digest.',
      },
    ],
  },
  {
    index: 8,
    scenario: 'out-of-order',
    expectedFailureClass: 'UNKNOWN',
    integrationSlug: 'orders',
    externalEventId: 'seed-evt-out-of-order',
    eventType: 'subscription.schedule.updated',
    occurredAt: '2026-11-08T11:07:00.000Z',
    firstReceivedAt: '2026-11-08T10:07:01.000Z',
    traceId: '10000000000000000000000000000008',
    processingState: 'RECEIVED',
    attempts: [
      {
        index: 1,
        receivedAt: '2026-11-08T10:07:01.000Z',
        httpStatus: 200,
        durationMs: 55,
        senderWaitMs: 2_000,
        verificationState: 'VERIFIED',
        handlerState: 'PENDING',
        errorCode: null,
        evidenceSummary: 'Delivery arrived out of occurred_at sequence with no single-attempt rule match.',
      },
    ],
  },
] as const;

export interface SeedResult {
  readonly workspaceId: string;
  readonly integrations: readonly {
    readonly id: string;
    readonly slug: 'billing' | 'orders';
    readonly endpoint: string;
    readonly ingestKey: string;
  }[];
  readonly scenarios: readonly {
    readonly scenario: SeedScenarioSpec['scenario'];
    readonly eventId: string;
    readonly externalEventId: string;
    readonly expectedFailureClass: FailureClass;
  }[];
  readonly incidentIds: readonly string[];
}

export async function ensureProductSchema(): Promise<void> {
  const sqlPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../prisma/sql/incidents.sql',
  );
  const ddl = readFileSync(sqlPath, 'utf8');
  const template = Object.assign([ddl], { raw: [ddl] }) as unknown as TemplateStringsArray;
  await db.execute(db.raw.sql(template).affectedCount().build());
}

export async function seedProductFixtures(options?: {
  workspaceId?: string;
}): Promise<SeedResult> {
  const workspaceId = (options?.workspaceId ?? config.workspaceId).trim();
  if (workspaceId.length === 0) {
    throw new Error('FAULTLENS_WORKSPACE_ID must not be blank');
  }

  await ensureProductSchema();

  const integrationIds = new Map<'billing' | 'orders', string>();
  const seededIntegrations: Array<{
    id: string;
    slug: 'billing' | 'orders';
    endpoint: string;
    ingestKey: string;
  }> = [];

  const seededScenarios: Array<{
    scenario: SeedScenarioSpec['scenario'];
    eventId: string;
    externalEventId: string;
    expectedFailureClass: FailureClass;
  }> = [];

  await db.transaction(async (tx) => {
    for (let i = 0; i < SEED_INTEGRATIONS.length; i += 1) {
      const spec = SEED_INTEGRATIONS[i]!;
      const id = deterministicId(workspaceId, `integration:${spec.slug}`, 101 + i);
      const endpointToken =
        workspaceId === 'workspace-1'
          ? spec.endpointToken
          : `${spec.endpointToken}-${shortHash(workspaceId)}`;
      const rawKey =
        workspaceId === 'workspace-1'
          ? spec.rawIngestKey
          : `${spec.rawIngestKey}_${shortHash(workspaceId)}`;
      const keyId = deterministicId(workspaceId, `ingest-key:${spec.slug}`, 151 + i);
      const keyHash = hashIngestKey(rawKey);

      const actualIntegrationId = await upsertIntegration(tx, {
        id,
        workspaceId,
        endpointToken,
        signingSecret: spec.signingSecret,
        environment: spec.environment,
        endpoint: spec.endpoint,
      });

      await upsertIngestKey(tx, {
        id: keyId,
        integrationId: actualIntegrationId,
        workspaceId,
        environment: spec.environment,
        keyHash,
        createdAt: new Date('2026-11-08T09:59:00.000Z'),
      });

      integrationIds.set(spec.slug, actualIntegrationId);
      seededIntegrations.push({
        id: actualIntegrationId,
        slug: spec.slug,
        endpoint: spec.endpoint,
        ingestKey: rawKey,
      });
    }

    for (const scenario of SEED_SCENARIOS) {
      const integrationId = integrationIds.get(scenario.integrationSlug);
      if (integrationId === undefined) {
        throw new Error(`Missing seeded integration ${scenario.integrationSlug}`);
      }

      const defaultEventId = deterministicId(
        workspaceId,
        `event:${scenario.scenario}`,
        200 + scenario.index,
      );
      const digest = sha256Hex(`${scenario.scenario}:${scenario.externalEventId}`);

      const eventId = await upsertSeedEvent(tx, {
        id: defaultEventId,
        integrationId,
        workspaceId,
        externalEventId: scenario.externalEventId,
        eventType: scenario.eventType,
        occurredAt: new Date(scenario.occurredAt),
        firstReceivedAt: new Date(scenario.firstReceivedAt),
        traceId: scenario.traceId,
        payloadDigest: digest,
        processingState: scenario.processingState,
      });

      for (const attempt of scenario.attempts) {
        const attemptId = deterministicId(
          workspaceId,
          `attempt:${scenario.scenario}:${attempt.index}`,
          300 + scenario.index * 10 + attempt.index,
        );
        const evidenceId = deterministicId(
          workspaceId,
          `evidence:${scenario.scenario}:${attempt.index}`,
          400 + scenario.index * 10 + attempt.index,
        );
        const outboxId = deterministicId(
          workspaceId,
          `outbox:${scenario.scenario}:${attempt.index}`,
          500 + scenario.index * 10 + attempt.index,
        );
        const correlationId = deterministicId(
          workspaceId,
          `correlation:${scenario.scenario}:${attempt.index}`,
          600 + scenario.index * 10 + attempt.index,
        );
        const receivedAt = new Date(attempt.receivedAt);

        await upsertSeedAttempt(tx, {
          id: attemptId,
          eventId,
          integrationId,
          workspaceId,
          receivedAt,
          httpStatus: attempt.httpStatus,
          durationMs: attempt.durationMs,
          senderWaitMs: attempt.senderWaitMs,
          verificationState: attempt.verificationState,
          handlerState: attempt.handlerState,
          errorCode: attempt.errorCode,
          correlationId,
        });

        await upsertSeedEvidence(tx, {
          id: evidenceId,
          workspaceId,
          sourceRecordId: attemptId,
          summary: attempt.evidenceSummary,
          sha256Digest: sha256Hex(`${attemptId}:${attempt.evidenceSummary}`),
        });

        await upsertSeedOutbox(tx, {
          id: outboxId,
          eventId,
          attemptId,
          enqueuedAt: receivedAt,
        });
      }

      seededScenarios.push({
        scenario: scenario.scenario,
        eventId,
        externalEventId: scenario.externalEventId,
        expectedFailureClass: scenario.expectedFailureClass,
      });
    }
  });

  for (const scenario of seededScenarios) {
    await classifyJob(scenario.eventId);
  }

  const seededEventIds = new Set(seededScenarios.map((item) => item.eventId));
  const incidentLinks = (await db.orm.public.IncidentEvent.all()).filter((row) =>
    seededEventIds.has(row.eventId),
  );
  const seededIncidentIds = new Set(incidentLinks.map((row) => row.incidentId));

  const incidents = (await db.orm.public.Incident.all())
    .filter((row) => row.workspaceId === workspaceId && seededIncidentIds.has(row.id))
    .sort(
      (left, right) =>
        left.firstSeenAt.getTime() - right.firstSeenAt.getTime() ||
        left.id.localeCompare(right.id),
    );

  return {
    workspaceId,
    integrations: seededIntegrations,
    scenarios: seededScenarios,
    incidentIds: incidents.map((row) => row.id),
  };
}

async function upsertIntegration(
  tx: Tx,
  input: {
    id: string;
    workspaceId: string;
    endpointToken: string;
    signingSecret: string;
    environment: string;
    endpoint: string;
  },
): Promise<string> {
  await tx.query(
    tx.raw.sql`
      INSERT INTO integrations (
        id, workspace_id, endpoint_token, signing_secret, environment, endpoint
      )
      VALUES (
        ${input.id},
        ${input.workspaceId},
        ${input.endpointToken},
        ${input.signingSecret},
        ${input.environment},
        ${input.endpoint}
      )
      ON CONFLICT (endpoint_token) DO NOTHING
    `
      .affectedCount()
      .build(),
  );
  const existing = await tx.orm.public.Integration.where({
    endpointToken: input.endpointToken,
  }).first();
  if (existing === null) {
    throw new Error(`Missing integration for ${input.endpointToken}`);
  }
  return existing.id;
}

async function upsertIngestKey(
  tx: Tx,
  input: {
    id: string;
    integrationId: string;
    workspaceId: string;
    environment: string;
    keyHash: string;
    createdAt: Date;
  },
): Promise<void> {
  const existingByHash = await tx.orm.public.IngestKey.where({
    keyHash: input.keyHash,
  }).first();
  if (existingByHash !== null) {
    return;
  }

  await tx.query(
    tx.raw.sql`
      INSERT INTO ingest_keys (
        id, integration_id, workspace_id, environment, key_hash, created_at, revoked_at
      )
      VALUES (
        ${input.id},
        ${input.integrationId},
        ${input.workspaceId},
        ${input.environment},
        ${input.keyHash},
        CAST(${input.createdAt.toISOString()} AS timestamptz),
        NULL
      )
      ON CONFLICT (id) DO UPDATE SET
        integration_id = EXCLUDED.integration_id,
        workspace_id = EXCLUDED.workspace_id,
        environment = EXCLUDED.environment,
        key_hash = EXCLUDED.key_hash,
        revoked_at = NULL
    `
      .affectedCount()
      .build(),
  );
}

async function upsertSeedEvent(
  tx: Tx,
  input: {
    id: string;
    integrationId: string;
    workspaceId: string;
    externalEventId: string;
    eventType: string;
    occurredAt: Date;
    firstReceivedAt: Date;
    traceId: string;
    payloadDigest: string;
    processingState: ProcessingState;
  },
): Promise<string> {
  const inserted = await tx.query(
    tx.raw.sql`
      INSERT INTO webhook_events (
        id,
        integration_id,
        external_event_id,
        event_type,
        occurred_at,
        first_received_at,
        trace_id,
        payload_digest,
        processing_state,
        workspace_id
      )
      VALUES (
        ${input.id},
        ${input.integrationId},
        ${sqlText(input.externalEventId)},
        ${sqlText(input.eventType)},
        CAST(${sqlTimestamp(input.occurredAt)} AS timestamptz),
        CAST(${input.firstReceivedAt.toISOString()} AS timestamptz),
        ${sqlText(input.traceId)},
        ${input.payloadDigest},
        CAST(${input.processingState} AS "ProcessingState"),
        ${input.workspaceId}
      )
      ON CONFLICT (integration_id, external_event_id) DO NOTHING
      RETURNING id
    `
      .returnsRow({ id: 'pg/text@1' })
      .build(),
  );
  if (inserted[0] !== undefined) {
    return inserted[0].id;
  }
  const existing = await tx.orm.public.WebhookEvent.where({
    integrationId: input.integrationId,
    externalEventId: input.externalEventId,
  }).first();
  if (existing === null) {
    throw new Error(`Missing seeded event ${input.externalEventId}`);
  }
  return existing.id;
}

async function upsertSeedAttempt(
  tx: Tx,
  input: {
    id: string;
    eventId: string;
    integrationId: string;
    workspaceId: string;
    receivedAt: Date;
    httpStatus: number | null;
    durationMs: number | null;
    senderWaitMs: number | null;
    verificationState: Exclude<VerificationState, 'RECEIVED'>;
    handlerState: HandlerState;
    errorCode: string | null;
    correlationId: string;
  },
): Promise<void> {
  const existing = await tx.orm.public.DeliveryAttempt.where({ id: input.id }).first();
  if (existing !== null) {
    return;
  }
  await tx.orm.public.DeliveryAttempt.create({
    id: input.id,
    eventId: input.eventId,
    integrationId: input.integrationId,
    receivedAt: input.receivedAt,
    httpStatus: input.httpStatus,
    durationMs: input.durationMs,
    senderWaitMs: input.senderWaitMs,
    verificationState: input.verificationState,
    handlerState: input.handlerState,
    errorCode: input.errorCode,
    correlationId: input.correlationId,
    workspaceId: input.workspaceId,
  });
}

async function upsertSeedEvidence(
  tx: Tx,
  input: {
    id: string;
    workspaceId: string;
    sourceRecordId: string;
    summary: string;
    sha256Digest: string;
  },
): Promise<void> {
  const existing = await tx.orm.public.Evidence.where({ id: input.id }).first();
  if (existing !== null) {
    return;
  }
  await tx.orm.public.Evidence.create({
    id: input.id,
    sourceKind: 'DELIVERY_ATTEMPT',
    sourceRecordId: input.sourceRecordId,
    summary: input.summary,
    sha256Digest: input.sha256Digest,
    trustTier: 'A',
    workspaceId: input.workspaceId,
  });
}

async function upsertSeedOutbox(
  tx: Tx,
  input: {
    id: string;
    eventId: string;
    attemptId: string;
    enqueuedAt: Date;
  },
): Promise<void> {
  const existing = await tx.orm.public.Outbox.where({ id: input.id }).first();
  if (existing !== null) {
    return;
  }
  await tx.orm.public.Outbox.create({
    id: input.id,
    eventId: input.eventId,
    attemptId: input.attemptId,
    enqueuedAt: input.enqueuedAt,
  });
}

function deterministicId(workspaceId: string, label: string, numericSuffix: number): string {
  if (workspaceId === 'workspace-1') {
    const suffix = String(numericSuffix).padStart(12, '0');
    return `00000000-0000-4000-8000-${suffix}`;
  }
  const hex = sha256Hex(`${workspaceId}:${label}`);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function shortHash(value: string): string {
  return sha256Hex(value).slice(0, 12);
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
