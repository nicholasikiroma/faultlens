import type { ClassificationRule } from '#domain';

export const rule: ClassificationRule = {
  id: 'NETWORK_TIMEOUT',
  version: '0',
  async evaluate() {
    return [];
  },
};
