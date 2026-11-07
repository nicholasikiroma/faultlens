// @ts-check
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { diagnose } from './diagnose.js';

const eventId = '11111111-1111-4111-8111-111111111111';
const hash = 'a'.repeat(64);
const otherHash = 'b'.repeat(64);
const traceId = 'c'.repeat(32);
const otherTraceId = 'd'.repeat(32);

describe('diagnose', () => {
  it('names a timeout recorded before the sender gave up', () => {
    const report = diagnose(timeoutAfterCommit());
    assert.deepEqual(patterns(report), ['timeout']);
    const finding = report.findings[0];
    if (finding === undefined || finding.pattern !== 'timeout') assert.fail('expected a timeout');
    assert.equal(finding.commit.kind, 'before-give-up');
    assert.deepEqual(report.unexplained, []);
  });

  it('names a timeout recorded after the sender gave up', () => {
    const report = diagnose(timeoutBeforeCommit());
    assert.deepEqual(patterns(report), ['timeout']);
    const finding = report.findings[0];
    if (finding === undefined || finding.pattern !== 'timeout') assert.fail('expected a timeout');
    assert.equal(finding.commit.kind, 'after-give-up');
    assert.deepEqual(report.unexplained, []);
  });

  it('names a validation error when the invalid attempt has a row', () => {
    const report = diagnose(invalidDelivery());
    assert.deepEqual(patterns(report), ['validation-error']);
    assert.deepEqual(report.unexplained, []);
  });

  it('leaves a 400 with no row unexplained', () => {
    const report = diagnose(invalidWithoutRow());
    assert.deepEqual(patterns(report), []);
    assert.deepEqual(unexplainedAttempts(report), [{ kind: 'attempt', send: 1, attempt: 1 }]);
  });

  it('names a duplicate delivery across two sends', () => {
    const report = diagnose(duplicateDelivery());
    assert.deepEqual(patterns(report), ['duplicate-delivery']);
    assert.deepEqual(report.unexplained, []);
  });

  it('leaves a conflicting hash unexplained', () => {
    const report = diagnose(conflictDelivery());
    assert.deepEqual(patterns(report), []);
    assert.deepEqual(unexplainedAttempts(report), [{ kind: 'attempt', send: 2, attempt: 1 }]);
  });

  it('reports a clean delivery with nothing unexplained', () => {
    const report = diagnose(happyDelivery());
    assert.deepEqual(patterns(report), []);
    assert.deepEqual(report.unexplained, []);
  });

  it('leaves the timeout unrecorded when a stored response already owns the row', () => {
    const report = diagnose(timeoutLosingTheStoredRow());
    assert.deepEqual(patterns(report), ['timeout']);
    const finding = report.findings[0];
    if (finding === undefined || finding.pattern !== 'timeout') assert.fail('expected a timeout');
    assert.equal(finding.commit.kind, 'not-recorded');
    assert.deepEqual(report.unexplained, []);
  });
});

/**
 * @param {import('./diagnose.js').Report} report
 * @returns {string[]}
 */
function patterns(report) {
  return report.findings.map((finding) => finding.pattern);
}

/**
 * @param {import('./diagnose.js').Report} report
 * @returns {Array<{ kind: 'attempt', send: number, attempt: number } | { kind: 'orphan', rowId: number }>}
 */
function unexplainedAttempts(report) {
  return report.unexplained.map((item) => {
    switch (item.kind) {
      case 'attempt':
        return { kind: 'attempt', send: item.at.send, attempt: item.at.attempt };
      case 'orphan':
        return { kind: 'orphan', rowId: item.row.id };
      default: {
        /** @type {never} */
        const unreachable = item;
        throw new Error(`unhandled unexplained ${JSON.stringify(unreachable)}`);
      }
    }
  });
}

function timeoutAfterCommit() {
  return {
    sends: [
      send(1, eventId, hash, 'acked', traceId, [
        { n: 1, elapsedMs: 2004, observed: { kind: 'timeout' } },
        { n: 2, elapsedMs: 20, observed: { kind: 'response', status: 200, outcome: 'duplicate' } },
      ]),
    ],
    rows: [
      attemptRow(1, eventId, 1, hash, 'stored', 1_000, 1_048),
      attemptRow(2, eventId, 2, hash, 'duplicate', 3_000, 3_012),
    ],
  };
}

function timeoutBeforeCommit() {
  return {
    sends: [
      send(1, eventId, hash, 'acked', traceId, [
        { n: 1, elapsedMs: 2003, observed: { kind: 'timeout' } },
        { n: 2, elapsedMs: 25, observed: { kind: 'response', status: 201, outcome: 'stored' } },
      ]),
    ],
    rows: [
      attemptRow(1, eventId, 2, hash, 'stored', 5_000, 5_030),
      attemptRow(2, eventId, 1, hash, 'duplicate', 1_000, 6_010),
    ],
  };
}

function invalidDelivery() {
  return {
    sends: [
      send(1, null, hash, 'rejected', traceId, [
        { n: 1, elapsedMs: 12, observed: { kind: 'response', status: 400, outcome: 'invalid' } },
      ]),
    ],
    rows: [
      attemptRow(1, null, 1, hash, 'invalid', 100, 110),
    ],
  };
}

function invalidWithoutRow() {
  return {
    sends: [
      send(1, null, hash, 'rejected', traceId, [
        { n: 1, elapsedMs: 12, observed: { kind: 'response', status: 400, outcome: 'invalid' } },
      ]),
    ],
    rows: [],
  };
}

function duplicateDelivery() {
  return {
    sends: [
      send(1, eventId, hash, 'acked', traceId, [
        { n: 1, elapsedMs: 18, observed: { kind: 'response', status: 201, outcome: 'stored' } },
      ]),
      send(2, eventId, hash, 'acked', otherTraceId, [
        { n: 1, elapsedMs: 16, observed: { kind: 'response', status: 200, outcome: 'duplicate' } },
      ]),
    ],
    rows: [
      attemptRow(1, eventId, 1, hash, 'stored', 1_000, 1_020),
      attemptRow(2, eventId, 1, hash, 'duplicate', 2_000, 2_010),
    ],
  };
}

function conflictDelivery() {
  return {
    sends: [
      send(1, eventId, hash, 'acked', traceId, [
        { n: 1, elapsedMs: 18, observed: { kind: 'response', status: 201, outcome: 'stored' } },
      ]),
      send(2, eventId, otherHash, 'rejected', otherTraceId, [
        { n: 1, elapsedMs: 14, observed: { kind: 'response', status: 409, outcome: 'conflict' } },
      ]),
    ],
    rows: [
      attemptRow(1, eventId, 1, hash, 'stored', 1_000, 1_020),
      attemptRow(2, eventId, 1, otherHash, 'conflict', 2_000, 2_010),
    ],
  };
}

function happyDelivery() {
  return {
    sends: [
      send(1, eventId, hash, 'acked', traceId, [
        { n: 1, elapsedMs: 15, observed: { kind: 'response', status: 201, outcome: 'stored' } },
      ]),
    ],
    rows: [
      attemptRow(1, eventId, 1, hash, 'stored', 1_000, 1_020),
    ],
  };
}

function timeoutLosingTheStoredRow() {
  return {
    sends: [
      send(1, eventId, hash, 'gave-up', traceId, [
        { n: 1, elapsedMs: 2000, observed: { kind: 'timeout' } },
      ]),
      send(2, eventId, hash, 'acked', otherTraceId, [
        { n: 1, elapsedMs: 30, observed: { kind: 'response', status: 201, outcome: 'stored' } },
      ]),
    ],
    rows: [
      attemptRow(1, eventId, 1, hash, 'stored', 1_000, 1_040),
    ],
  };
}

/**
 * @param {number} index
 * @param {string | null} id
 * @param {string} payloadSha256
 * @param {'acked' | 'rejected' | 'gave-up'} verdict
 * @param {string} trace
 * @param {Array<{ n: number, elapsedMs: number, observed: { kind: 'timeout' } | { kind: 'response', status: number, outcome: string | null } }>} attempts
 */
function send(index, id, payloadSha256, verdict, trace, attempts) {
  return {
    index,
    eventId: id,
    payloadSha256,
    verdict,
    traceId: trace,
    attempts,
  };
}

/**
 * @param {number} id
 * @param {string | null} rowEventId
 * @param {number | null} senderAttempt
 * @param {string} payloadSha256
 * @param {'stored' | 'duplicate' | 'conflict' | 'invalid'} outcome
 * @param {number} receivedAtMs
 * @param {number} recordedAtMs
 */
function attemptRow(id, rowEventId, senderAttempt, payloadSha256, outcome, receivedAtMs, recordedAtMs) {
  return {
    id,
    eventId: rowEventId,
    senderAttempt,
    payloadSha256,
    outcome,
    receivedAtMs,
    recordedAtMs,
  };
}
