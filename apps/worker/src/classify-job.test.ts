import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyJob } from './classify-job.ts';
import { dispatchPending } from './dispatcher.ts';

test('classifyJob throws not implemented', () => {
  assert.throws(
    () => {
      classifyJob('event-1');
    },
    (error: unknown) => error instanceof Error && error.message === 'not implemented',
  );
});

test('dispatchPending throws not implemented', () => {
  assert.throws(
    () => {
      dispatchPending();
    },
    (error: unknown) => error instanceof Error && error.message === 'not implemented',
  );
});
