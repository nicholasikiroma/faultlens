// @ts-check
import http from 'node:http';
import { context, propagation, SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { Pool } from 'pg';
import { ingest, replyFor } from './ingest.js';
import { logEvent, startTracing, tracer } from './tracing.js';

const tracing = startTracing('receiver');
const cfg = loadConfig();

const pool = new Pool({
  connectionString: cfg.databaseUrl,
  connectionTimeoutMillis: cfg.pgConnectTimeoutMs,
  // query_timeout is the same number as the connect timeout so a stuck query fails inside the sender deadline instead of looking like a sender timeout.
  query_timeout: cfg.pgConnectTimeoutMs,
});

// An idle client emits error when Postgres stops. If nobody handles it, the process dies and a database outage becomes a dead receiver.
pool.on('error', (err) => {
  console.error(err);
});

process.on('SIGTERM', () => {
  tracing.shutdown().finally(() => process.exit(0));
});

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error(err);
    if (!res.headersSent) sendJson(res, 500, { outcome: 'error' });
  });
});

server.listen(cfg.port, '0.0.0.0');

/**
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
async function handle(req, res) {
  // The sender may abort while this handler still commits. The late write then hits a closed socket.
  res.on('error', (err) => {
    console.error(err);
  });
  const path = (req.url ?? '').split('?')[0];
  if (req.method === 'GET' && path === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
    return;
  }
  if (req.method !== 'POST' || path !== '/webhooks') {
    res.writeHead(404).end();
    return;
  }

  const parent = propagation.extract(context.active(), req.headers);
  await tracer().startActiveSpan('POST /webhooks', {
    kind: SpanKind.SERVER,
    attributes: {
      'http.request.method': 'POST',
      'url.path': '/webhooks',
    },
  }, parent, async (span) => {
    const receivedAt = new Date();
    try {
      const rawBody = await readBody(req);
      const fault = parseFault(req.headers['x-lab-fault']);
      const senderAttempt = readAttempt(req.headers['x-delivery-attempt']);
      if (senderAttempt !== null) span.setAttribute('webhook.attempt', senderAttempt);
      if (fault !== null) span.setAttribute('lab.fault', fault);
      if (fault === 'unknown') {
        sendJson(res, 400, { outcome: 'invalid', reasons: ['unknown_fault'] });
        logEvent(span, { msg: 'webhook handled', attempt: senderAttempt, http_status: 400, outcome: 'invalid' });
        return;
      }
      if (fault === 'delay-before-commit') await sleep(cfg.faultDelayMs);
      const result = await ingest(pool, { rawBody, senderAttempt, receivedAt });
      if (fault === 'hold-after-commit') await sleep(cfg.faultDelayMs);
      const reply = replyFor(result);
      if ('eventId' in result && result.eventId) span.setAttribute('webhook.event_id', result.eventId);
      span.setAttribute('http.response.status_code', reply.status);
      span.setAttribute('webhook.outcome', result.outcome);
      if (reply.status >= 500) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: result.outcome });
      }
      logEvent(span, {
        msg: 'webhook handled',
        attempt: senderAttempt,
        http_status: reply.status,
        outcome: result.outcome,
        fault: fault ?? undefined,
      });
      sendJson(res, reply.status, reply.body);
    } catch (err) {
      span.recordException(err instanceof Error ? err : new Error('webhook failed'));
      span.setStatus({ code: SpanStatusCode.ERROR });
      console.error(err);
      if (!res.headersSent) sendJson(res, 500, { outcome: 'error' });
    } finally {
      span.end();
    }
  });
}

/**
 * @param {string | string[] | undefined} header
 * @returns {'delay-before-commit' | 'hold-after-commit' | 'unknown' | null}
 */
function parseFault(header) {
  if (header === undefined) return null;
  if (header === 'delay-before-commit' || header === 'hold-after-commit') return header;
  return 'unknown';
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * @returns {{ port: number, databaseUrl: string, faultDelayMs: number, pgConnectTimeoutMs: number }}
 */
function loadConfig() {
  const port = positiveInt('PORT');
  const databaseUrl = required('DATABASE_URL');
  const faultDelayMs = positiveInt('FAULT_DELAY_MS');
  const sendTimeoutMs = positiveInt('SEND_TIMEOUT_MS');
  const pgConnectTimeoutMs = positiveInt('PG_CONNECT_TIMEOUT_MS');
  if (!(faultDelayMs > sendTimeoutMs && sendTimeoutMs > pgConnectTimeoutMs)) {
    throw new Error('FAULT_DELAY_MS > SEND_TIMEOUT_MS > PG_CONNECT_TIMEOUT_MS is required');
  }
  return { port, databaseUrl, faultDelayMs, pgConnectTimeoutMs };
}

/**
 * @param {string} name
 * @returns {string}
 */
function required(name) {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`missing ${name}`);
  return value;
}

/**
 * @param {string} name
 * @returns {number}
 */
function positiveInt(name) {
  const raw = required(name);
  if (!/^[1-9]\d*$/.test(raw)) throw new Error(`${name} must be a positive integer`);
  const n = Number(raw);
  if (!Number.isSafeInteger(n)) throw new Error(`${name} must be a positive integer`);
  return n;
}

/**
 * @param {string | string[] | undefined} header
 * @returns {number | null}
 */
function readAttempt(header) {
  if (typeof header !== 'string' || !/^[1-9]\d*$/.test(header)) return null;
  const n = Number(header);
  if (!Number.isSafeInteger(n)) return null;
  return n;
}

/**
 * @param {http.IncomingMessage} req
 * @returns {Promise<Buffer>}
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    req.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * @param {http.ServerResponse} res
 * @param {number} status
 * @param {Record<string, unknown>} body
 */
function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}
