import type { ClassificationRule } from '#domain';
import { attemptList, evidenceIds, networkTimeouts } from '../signals.ts';

export const rule: ClassificationRule = {
  id: 'NETWORK_TIMEOUT',
  version: '0',
  async evaluate(ctx) {
    const hits = networkTimeouts(ctx);
    if (hits.length === 0) return [];
    return [
      {
        failureClass: 'NETWORK_TIMEOUT',
        explanation: `Receiver processing met or exceeded the sender wait on ${attemptList(hits)}.`,
        evidenceIds: evidenceIds(ctx, hits),
        certainty: 'inferred',
      },
    ];
  },
};
