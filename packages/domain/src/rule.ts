import type { FailureClass } from './states.ts';
import type { IncidentContext, WebhookEvent } from './entities.ts';

export interface RuleMatch {
  failureClass: FailureClass;
  explanation: string;
  evidenceIds: readonly string[];
  certainty: 'observed' | 'inferred';
  severityHint?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface ClassificationRule {
  id: string;
  version: string;
  evaluate(ctx: Readonly<IncidentContext>): Promise<RuleMatch[]>;
}

export function evaluate(_ctx: Readonly<IncidentContext>): Promise<RuleMatch[]> {
  throw new Error('not implemented');
}

export function verify(
  _rawBody: Buffer,
  _headers: Readonly<Record<string, string>>,
): 'VERIFIED' | 'REJECTED' {
  throw new Error('not implemented');
}

export function redact(_rawBody: Buffer): { digest: string; redacted: unknown } {
  throw new Error('not implemented');
}

export function ingest(_input: {
  token: string;
  rawBody: Buffer;
  headers: Readonly<Record<string, string>>;
}): Promise<{ eventId: string | null; attemptId: string }> {
  throw new Error('not implemented');
}

export function dispatchPending(): Promise<number> {
  throw new Error('not implemented');
}

export function classifyJob(_eventId: string): Promise<void> {
  throw new Error('not implemented');
}

export function fingerprint(_input: {
  integrationId: string;
  environment: string;
  failureClass: FailureClass;
  endpoint: string;
}): string {
  throw new Error('not implemented');
}

export function listEvents(
  _cursor: string | null,
): Promise<{ items: WebhookEvent[]; nextCursor: string | null }> {
  throw new Error('not implemented');
}
