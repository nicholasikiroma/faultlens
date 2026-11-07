import type { ClassificationRule } from '#domain';
import { duplicateDeliveries, evidenceIds } from '../signals.ts';

export const rule: ClassificationRule = {
  id: 'DUPLICATE_DELIVERY',
  version: '0',
  async evaluate(ctx) {
    const hits = duplicateDeliveries(ctx);
    const event = ctx.event;
    if (hits.length === 0 || event === null || event.externalEventId === null) return [];
    return [
      {
        failureClass: 'DUPLICATE_DELIVERY',
        explanation: `Deliveries ${hits.map((attempt) => attempt.id).join(', ')} share external id ${event.externalEventId} and digest ${event.payloadDigest}.`,
        evidenceIds: evidenceIds(ctx, hits),
        certainty: 'observed',
      },
    ];
  },
};
