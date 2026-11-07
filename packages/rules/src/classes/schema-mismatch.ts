import type { ClassificationRule } from '#domain';
import { attemptList, evidenceIds, schemaMismatches } from '../signals.ts';

export const rule: ClassificationRule = {
  id: 'SCHEMA_MISMATCH',
  version: '0',
  async evaluate(ctx) {
    const hits = schemaMismatches(ctx);
    if (hits.length === 0) return [];
    return [
      {
        failureClass: 'SCHEMA_MISMATCH',
        explanation: `HTTP 400 on ${attemptList(hits)}.`,
        evidenceIds: evidenceIds(ctx, hits),
        certainty: 'observed',
      },
    ];
  },
};
