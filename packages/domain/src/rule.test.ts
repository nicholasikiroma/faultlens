import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FAILURE_CLASSES, INCIDENT_TRANSITIONS } from './index.ts';

test('failure classes end with UNKNOWN and incident states are the four statuses', () => {
  assert.ok(FAILURE_CLASSES.join(',').endsWith('UNKNOWN'));
  assert.equal(
    Object.keys(INCIDENT_TRANSITIONS).join(','),
    'OPEN,INVESTIGATING,RESOLVED,ARCHIVED',
  );
});
