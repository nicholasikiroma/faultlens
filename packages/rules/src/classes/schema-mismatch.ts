import type { ClassificationRule } from '../../../domain/src/index.ts';

export const rule: ClassificationRule = {
  id: 'SCHEMA_MISMATCH',
  version: '0',
  evaluate(_ctx) {
    throw new Error('not implemented');
  },
};
