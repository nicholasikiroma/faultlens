// @ts-check
import { randomUUID } from 'node:crypto';
import { deliver } from './deliver.js';

/**
 * @typedef {{ kind: 'new', key: string, occurredAtOffsetMs?: number }} NewEvent
 * @typedef {{ kind: 'resend', key: string }} ResendEvent
 * @typedef {{ kind: 'mutate', key: string }} MutateEvent
 * @typedef {{ kind: 'invalid', variant: 'not-json' | 'missing-event-id' }} InvalidEvent
 * @typedef {NewEvent | ResendEvent | MutateEvent | InvalidEvent} EventSpec
 * @typedef {{
 *   event: EventSpec,
 *   faults?: ('delay-before-commit' | 'hold-after-commit' | null)[],
 *   copies?: number,
 *   delayBeforeSendMs?: number,
 * }} Step
 * @typedef {{ eventId: string, bytes: Buffer }} BoundEvent
 */

/** @type {Record<string, Step[]>} */
export const SCENARIOS = {
  happy: [{ event: { kind: 'new', key: 'e1' } }],
  duplicate: [
    { event: { kind: 'new', key: 'e1' } },
    { event: { kind: 'resend', key: 'e1' } },
  ],
  conflict: [
    { event: { kind: 'new', key: 'e1' } },
    { event: { kind: 'mutate', key: 'e1' } },
  ],
  'invalid-json': [{ event: { kind: 'invalid', variant: 'not-json' } }],
  'invalid-shape': [{ event: { kind: 'invalid', variant: 'missing-event-id' } }],
  'timeout-before-commit': [{ event: { kind: 'new', key: 'e1' }, faults: ['delay-before-commit'] }],
  'timeout-after-commit': [{ event: { kind: 'new', key: 'e1' }, faults: ['hold-after-commit'] }],
  'clock-skew': [{ event: { kind: 'new', key: 'e1', occurredAtOffsetMs: 60 * 60 * 1000 } }],
  'out-of-order': [
    { event: { kind: 'new', key: 'later', occurredAtOffsetMs: 60 * 60 * 1000 } },
    { event: { kind: 'new', key: 'earlier', occurredAtOffsetMs: -60 * 60 * 1000 } },
  ],
  'delayed-delivery': [{ event: { kind: 'new', key: 'e1' }, delayBeforeSendMs: 3000 }],
  'parallel-duplicate': [{ event: { kind: 'new', key: 'e1' }, copies: 2 }],
};

/**
 * @param {string} name
 * @returns {boolean}
 */
export function hasScenario(name) {
  return Object.prototype.hasOwnProperty.call(SCENARIOS, name);
}

/**
 * @param {string} name
 * @param {{ receiverUrl: string, sendTimeoutMs: number, faultDelayMs: number }} cfg
 */
export async function runScenario(name, cfg) {
  const steps = SCENARIOS[name];
  if (steps === undefined) throw new Error(`unknown scenario ${name}`);
  /** @type {Map<string, BoundEvent>} */
  const bound = new Map();
  /** @type {Array<Record<string, unknown>>} */
  const sends = [];
  for (const step of steps) {
    const { eventId, bytes, label } = materialize(step.event, bound);
    if (step.delayBeforeSendMs !== undefined) await sleep(step.delayBeforeSendMs);
    const copies = step.copies ?? 1;
    const deliveries = await Promise.all(Array.from({ length: copies }, () => deliver(bytes, {
      url: cfg.receiverUrl,
      timeoutMs: cfg.sendTimeoutMs,
      faults: step.faults ?? [],
    })));
    for (const send of deliveries) {
      if (send.lastInjectedStartedAt !== null) {
        const readyAt = send.lastInjectedStartedAt + cfg.faultDelayMs + 250;
        const wait = readyAt - Date.now();
        if (wait > 0) await sleep(wait);
      }
      sends.push({
        label,
        eventId,
        payloadSha256: send.payloadSha256,
        verdict: send.verdict,
        traceId: send.traceId,
        attempts: send.attempts,
      });
    }
  }
  return { scenario: name, sends };
}

/**
 * @param {EventSpec} spec
 * @param {Map<string, BoundEvent>} bound
 * @returns {{ eventId: string | null, bytes: Buffer, label: string }}
 */
function materialize(spec, bound) {
  switch (spec.kind) {
    case 'new': {
      const eventId = randomUUID();
      const occurredAt = new Date(Date.now() + (spec.occurredAtOffsetMs ?? 0)).toISOString();
      const bytes = Buffer.from(JSON.stringify({
        event_id: eventId,
        type: 'ping',
        occurred_at: occurredAt,
        data: { n: 1 },
      }));
      bound.set(spec.key, { eventId, bytes });
      return { eventId, bytes, label: spec.key };
    }
    case 'resend': {
      const prior = bound.get(spec.key);
      if (prior === undefined) throw new Error(`missing event ${spec.key}`);
      return { eventId: prior.eventId, bytes: prior.bytes, label: spec.key };
    }
    case 'mutate': {
      const prior = bound.get(spec.key);
      if (prior === undefined) throw new Error(`missing event ${spec.key}`);
      const parsed = JSON.parse(prior.bytes.toString('utf8'));
      if (!isPlainObject(parsed)) throw new Error(`event ${spec.key} is not an object`);
      parsed.data = { n: 2 };
      return {
        eventId: prior.eventId,
        bytes: Buffer.from(JSON.stringify(parsed)),
        label: spec.key,
      };
    }
    case 'invalid': {
      if (spec.variant === 'not-json') {
        return { eventId: null, bytes: Buffer.from('nope'), label: 'bad' };
      }
      if (spec.variant === 'missing-event-id') {
        return { eventId: null, bytes: Buffer.from('{}'), label: 'bad' };
      }
      /** @type {never} */
      const unreachable = spec.variant;
      throw new Error(`unhandled invalid variant ${JSON.stringify(unreachable)}`);
    }
    default: {
      /** @type {never} */
      const unreachable = spec;
      throw new Error(`unhandled event ${JSON.stringify(unreachable)}`);
    }
  }
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
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
