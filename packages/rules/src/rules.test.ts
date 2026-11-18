import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DeliveryAttempt, Evidence, IncidentContext, WebhookEvent } from '#domain';
import { FAILURE_CLASSES, INCIDENT_TRANSITIONS } from '#domain';
import { evaluateRules, fingerprint, RULES } from './index.ts';

test('RULES ids follow FAILURE_CLASSES and incident states are the four statuses', () => {
  assert.ok(FAILURE_CLASSES.join(',').endsWith('UNKNOWN'));
  assert.equal(RULES.map((rule) => rule.id).join(','), FAILURE_CLASSES.join(','));
  assert.equal(
    Object.keys(INCIDENT_TRANSITIONS).join(','),
    'OPEN,INVESTIGATING,RESOLVED,ARCHIVED',
  );
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

test('a timeout requires both stored durations and cites its attempt evidence', async () => {
  const missingSenderWait = context({
    attempts: [attempt({ id: 'attempt-1', durationMs: 50 })],
  });
  assert.deepEqual(
    (await evaluateRules(missingSenderWait)).map((match) => match.failureClass),
    ['UNKNOWN'],
  );

  const zeroSenderWait = context({
    attempts: [attempt({ id: 'attempt-1', durationMs: 0, senderWaitMs: 0 })],
  });
  assert.deepEqual(
    (await evaluateRules(zeroSenderWait)).map((match) => match.failureClass),
    ['UNKNOWN'],
  );

  const completedBeforeDeadline = context({
    attempts: [attempt({ id: 'attempt-1', durationMs: 49, senderWaitMs: 50 })],
  });
  assert.deepEqual(
    (await evaluateRules(completedBeforeDeadline)).map((match) => match.failureClass),
    ['UNKNOWN'],
  );

  const timedOut = context({
    attempts: [attempt({ id: 'attempt-1', durationMs: 50, senderWaitMs: 50 })],
    evidence: [evidence('evidence-1', 'attempt-1')],
  });
  const matches = await evaluateRules(timedOut);
  assert.deepEqual(
    matches.map((match) => match.failureClass),
    ['NETWORK_TIMEOUT'],
  );
  assert.deepEqual(matches[0]?.evidenceIds, ['evidence-1']);
  assert.equal(matches[0]?.certainty, 'inferred');
});

test('out of order stays empty until the context can show arrival order across events', async () => {
  const ctx = context({
    event: event({ occurredAt: new Date('2026-11-07T00:00:00.000Z') }),
    attempts: [attempt({ id: 'attempt-1', httpStatus: null })],
  });
  const matches = await evaluateRules(ctx);
  assert.deepEqual(
    matches.map((match) => match.failureClass),
    ['UNKNOWN'],
  );
});

test('out of order triggers when peerEvents show newer occurredAt arrived earlier or FlightRecorder observed it', async () => {
  const olderEvent = event({
    id: 'event-late',
    eventType: 'subscription.updated',
    occurredAt: new Date('2026-11-07T00:00:00.000Z'),
    firstReceivedAt: new Date('2026-11-07T00:00:10.000Z'),
  });
  const newerPeer = event({
    id: 'event-early',
    eventType: 'subscription.updated',
    occurredAt: new Date('2026-11-07T00:00:05.000Z'),
    firstReceivedAt: new Date('2026-11-07T00:00:06.000Z'),
  });

  const multiMatches = await evaluateRules({
    integrationId: 'integration-1',
    environment: 'production',
    event: olderEvent,
    attempts: [attempt({ id: 'attempt-1', eventId: 'event-late', httpStatus: 200 })],
    evidence: [evidence('evidence-1', 'attempt-1')],
    peerEvents: [newerPeer],
  });
  assert.deepEqual(
    multiMatches.map((m) => m.failureClass),
    ['OUT_OF_ORDER'],
  );
  assert.deepEqual(multiMatches[0]?.evidenceIds, ['evidence-1']);
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

test('runtime FlightRecorder evidence classifies ingress abort, decrypt, downstream network, unhandled, and async escape', async () => {
  const cases: Array<{
    expected: string;
    ev: Evidence;
  }> = [
    {
      expected: 'INGRESS_ABORTED',
      ev: {
        id: 'ev-sock',
        sourceKind: 'SOCKET_TIMING',
        sourceRecordId: 'attempt-1',
        summary: 'Client disconnected early',
        sha256Digest: 'd1',
        trustTier: 'B',
        structuredDataJson: { closeFired: true, writableEndedAtClose: false, eventLoopMaxLagMs: 65 },
      },
    },
    {
      expected: 'DECRYPT_FAILURE',
      ev: {
        id: 'ev-dec',
        sourceKind: 'FLIGHT_RECORDER_EPISODE',
        sourceRecordId: 'event-1',
        summary: 'AES-GCM decrypt failed',
        sha256Digest: 'd2',
        trustTier: 'B',
        structuredDataJson: { encryption: { scheme: 'AES-256-GCM', decryptedOk: false, errorCode: 'BAD_AUTH_TAG' } },
      },
    },
    {
      expected: 'DOWNSTREAM_NETWORK_ERROR',
      ev: {
        id: 'ev-span',
        sourceKind: 'DOWNSTREAM_SPAN',
        sourceRecordId: 'attempt-1',
        summary: 'ECONNREFUSED',
        sha256Digest: 'd3',
        trustTier: 'B',
        structuredDataJson: { subHttpFailureType: 'TCP_REFUSED', errorCode: 'ECONNREFUSED' },
      },
    },
    {
      expected: 'UNHANDLED_EXCEPTION',
      ev: {
        id: 'ev-exc',
        sourceKind: 'HOST_EXCEPTION',
        sourceRecordId: 'attempt-1',
        summary: 'DB pool exhausted',
        sha256Digest: 'd4',
        trustTier: 'B',
        structuredDataJson: { layer: 'CONTROLLER', name: 'Error', escapedAfterResponse: false },
      },
    },
    {
      expected: 'ASYNC_ESCAPE_FAILURE',
      ev: {
        id: 'ev-esc',
        sourceKind: 'HOST_EXCEPTION',
        sourceRecordId: 'attempt-1',
        summary: 'Unhandled rejection after 200',
        sha256Digest: 'd5',
        trustTier: 'B',
        structuredDataJson: { layer: 'UNHANDLED_REJECTION', name: 'Error', escapedAfterResponse: true },
      },
    },
  ];

  for (const item of cases) {
    const matches = await evaluateRules(context({ evidence: [item.ev] }));
    assert.deepEqual(
      matches.map((m) => m.failureClass),
      [item.expected],
      item.expected,
    );
    assert.deepEqual(matches[0]?.evidenceIds, [item.ev.id]);
  }
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
    senderWaitMs: null,
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
