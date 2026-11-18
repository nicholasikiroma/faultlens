import type { ClassificationRule } from '#domain';
import { outOfOrderEvidence } from '../signals.ts';

export const rule: ClassificationRule = {
  id: 'OUT_OF_ORDER',
  version: '0',
  async evaluate(ctx) {
    const hit = outOfOrderEvidence(ctx);
    if (!hit.matched) return [];
    return [
      {
        failureClass: 'OUT_OF_ORDER',
        explanation: hit.detail ?? 'Event arrived out of occurred_at sequence relative to earlier deliveries.',
        evidenceIds: hit.evidenceIds,
        certainty: 'observed',
      },
    ];
  },
};
