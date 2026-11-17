import type { ClassificationRule } from '#domain';
import { decryptFailureEvidence } from '../signals.ts';

export const rule: ClassificationRule = {
  id: 'DECRYPT_FAILURE',
  version: '0',
  async evaluate(ctx) {
    const hits = decryptFailureEvidence(ctx);
    if (hits.length === 0) return [];
    return [
      {
        failureClass: 'DECRYPT_FAILURE',
        explanation: `Payload decryption failed during request processing (${hits.length} episode observation(s)).`,
        evidenceIds: hits.map((item) => item.id),
        certainty: 'observed',
        severityHint: 'HIGH',
      },
    ];
  },
};
