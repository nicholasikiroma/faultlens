import type { ClassificationRule } from '#domain';
import { attemptList, authFailures, evidenceIds } from '../signals.ts';

export const rule: ClassificationRule = {
  id: 'AUTH_FAILURE',
  version: '0',
  async evaluate(ctx) {
    const hits = authFailures(ctx);
    if (hits.length === 0) return [];
    return [
      {
        failureClass: 'AUTH_FAILURE',
        explanation: `HTTP 401 on ${attemptList(hits)}.`,
        evidenceIds: evidenceIds(ctx, hits),
        certainty: 'observed',
      },
    ];
  },
};
