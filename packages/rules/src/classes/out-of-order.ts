import type { ClassificationRule } from '#domain';

export const rule: ClassificationRule = {
  id: 'OUT_OF_ORDER',
  version: '0',
  async evaluate() {
    return [];
  },
};
