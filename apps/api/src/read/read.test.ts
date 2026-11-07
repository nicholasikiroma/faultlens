import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exportIncident } from './export.ts';
import { listAttempts, listEvents } from './events.ts';
import { listIncidents } from './incidents.ts';

test('listEvents throws not implemented', () => {
  assert.throws(
    () => {
      listEvents(null);
    },
    (error: unknown) => error instanceof Error && error.message === 'not implemented',
  );
});

test('listAttempts throws not implemented', () => {
  assert.throws(
    () => {
      listAttempts('event-1');
    },
    (error: unknown) => error instanceof Error && error.message === 'not implemented',
  );
});

test('listIncidents throws not implemented', () => {
  assert.throws(
    () => {
      listIncidents(null);
    },
    (error: unknown) => error instanceof Error && error.message === 'not implemented',
  );
});

test('exportIncident throws not implemented', () => {
  assert.throws(
    () => {
      exportIncident('incident-1');
    },
    (error: unknown) => error instanceof Error && error.message === 'not implemented',
  );
});
