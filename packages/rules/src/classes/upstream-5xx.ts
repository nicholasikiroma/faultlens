import type { ClassificationRule } from '#domain';
import { attemptList, evidenceIds, upstreamFailures } from '../signals.ts';

export const rule: ClassificationRule = {
  id: 'UPSTREAM_5XX',
  version: '0',
  async evaluate(ctx) {
    const hits = upstreamFailures(ctx);
    if (hits.length === 0) return [];
    const statuses = hits.map((attempt) => attempt.httpStatus).join(', ');
    return [
      {
        failureClass: 'UPSTREAM_5XX',
        explanation: `HTTP ${statuses} on ${attemptList(hits)}.`,
        evidenceIds: evidenceIds(ctx, hits),
        certainty: 'observed',
      },
    ];
  },
};
