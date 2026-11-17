import type { ClassificationRule } from '#domain';
import { unhandledExceptionEvidence } from '../signals.ts';

export const rule: ClassificationRule = {
  id: 'UNHANDLED_EXCEPTION',
  version: '0',
  async evaluate(ctx) {
    const hits = unhandledExceptionEvidence(ctx);
    if (hits.length === 0) return [];
    return [
      {
        failureClass: 'UNHANDLED_EXCEPTION',
        explanation: `Host application threw an unhandled exception during request execution (${hits.length} exception observation(s)).`,
        evidenceIds: hits.map((item) => item.id),
        certainty: 'observed',
        severityHint: 'CRITICAL',
      },
    ];
  },
};
