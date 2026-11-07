import type { ClassificationRule } from '../../../domain/src/index.ts';

export const rule: ClassificationRule = {
  id: 'DUPLICATE_DELIVERY',
  version: '0',
  evaluate(_ctx) {
    throw new Error('not implemented');
  },
};
