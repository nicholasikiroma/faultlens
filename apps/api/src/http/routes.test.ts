import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { INGEST_STATUS, ROUTES } from './routes.ts';

const docPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../docs/http-routes.md');

test('docs/http-routes.md headings match ROUTES one to one', () => {
  const doc = readFileSync(docPath, 'utf8');
  const headings = [...doc.matchAll(/^### (GET|POST|PUT) (\/\S+)\s*$/gm)].map(
    (match) => `${match[1]} ${match[2]}`,
  );
  assert.deepEqual(
    headings,
    ROUTES.map((route) => `${route.method} ${route.path}`),
  );
});

test('a path credential route is simulated traffic', () => {
  for (const route of ROUTES) {
    const tokenSegment = route.path.split('/').includes(':token');
    const credentialInPath = route.access.kind === 'ingest' && route.access.credential === 'path';
    assert.equal(credentialInPath, tokenSegment, route.path);
    if (credentialInPath) {
      assert.equal(route.access.traffic, 'simulated');
    }
  }
});

test('stored and duplicate ingest responses use HTTP 200', () => {
  assert.equal(INGEST_STATUS.stored, 200);
  assert.equal(INGEST_STATUS.duplicate, 200);
});
