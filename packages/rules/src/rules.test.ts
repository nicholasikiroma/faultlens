import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DeliveryAttempt, Evidence, IncidentContext, WebhookEvent } from '#domain';
import { FAILURE_CLASSES } from '#domain';
import { evaluateRules, fingerprint, RULES } from './index.ts';

test('RULES ids follow FAILURE_CLASSES', () => {
  assert.equal(RULES.map((rule) => rule.id).join(','), FAILURE_CLASSES.join(','));
});

test('one context returns that failure class and not UNKNOWN', async () => {
  const cases = [
    { id: 'AUTH_FAILURE', attempt: { httpStatus: 401 } },
    { id: 'RATE_LIMIT', attempt: { httpStatus: 429 } },
    { id: 'UPSTREAM_5XX', attempt: { httpStatus: 502 } },
    { id: 'SCHEMA_MISMATCH', attempt: { httpStatus: 400 } },
    { id: 'INVALID_SIGNATURE', attempt: { verificationState: 'REJECTED' as const } },
  ];
  for (const item of cases) {
    const ctx = context({
      attempts: [attempt({ id: 'attempt-1', ...item.attempt })],
      evidence: [evidence('evidence-1', 'attempt-1')],
    });
    const matches = await evaluateRules(ctx);
    assert.deepEqual(
      matches.map((match) => match.failureClass),
      [item.id],
      item.id,
    );
    assert.deepEqual(matches[0]?.evidenceIds, ['evidence-1']);
    assert.equal(matches[0]?.certainty, 'observed');
    assert.equal(matches[0]?.severityHint, undefined);
  }
});

test('two verified deliveries of one external id are a duplicate', async () => {
  const ctx = context({
    event: event({ externalEventId: 'evt-1', payloadDigest: 'abc' }),
    attempts: [
      attempt({ id: 'attempt-1', eventId: 'event-1', verificationState: 'VERIFIED' }),
      attempt({ id: 'attempt-2', eventId: 'event-1', verificationState: 'VERIFIED' }),
    ],
    evidence: [evidence('evidence-1', 'attempt-1'), evidence('evidence-2', 'attempt-2')],
  });
  const matches = await evaluateRules(ctx);
  assert.deepEqual(
    matches.map((match) => match.failureClass),
    ['DUPLICATE_DELIVERY'],
  );
  assert.deepEqual(matches[0]?.evidenceIds, ['evidence-1', 'evidence-2']);
});

test('a conflict attempt is not a duplicate', async () => {
  const ctx = context({
    event: event({ externalEventId: 'evt-1', payloadDigest: 'abc' }),
    attempts: [
      attempt({ id: 'attempt-1', eventId: 'event-1', verificationState: 'VERIFIED' }),
      attempt({
        id: 'attempt-2',
        eventId: 'event-1',
        verificationState: 'VERIFIED',
        errorCode: 'conflict',
      }),
    ],
  });
  const matches = await evaluateRules(ctx);
  assert.deepEqual(
    matches.map((match) => match.failureClass),
    ['UNKNOWN'],
  );
});

test('an empty context is UNKNOWN', async () => {
  const matches = await evaluateRules(context({}));
  assert.deepEqual(
    matches.map((match) => match.failureClass),
    ['UNKNOWN'],
  );
});

test('timeout and out of order stay empty until the context can show them', async () => {
  const ctx = context({
    event: event({ occurredAt: new Date('2026-11-07T00:00:00.000Z') }),
    attempts: [attempt({ id: 'attempt-1', durationMs: 50, httpStatus: null })],
  });
  const matches = await evaluateRules(ctx);
  assert.deepEqual(
    matches.map((match) => match.failureClass),
    ['UNKNOWN'],
  );
});

test('two timeouts for one integration and endpoint share a fingerprint', () => {
  const first = fingerprint({
    integrationId: 'integration-1',
    environment: 'production',
    failureClass: 'NETWORK_TIMEOUT',
    endpoint: '/Hooks/Billing/',
  });
  const second = fingerprint({
    integrationId: 'integration-1',
    environment: 'production',
    failureClass: 'NETWORK_TIMEOUT',
    endpoint: 'hooks/billing',
  });
  const other = fingerprint({
    integrationId: 'integration-1',
    environment: 'production',
    failureClass: 'SCHEMA_MISMATCH',
    endpoint: '/hooks/billing',
  });
  assert.equal(first, second);
  assert.notEqual(first, other);
});

function context(input: {
  event?: WebhookEvent | null;
  attempts?: readonly DeliveryAttempt[];
  evidence?: readonly Evidence[];
}): IncidentContext {
  return {
    integrationId: 'integration-1',
    environment: 'production',
    event: input.event ?? null,
    attempts: input.attempts ?? [],
    evidence: input.evidence ?? [],
  };
}

function event(overrides: Partial<WebhookEvent>): WebhookEvent {
  return {
    id: 'event-1',
    integrationId: 'integration-1',
    externalEventId: null,
    eventType: null,
    occurredAt: null,
    firstReceivedAt: new Date('2026-11-07T00:00:00.000Z'),
    traceId: null,
    payloadDigest: 'digest',
    redactedPayloadJson: null,
    processingState: 'RECEIVED',
    ...overrides,
  };
}

function attempt(overrides: Partial<DeliveryAttempt> & { id: string }): DeliveryAttempt {
  return {
    eventId: 'event-1',
    integrationId: 'integration-1',
    receivedAt: new Date('2026-11-07T00:00:01.000Z'),
    httpStatus: null,
    durationMs: null,
    verificationState: 'VERIFIED',
    handlerState: 'PENDING',
    errorCode: null,
    correlationId: 'correlation-1',
    ...overrides,
  };
}

function evidence(id: string, sourceRecordId: string): Evidence {
  return {
    id,
    sourceKind: 'DELIVERY_ATTEMPT',
    sourceRecordId,
    summary: 'attempt',
    sha256Digest: 'digest',
    trustTier: 'A',
  };
}
