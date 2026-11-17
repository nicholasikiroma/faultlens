import type { ClassificationRule } from '#domain';
import { asyncEscapeEvidence } from '../signals.ts';

export const rule: ClassificationRule = {
  id: 'ASYNC_ESCAPE_FAILURE',
  version: '0',
  async evaluate(ctx) {
    const hits = asyncEscapeEvidence(ctx);
    if (hits.length === 0) return [];
    return [
      {
        failureClass: 'ASYNC_ESCAPE_FAILURE',
        explanation: `An unawaited async task failed after the HTTP response was already sent (${hits.length} exception observation(s)).`,
        evidenceIds: hits.map((item) => item.id),
        certainty: 'observed',
        severityHint: 'CRITICAL',
      },
    ];
  },
};
