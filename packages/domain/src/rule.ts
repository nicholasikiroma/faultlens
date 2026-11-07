import type { FailureClass } from './states.ts';
import type { IncidentContext } from './entities.ts';

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
