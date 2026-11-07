import type { ClassificationRule } from '../../../domain/src/index.ts';

export const rule: ClassificationRule = {
  id: 'OUT_OF_ORDER',
  version: '0',
  evaluate(_ctx) {
    throw new Error('not implemented');
  },
};
