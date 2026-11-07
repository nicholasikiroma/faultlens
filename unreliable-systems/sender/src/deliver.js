// @ts-check
import { createHash } from 'node:crypto';
import { context, propagation, SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { logEvent, tracer } from './tracing.js';

/**
 * @typedef {{ kind: 'response', status: number, outcome: string | null }} ResponseObservation
 * @typedef {{ kind: 'timeout' }} TimeoutObservation
 * @typedef {{ kind: 'unreachable', code: string }} UnreachableObservation
 * @typedef {ResponseObservation | TimeoutObservation | UnreachableObservation} Observation
 * @typedef {'acked' | 'rejected' | 'gave-up'} Verdict
 * @typedef {'delay-before-commit' | 'hold-after-commit'} Fault
 * @typedef {{ n: number, elapsedMs: number, observed: Observation }} Attempt
 * @typedef {{
 *   payloadSha256: string,
 *   attempts: Attempt[],
 *   verdict: Verdict,
 *   lastInjectedStartedAt: number | null,
 * }} DeliveryCore
 * @typedef {DeliveryCore & { traceId: string }} DeliveryResult
 */

export const RETRY_DELAYS_MS = [500, 1000, 2000, 4000, 8000, 16000];

/**
 * @param {Buffer} bytes
 * @param {{ url: string, timeoutMs: number, faults?: (Fault | null)[], retryDelaysMs?: number[] }} opts
 * @returns {Promise<DeliveryResult>}
 */
export async function deliver(bytes, opts) {
  const eventId = eventIdOf(bytes);
  return tracer().startActiveSpan('webhook.deliver', { kind: SpanKind.INTERNAL }, async (root) => {
    if (eventId !== null) root.setAttribute('webhook.event_id', eventId);
    try {
      const result = await runAttempts(bytes, opts, eventId);
      root.setAttribute('webhook.verdict', result.verdict);
      return { ...result, traceId: root.spanContext().traceId };
    } finally {
      root.end();
    }
  });
}

/**
 * @param {Buffer} bytes
 * @param {{ url: string, timeoutMs: number, faults?: (Fault | null)[], retryDelaysMs?: number[] }} opts
 * @param {string | null} eventId
 * @returns {Promise<DeliveryCore>}
 */
async function runAttempts(bytes, opts, eventId) {
  const retryDelays = opts.retryDelaysMs ?? RETRY_DELAYS_MS;
  const faults = opts.faults ?? [];
  const payloadSha256 = createHash('sha256').update(bytes).digest('hex');
  /** @type {Attempt[]} */
  const attempts = [];
  /** @type {number | null} */
  let lastInjectedStartedAt = null;

  for (let index = 0; index <= retryDelays.length; index += 1) {
    const n = index + 1;
    const fault = faults[index] ?? null;
    const started = Date.now();
    if (fault !== null) lastInjectedStartedAt = started;
    const observed = await postOnce(bytes, opts.url, opts.timeoutMs, n, fault, eventId);
    attempts.push({ n, elapsedMs: Date.now() - started, observed });
    const decision = decide(observed);
    if (decision === 'acked' || decision === 'rejected') {
      return { payloadSha256, attempts, verdict: decision, lastInjectedStartedAt };
    }
    if (index === retryDelays.length) break;
    await sleep(retryDelays[index]);
  }

  return { payloadSha256, attempts, verdict: 'gave-up', lastInjectedStartedAt };
}

/**
 * @param {Buffer} bytes
 * @param {string} url
 * @param {number} timeoutMs
 * @param {number} n
 * @param {Fault | null} fault
 * @param {string | null} eventId
 * @returns {Promise<Observation>}
 */
function postOnce(bytes, url, timeoutMs, n, fault, eventId) {
  return tracer().startActiveSpan('POST', {
    kind: SpanKind.CLIENT,
    attributes: {
      'http.request.method': 'POST',
      'url.path': '/webhooks',
      'webhook.attempt': n,
    },
  }, async (span) => {
    if (eventId !== null) span.setAttribute('webhook.event_id', eventId);
    /** @type {Record<string, string>} */
    const headers = {
      'content-type': 'application/json',
      'x-delivery-attempt': String(n),
    };
    if (fault !== null) headers['x-lab-fault'] = fault;
    propagation.inject(context.active(), headers);
    /** @type {Observation} */
    let observed;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: bytes,
        signal: AbortSignal.timeout(timeoutMs),
      });
      observed = await observeResponse(res);
    } catch (err) {
      observed = observeFailure(err);
    }
    if (observed.kind === 'response') {
      span.setAttribute('http.response.status_code', observed.status);
      if (observed.outcome !== null) span.setAttribute('webhook.outcome', observed.outcome);
    }
    if (isAttemptError(observed)) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: observed.kind === 'response' ? String(observed.status) : observed.kind,
      });
    }
    logEvent(span, {
      msg: 'webhook attempt finished',
      attempt: n,
      observation: observed.kind,
      http_status: observed.kind === 'response' ? observed.status : undefined,
      outcome: observed.kind === 'response' ? observed.outcome : undefined,
    });
    span.end();
    return observed;
  });
}

/**
 * @param {Observation} observed
 * @returns {boolean}
 */
function isAttemptError(observed) {
  if (observed.kind === 'timeout' || observed.kind === 'unreachable') return true;
  return observed.kind === 'response' && observed.status >= 500;
}

/**
 * @param {Buffer} bytes
 * @returns {string | null}
 */
function eventIdOf(bytes) {
  try {
    const value = JSON.parse(bytes.toString('utf8'));
    if (isPlainObject(value) && typeof value.event_id === 'string') return value.event_id;
  } catch {
    return null;
  }
  return null;
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
 * @param {Response} res
 * @returns {Promise<ResponseObservation>}
 */
async function observeResponse(res) {
  let outcome = null;
  const text = await res.text();
  if (text !== '') {
    try {
      const parsed = JSON.parse(text);
      if (isPlainObject(parsed) && typeof parsed.outcome === 'string') outcome = parsed.outcome;
    } catch {
      outcome = null;
    }
  }
  return { kind: 'response', status: res.status, outcome };
}

/**
 * @param {unknown} err
 * @returns {TimeoutObservation | UnreachableObservation}
 */
function observeFailure(err) {
  if (isTimeout(err)) return { kind: 'timeout' };
  return { kind: 'unreachable', code: errorCode(err) };
}

/**
 * @param {Observation} observed
 * @returns {'acked' | 'rejected' | 'retry'}
 */
function decide(observed) {
  switch (observed.kind) {
    case 'response':
      if (observed.status >= 200 && observed.status < 300) return 'acked';
      if (observed.status === 408 || observed.status === 429 || observed.status >= 500) return 'retry';
      return 'rejected';
    case 'timeout':
    case 'unreachable':
      return 'retry';
    default: {
      /** @type {never} */
      const unreachable = observed;
      throw new Error(`unhandled observation ${JSON.stringify(unreachable)}`);
    }
  }
}

/**
 * @param {unknown} err
 * @returns {boolean}
 */
function isTimeout(err) {
  if (typeof err !== 'object' || err === null) return false;
  if ('name' in err && err.name === 'TimeoutError') return true;
  if ('cause' in err && err.cause && err.cause !== err) return isTimeout(err.cause);
  return false;
}

/**
 * @param {unknown} err
 * @returns {string}
 */
function errorCode(err) {
  if (typeof err !== 'object' || err === null) return 'UNKNOWN';
  if ('cause' in err && err.cause && err.cause !== err) {
    const nested = errorCode(err.cause);
    if (nested !== 'UNKNOWN') return nested;
  }
  if ('code' in err && typeof err.code === 'string' && err.code !== '') return err.code;
  if ('name' in err && typeof err.name === 'string' && err.name !== '') return err.name;
  return 'UNKNOWN';
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
