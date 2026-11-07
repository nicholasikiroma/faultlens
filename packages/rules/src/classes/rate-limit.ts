import type { ClassificationRule } from '#domain';
import { attemptList, evidenceIds, rateLimits } from '../signals.ts';

export const rule: ClassificationRule = {
  id: 'RATE_LIMIT',
  version: '0',
  async evaluate(ctx) {
    const hits = rateLimits(ctx);
    if (hits.length === 0) return [];
    return [
      {
        failureClass: 'RATE_LIMIT',
        explanation: `HTTP 429 on ${attemptList(hits)}.`,
        evidenceIds: evidenceIds(ctx, hits),
        certainty: 'observed',
      },
    ];
  },
};
