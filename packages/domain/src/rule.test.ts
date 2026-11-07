import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluate, FAILURE_CLASSES, INCIDENT_TRANSITIONS, type IncidentContext } from './index.ts';

const emptyContext: IncidentContext = {
  integrationId: '',
  environment: '',
  event: null,
  attempts: [],
  evidence: [],
};

test('evaluate with an empty context throws not implemented', () => {
  assert.throws(
    () => {
      evaluate(emptyContext);
    },
    (error: unknown) => error instanceof Error && error.message === 'not implemented',
  );
});

test('failure classes end with UNKNOWN and incident states are the four statuses', () => {
  assert.ok(FAILURE_CLASSES.join(',').endsWith('UNKNOWN'));
  assert.equal(
    Object.keys(INCIDENT_TRANSITIONS).join(','),
    'OPEN,INVESTIGATING,RESOLVED,ARCHIVED',
  );
});
