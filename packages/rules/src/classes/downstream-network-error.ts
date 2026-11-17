import type { ClassificationRule } from '#domain';
import { downstreamNetworkErrorEvidence } from '../signals.ts';

export const rule: ClassificationRule = {
  id: 'DOWNSTREAM_NETWORK_ERROR',
  version: '0',
  async evaluate(ctx) {
    const hits = downstreamNetworkErrorEvidence(ctx);
    if (hits.length === 0) return [];
    return [
      {
        failureClass: 'DOWNSTREAM_NETWORK_ERROR',
        explanation: `Downstream HTTP/socket dependency failed (${hits.length} span observation(s)).`,
        evidenceIds: hits.map((item) => item.id),
        certainty: 'observed',
        severityHint: 'HIGH',
      },
    ];
  },
};
