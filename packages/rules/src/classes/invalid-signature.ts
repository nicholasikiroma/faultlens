import type { ClassificationRule } from '#domain';
import { attemptList, evidenceIds, invalidSignatures } from '../signals.ts';

export const rule: ClassificationRule = {
  id: 'INVALID_SIGNATURE',
  version: '0',
  async evaluate(ctx) {
    const hits = invalidSignatures(ctx);
    if (hits.length === 0) return [];
    return [
      {
        failureClass: 'INVALID_SIGNATURE',
        explanation: `Verification rejected ${attemptList(hits)}.`,
        evidenceIds: evidenceIds(ctx, hits),
        certainty: 'observed',
      },
    ];
  },
};
