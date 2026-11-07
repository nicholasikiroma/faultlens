import type { ClassificationRule } from '../../../domain/src/index.ts';

export const rule: ClassificationRule = {
  id: 'UPSTREAM_5XX',
  version: '0',
  evaluate(_ctx) {
    throw new Error('not implemented');
  },
};
