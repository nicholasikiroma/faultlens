import type { ClassificationRule } from '#domain';
import { ingressAbortedEvidence } from '../signals.ts';

export const rule: ClassificationRule = {
  id: 'INGRESS_ABORTED',
  version: '0',
  async evaluate(ctx) {
    const hits = ingressAbortedEvidence(ctx);
    if (hits.length === 0) return [];
    return [
      {
        failureClass: 'INGRESS_ABORTED',
        explanation: `Client closed the ingress socket before the handler finished writing the response (${hits.length} socket timing observation(s)).`,
        evidenceIds: hits.map((item) => item.id),
        certainty: 'observed',
        severityHint: 'HIGH',
      },
    ];
  },
};
