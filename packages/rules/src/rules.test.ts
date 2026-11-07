import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { IncidentContext } from '../../domain/src/entities.ts';
import { FAILURE_CLASSES } from '../../domain/src/states.ts';
import { fingerprint, RULES } from './index.ts';

const emptyContext: IncidentContext = {
  integrationId: '',
  environment: '',
  event: null,
  attempts: [],
  evidence: [],
};

test('RULES ids follow FAILURE_CLASSES', () => {
  assert.equal(RULES.map((rule) => rule.id).join(','), FAILURE_CLASSES.join(','));
});

test('every rule evaluate throws not implemented', () => {
  for (const rule of RULES) {
    assert.throws(
      () => {
        rule.evaluate(emptyContext);
      },
      (error: unknown) => error instanceof Error && error.message === 'not implemented',
    );
  }
});

test('fingerprint throws not implemented', () => {
  assert.throws(
    () => {
      fingerprint({
        integrationId: 'integration-1',
        environment: 'production',
        failureClass: 'NETWORK_TIMEOUT',
        endpoint: '/hooks/billing',
      });
    },
    (error: unknown) => error instanceof Error && error.message === 'not implemented',
  );
});
