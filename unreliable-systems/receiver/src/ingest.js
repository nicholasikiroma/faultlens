// @ts-check
import { createHash } from 'node:crypto';

/**
 * @typedef {{
 *   query: (sql: string, params?: readonly unknown[]) => Promise<unknown>,
 *   release: (err?: Error) => void,
 * }} DbClient
 */

/**
 * @typedef {{ connect: () => Promise<DbClient> }} DbPool
 */

/**
 * @typedef {{
 *   eventId: string,
 *   type: string,
 *   occurredAt: Date,
 *   data: Record<string, unknown>,
 * }} WebhookEvent
 */

/**
 * @typedef {{
 *   rawBody: Buffer,
 *   senderAttempt: number | null,
 *   receivedAt: Date,
 * }} Delivery
 */

/**
 * @typedef {(
 *   | { outcome: 'stored' | 'duplicate' | 'conflict', eventId: string }
 *   | { outcome: 'invalid', reasons: string[] }
 *   | { outcome: 'unavailable' }
 * )} IngestResult
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const INSERT_EVENT = `INSERT INTO events (event_id, type, occurred_at, data, payload_sha256)
  VALUES ($1, $2, $3, $4::jsonb, $5)
  ON CONFLICT (event_id) DO NOTHING
  RETURNING event_id`;

const INSERT_ATTEMPT = `INSERT INTO delivery_attempts
  (event_id, sender_attempt, payload_sha256, outcome, received_at)
  VALUES ($1, $2, $3, $4, $5)`;

const SELECT_HASH = `SELECT payload_sha256 FROM events WHERE event_id = $1`;

const NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
]);

/**
 * @param {DbPool} pool
 * @param {Delivery} delivery
 * @returns {Promise<IngestResult>}
 */
export async function ingest(pool, delivery) {
  const payloadSha256 = sha256Hex(delivery.rawBody);
  const parsed = parseEvent(delivery.rawBody);

  /** @type {DbClient} */
  let client;
  try {
    client = await pool.connect();
  } catch (err) {
    if (isDbUnavailable(err)) return { outcome: 'unavailable' };
    throw err;
  }

  /** @type {Error | undefined} */
  let dead;
  try {
    await client.query('BEGIN');
    if (!parsed.ok) {
      await client.query(INSERT_ATTEMPT, [
        null,
        delivery.senderAttempt,
        payloadSha256,
        'invalid',
        delivery.receivedAt,
      ]);
      await client.query('COMMIT');
      return { outcome: 'invalid', reasons: parsed.reasons };
    }

    // DO NOTHING, not a prior SELECT. delay-before-commit overlaps two transactions on one event_id.
    const inserted = /** @type {{ rowCount: number | null }} */ (await client.query(INSERT_EVENT, [
      parsed.event.eventId,
      parsed.event.type,
      parsed.event.occurredAt,
      JSON.stringify(parsed.event.data),
      payloadSha256,
    ]));
    /** @type {'stored' | 'duplicate' | 'conflict'} */
    let outcome;
    if ((inserted.rowCount ?? 0) === 1) {
      outcome = 'stored';
    } else {
      const existing = /** @type {{ rows: Array<{ payload_sha256: string }> }} */ (
        await client.query(SELECT_HASH, [parsed.event.eventId])
      );
      const storedHash = existing.rows[0]?.payload_sha256;
      if (storedHash === undefined) throw new Error(`missing event ${parsed.event.eventId}`);
      outcome = storedHash === payloadSha256 ? 'duplicate' : 'conflict';
    }
    await client.query(INSERT_ATTEMPT, [
      parsed.event.eventId,
      delivery.senderAttempt,
      payloadSha256,
      outcome,
      delivery.receivedAt,
    ]);
    await client.query('COMMIT');
    return { outcome, eventId: parsed.event.eventId };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      dead = rollbackErr instanceof Error ? rollbackErr : new Error('rollback failed');
    }
    if (isDbUnavailable(err)) {
      dead = err instanceof Error ? err : new Error('database unavailable');
      return { outcome: 'unavailable' };
    }
    throw err;
  } finally {
    client.release(dead);
  }
}

/**
 * @param {IngestResult} result
 * @returns {{ status: 201 | 200 | 409 | 400 | 503, body: Record<string, unknown> }}
 */
export function replyFor(result) {
  switch (result.outcome) {
    case 'stored':
      return { status: 201, body: { outcome: 'stored', event_id: result.eventId } };
    case 'duplicate':
      return { status: 200, body: { outcome: 'duplicate', event_id: result.eventId } };
    case 'conflict':
      return { status: 409, body: { outcome: 'conflict', event_id: result.eventId } };
    case 'invalid':
      return { status: 400, body: { outcome: 'invalid', reasons: result.reasons } };
    case 'unavailable':
      return { status: 503, body: { outcome: 'unavailable' } };
    default: {
      /** @type {never} */
      const unreachable = result;
      throw new Error(`unhandled outcome ${JSON.stringify(unreachable)}`);
    }
  }
}

/**
 * @param {Buffer} rawBody
 * @returns {{ ok: true, event: WebhookEvent } | { ok: false, reasons: string[] }}
 */
function parseEvent(rawBody) {
  /** @type {unknown} */
  let value;
  try {
    value = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return { ok: false, reasons: ['not_json'] };
  }
  if (!isPlainObject(value)) return { ok: false, reasons: ['not_object'] };

  /** @type {string[]} */
  const reasons = [];
  let eventId = '';
  if (typeof value.event_id === 'string' && UUID.test(value.event_id)) {
    eventId = value.event_id.toLowerCase();
  } else {
    reasons.push('event_id');
  }

  let type = '';
  if (typeof value.type === 'string' && value.type.length > 0) {
    type = value.type;
  } else {
    reasons.push('type');
  }

  /** @type {Date | null} */
  let occurredAt = null;
  if (typeof value.occurred_at === 'string' && Number.isFinite(Date.parse(value.occurred_at))) {
    occurredAt = new Date(value.occurred_at);
  } else {
    reasons.push('occurred_at');
  }

  /** @type {Record<string, unknown> | null} */
  let data = null;
  if (isPlainObject(value.data)) {
    data = value.data;
  } else {
    reasons.push('data');
  }

  if (reasons.length > 0 || occurredAt === null || data === null) {
    return { ok: false, reasons };
  }
  return { ok: true, event: { eventId, type, occurredAt, data } };
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

/**
 * @param {Buffer} bytes
 * @returns {string}
 */
function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * @param {unknown} err
 * @returns {boolean}
 */
function isDbUnavailable(err) {
  if (typeof err !== 'object' || err === null) return false;
  const code = 'code' in err && (typeof err.code === 'string' || typeof err.code === 'number')
    ? String(err.code)
    : '';
  if (NETWORK_CODES.has(code)) return true;
  if (code.startsWith('08') || code === '57P01' || code === '57P02' || code === '57P03') return true;
  const message = 'message' in err && typeof err.message === 'string' ? err.message : '';
  if (
    message.includes('timeout expired')
    || message.includes('Query read timeout')
    || message.includes('Connection terminated')
  ) {
    return true;
  }
  if ('cause' in err && err.cause && err.cause !== err) return isDbUnavailable(err.cause);
  return false;
}
