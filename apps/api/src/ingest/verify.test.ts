import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { SIGNATURE_HEADER, verify } from './verify.ts';

const secret = 'simulator-secret';
const body = Buffer.from('{"id":"evt_1"}');

function signature(rawBody: Buffer, key: string): string {
  return createHmac('sha256', key).update(rawBody).digest('hex');
}

test('a matching signature is verified', () => {
  const result = verify(body, { [SIGNATURE_HEADER]: signature(body, secret) }, secret);
  assert.equal(result, 'VERIFIED');
});

test('a wrong secret is rejected', () => {
  const result = verify(body, { [SIGNATURE_HEADER]: signature(body, secret) }, 'other-secret');
  assert.equal(result, 'REJECTED');
});

test('a missing header is rejected', () => {
  assert.equal(verify(body, {}, secret), 'REJECTED');
});

test('a changed body is rejected', () => {
  const result = verify(
    Buffer.from('{"id":"evt_2"}'),
    { [SIGNATURE_HEADER]: signature(body, secret) },
    secret,
  );
  assert.equal(result, 'REJECTED');
});

test('the header name is case insensitive', () => {
  const result = verify(body, { 'X-FaultLens-Signature': signature(body, secret) }, secret);
  assert.equal(result, 'VERIFIED');
});
