import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { redact } from './redact.ts';

const body = Buffer.from(
  JSON.stringify({
    id: 'evt_1',
    secret: 's3cr3t',
    nested: { signing_key: 'abc', amount: 10 },
    items: [{ client_secret: 'hide', name: 'invoice' }],
  }),
);

test('the digest is the sha256 of the raw bytes', () => {
  const expected = createHash('sha256').update(body).digest('hex');
  const first = redact(body);
  const second = redact(body);
  assert.equal(first.digest, expected);
  assert.equal(first.digest, second.digest);
  assert.equal(first.digest.length, 64);
});

test('secret fields are removed and the rest remains', () => {
  const { redacted } = redact(body);
  assert.deepEqual(redacted, {
    id: 'evt_1',
    nested: { amount: 10 },
    items: [{ name: 'invoice' }],
  });
});

test('a body that is not json still has a digest', () => {
  const raw = Buffer.from('not json');
  const result = redact(raw);
  assert.equal(result.redacted, null);
  assert.equal(result.digest, createHash('sha256').update(raw).digest('hex'));
});
