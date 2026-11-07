import { rule as authFailure } from './classes/auth-failure.ts';
import { rule as rateLimit } from './classes/rate-limit.ts';
import { rule as networkTimeout } from './classes/network-timeout.ts';
import { rule as upstream5xx } from './classes/upstream-5xx.ts';
import { rule as schemaMismatch } from './classes/schema-mismatch.ts';
import { rule as invalidSignature } from './classes/invalid-signature.ts';
import { rule as duplicateDelivery } from './classes/duplicate-delivery.ts';
import { rule as outOfOrder } from './classes/out-of-order.ts';
import { rule as unknownRule } from './classes/unknown.ts';
import { fingerprint } from './fingerprint.ts';

export const RULES = [
  authFailure,
  rateLimit,
  networkTimeout,
  upstream5xx,
  schemaMismatch,
  invalidSignature,
  duplicateDelivery,
  outOfOrder,
  unknownRule,
];

export { fingerprint };
