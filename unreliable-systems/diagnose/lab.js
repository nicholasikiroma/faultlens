// @ts-check
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { diagnose } from './diagnose.js';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('..', import.meta.url));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;

/**
 * @param {unknown} senderReport
 * @returns {Promise<import('./diagnose.js').Report>}
 */
export async function investigate(senderReport) {
  const sends = parseSends(senderReport);
  const rows = await readRows(sends);
  return diagnose({ sends, rows });
}

/**
 * @param {unknown} senderReport
 * @returns {import('./diagnose.js').Send[]}
 */
function parseSends(senderReport) {
  if (!isPlainObject(senderReport) || !Array.isArray(senderReport.sends)) throw new TypeError('sends');
  return senderReport.sends.map((send, index) => parseSend(send, index));
}

/**
 * @param {unknown} value
 * @param {number} index
 * @returns {import('./diagnose.js').Send}
 */
function parseSend(value, index) {
  const path = `sends[${index}]`;
  if (!isPlainObject(value)) throw new TypeError(path);
  if (!Array.isArray(value.attempts) || value.attempts.length === 0) throw new TypeError(`${path}.attempts`);
  return {
    index: index + 1,
    eventId: parseEventId(value.eventId, `${path}.eventId`),
    payloadSha256: parseHash(value.payloadSha256, `${path}.payloadSha256`),
    verdict: parseVerdict(value.verdict, `${path}.verdict`),
    traceId: parseTraceId(value.traceId, `${path}.traceId`),
    attempts: value.attempts.map((attempt, attemptIndex) => parseAttempt(attempt, `${path}.attempts[${attemptIndex}]`)),
  };
}

/**
 * @param {unknown} value
 * @param {string} path
 * @returns {string | null}
 */
function parseEventId(value, path) {
  if (value === null) return null;
  if (typeof value === 'string' && UUID.test(value)) return value;
  throw new TypeError(path);
}

/**
 * @param {unknown} value
 * @param {string} path
 * @returns {string}
 */
function parseHash(value, path) {
  if (typeof value === 'string' && HASH.test(value)) return value;
  throw new TypeError(path);
}

/**
 * @param {unknown} value
 * @param {string} path
 * @returns {'acked' | 'rejected' | 'gave-up'}
 */
function parseVerdict(value, path) {
  switch (value) {
    case 'acked':
    case 'rejected':
    case 'gave-up':
      return value;
    default:
      throw new TypeError(path);
  }
}

/**
 * @param {unknown} value
 * @param {string} path
 * @returns {string}
 */
function parseTraceId(value, path) {
  if (typeof value !== 'string' || value === '') throw new TypeError(path);
  return value;
}

/**
 * @param {unknown} value
 * @param {string} path
 * @returns {import('./diagnose.js').Attempt}
 */
function parseAttempt(value, path) {
  if (!isPlainObject(value)) throw new TypeError(path);
  const n = parseInteger(value.n, `${path}.n`);
  if (n < 1) throw new TypeError(`${path}.n`);
  if (typeof value.elapsedMs !== 'number' || !Number.isFinite(value.elapsedMs) || value.elapsedMs < 0) {
    throw new TypeError(`${path}.elapsedMs`);
  }
  return { n, elapsedMs: value.elapsedMs, observed: parseObserved(value.observed, `${path}.observed`) };
}

/**
 * @param {unknown} value
 * @param {string} path
 * @returns {import('./diagnose.js').Observation}
 */
function parseObserved(value, path) {
  if (!isPlainObject(value)) throw new TypeError(path);
  switch (value.kind) {
    case 'response': {
      const status = parseInteger(value.status, `${path}.status`);
      if (value.outcome !== null && typeof value.outcome !== 'string') throw new TypeError(`${path}.outcome`);
      return { kind: 'response', status, outcome: value.outcome };
    }
    case 'timeout':
      return { kind: 'timeout' };
    case 'unreachable':
      if (typeof value.code !== 'string' || value.code === '') throw new TypeError(`${path}.code`);
      return { kind: 'unreachable', code: value.code };
    default:
      throw new TypeError(`${path}.kind`);
  }
}

/**
 * @param {unknown} value
 * @param {string} path
 * @returns {number}
 */
function parseInteger(value, path) {
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new TypeError(path);
  return value;
}

/**
 * @param {import('./diagnose.js').Send[]} sends
 * @returns {Promise<import('./diagnose.js').AttemptRow[]>}
 */
async function readRows(sends) {
  const stdout = await compose(
    'exec',
    '-T',
    'postgres',
    'psql',
    '-U',
    'lab',
    '-d',
    'lab',
    '-A',
    '-F',
    ',',
    '-t',
    '-c',
    queryFor(sends),
  );
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map(parseLine);
}

/**
 * @param {import('./diagnose.js').Send[]} sends
 * @returns {string}
 */
function queryFor(sends) {
  /** @type {string[]} */
  const eventIds = [];
  /** @type {string[]} */
  const nullHashes = [];
  const seenEvents = new Set();
  const seenHashes = new Set();
  for (const send of sends) {
    if (send.eventId === null) {
      if (seenHashes.has(send.payloadSha256)) continue;
      seenHashes.add(send.payloadSha256);
      nullHashes.push(send.payloadSha256);
    } else if (!seenEvents.has(send.eventId)) {
      seenEvents.add(send.eventId);
      eventIds.push(send.eventId);
    }
  }
  /** @type {string[]} */
  const clauses = [];
  if (eventIds.length > 0) clauses.push(`event_id IN (${eventIds.map(quoteEventId).join(', ')})`);
  if (nullHashes.length > 0) {
    clauses.push(`(event_id IS NULL AND payload_sha256 IN (${nullHashes.map(quoteHash).join(', ')}))`);
  }
  const where = clauses.length === 0 ? 'FALSE' : clauses.join(' OR ');
  return [
    'SELECT id, event_id, sender_attempt, payload_sha256, outcome,',
    '(floor(extract(epoch from received_at) * 1000))::bigint,',
    '(floor(extract(epoch from recorded_at) * 1000))::bigint',
    'FROM delivery_attempts',
    `WHERE ${where}`,
    'ORDER BY recorded_at, id',
  ].join(' ');
}

/**
 * @param {string} eventId
 * @returns {string}
 */
function quoteEventId(eventId) {
  if (!UUID.test(eventId)) throw new Error(`refusing to interpolate event id ${eventId}`);
  return `'${eventId}'`;
}

/**
 * @param {string} hash
 * @returns {string}
 */
function quoteHash(hash) {
  if (!HASH.test(hash)) throw new Error(`refusing to interpolate hash ${hash}`);
  return `'${hash}'`;
}

/**
 * @param {string[]} args
 * @returns {Promise<string>}
 */
async function compose(...args) {
  const { stdout } = await exec('docker', ['compose', ...args], {
    cwd: root,
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout;
}

/**
 * @param {string} line
 * @returns {import('./diagnose.js').AttemptRow}
 */
function parseLine(line) {
  const fields = line.split(',').map((field) => field.trim());
  if (fields.length !== 7) throw new Error(`unexpected delivery row ${JSON.stringify(line)}`);
  const [idText, eventText, attemptText, payloadSha256, outcomeText, receivedText, recordedText] = fields;
  const id = parseDbInteger(idText, 'id');
  const eventId = eventText === '' ? null : eventText;
  const senderAttempt = attemptText === '' ? null : parseDbInteger(attemptText, 'sender_attempt');
  if (!HASH.test(payloadSha256)) throw new Error(`row ${id} hash ${payloadSha256}`);
  const outcome = parseDbOutcome(outcomeText, eventId, id);
  return {
    id,
    eventId,
    senderAttempt,
    payloadSha256,
    outcome,
    receivedAtMs: parseDbInteger(receivedText, 'received_at'),
    recordedAtMs: parseDbInteger(recordedText, 'recorded_at'),
  };
}

/**
 * @param {string} outcome
 * @param {string | null} eventId
 * @param {number} id
 * @returns {import('./diagnose.js').RowOutcome}
 */
function parseDbOutcome(outcome, eventId, id) {
  switch (outcome) {
    case 'stored':
    case 'duplicate':
    case 'conflict':
      if (eventId === null) throw new Error(`row ${id} ${outcome} has no event`);
      return outcome;
    case 'invalid':
      if (eventId !== null) throw new Error(`row ${id} invalid has event ${eventId}`);
      return outcome;
    default:
      throw new Error(`unknown outcome ${outcome}`);
  }
}

/**
 * @param {string | undefined} value
 * @param {string} column
 * @returns {number}
 */
function parseDbInteger(value, column) {
  if (value === undefined || !/^\d+$/.test(value)) throw new Error(`bad ${column} ${value}`);
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error(`bad ${column} ${value}`);
  return number;
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
