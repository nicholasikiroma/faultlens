import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ingest } from './ingest.ts';

test('ingest throws not implemented', () => {
  assert.throws(
    () => {
      ingest({
        token: 'demo-token',
        rawBody: Buffer.from('{}'),
        headers: {},
      });
    },
    (error: unknown) => error instanceof Error && error.message === 'not implemented',
  );
});
