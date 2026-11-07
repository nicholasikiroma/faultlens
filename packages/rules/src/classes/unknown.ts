import type { ClassificationRule } from '#domain';
import { anySpecific } from '../signals.ts';

export const rule: ClassificationRule = {
  id: 'UNKNOWN',
  version: '0',
  async evaluate(ctx) {
    if (anySpecific(ctx)) return [];
    return [
      {
        failureClass: 'UNKNOWN',
        explanation: 'No listed failure class was observed on the stored attempts.',
        evidenceIds: ctx.evidence.map((item) => item.id),
        certainty: 'observed',
      },
    ];
  },
};
