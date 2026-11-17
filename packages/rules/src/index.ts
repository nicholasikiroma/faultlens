import { rule as authFailure } from './classes/auth-failure.ts';
import { rule as rateLimit } from './classes/rate-limit.ts';
import { rule as networkTimeout } from './classes/network-timeout.ts';
import { rule as upstream5xx } from './classes/upstream-5xx.ts';
import { rule as schemaMismatch } from './classes/schema-mismatch.ts';
import { rule as invalidSignature } from './classes/invalid-signature.ts';
import { rule as duplicateDelivery } from './classes/duplicate-delivery.ts';
import { rule as outOfOrder } from './classes/out-of-order.ts';
import { rule as ingressAborted } from './classes/ingress-aborted.ts';
import { rule as decryptFailure } from './classes/decrypt-failure.ts';
import { rule as downstreamNetworkError } from './classes/downstream-network-error.ts';
import { rule as unhandledException } from './classes/unhandled-exception.ts';
import { rule as asyncEscapeFailure } from './classes/async-escape-failure.ts';
import { rule as unknownRule } from './classes/unknown.ts';
import type { ClassificationRule, IncidentContext, RuleMatch } from '#domain';
import { fingerprint } from './fingerprint.ts';

export type { ClassificationRule, RuleMatch };

export const RULES = [
  authFailure,
  rateLimit,
  networkTimeout,
  upstream5xx,
  schemaMismatch,
  invalidSignature,
  duplicateDelivery,
  outOfOrder,
  ingressAborted,
  decryptFailure,
  downstreamNetworkError,
  unhandledException,
  asyncEscapeFailure,
  unknownRule,
];

export async function evaluateRules(ctx: Readonly<IncidentContext>): Promise<RuleMatch[]> {
  const groups = await Promise.all(RULES.map((rule) => rule.evaluate(ctx)));
  return groups.flat();
}

export { fingerprint };
