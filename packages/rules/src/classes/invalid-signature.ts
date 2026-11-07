import type { ClassificationRule } from '../../../domain/src/index.ts';

export const rule: ClassificationRule = {
  id: 'INVALID_SIGNATURE',
  version: '0',
  evaluate(_ctx) {
    throw new Error('not implemented');
  },
};
