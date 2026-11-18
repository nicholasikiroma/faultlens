import assert from 'node:assert/strict';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { test, describe, it, type TestContext } from 'node:test';
import { INGEST_SIGNATURE_HEADER, MAX_INGEST_BODY_BYTES } from '#domain';
import { createSampleHost } from '../../../apps/sdk-example/src/server.ts';
import { verify } from '../../../apps/api/src/ingest/verify.ts';
import { validateEventSchema } from '../../../apps/api/src/ingest/schema.ts';
import {
  createFaultLensClient,
  FlightRecorder,
  getCurrentEpisode,
  runInEpisode,
  bindToEpisode,
  recordVerification,
  recordIdentity,
  recordEncryption,
  recordIdempotency,
  recordError,
  createEpisode,
  attachPassiveBodyTap,
  decide,
  DeliveryHistorySketch,
  encryptAes256Gcm,
  decryptAes256Gcm,
  createTransport,
  withFlightRecorderNodeHttp,
  flightRecorderExpressMiddleware,
  flightRecorderHonoMiddleware,
  type DeliveryResult,
  type FaultLensClientOptions,
} from './index.ts';

const apiKey = 'flk_test-key-not-a-provider-secret';
const signingSecret = 'test-integration-signing-secret';
const raw = Buffer.from('{ "event_id": "evt-sdk", "type": "invoice.paid", "label": "café" }\n');

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

async function listen(t: TestContext, server: Server) {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}

const clientFor = (baseUrl: string, options: Partial<FaultLensClientOptions> = {}) =>
  createFaultLensClient({
    baseUrl,
    apiKey,
    ...options,
    webhooks: options.webhooks ?? { signingSecret },
  });

describe('1. Core Configuration & Client Composition', () => {
  test('core needs no webhook secret and exposes only explicitly enabled capabilities', () => {
    const core = createFaultLensClient({ baseUrl: 'http://localhost', apiKey });
    assert.equal(core.webhooks, undefined);
    assert.ok(core instanceof FlightRecorder);
    assert.equal(typeof core.middleware.nodeHttp, 'function');
    assert.equal(typeof core.middleware.express, 'function');
    assert.equal(typeof core.middleware.hono, 'function');

    const enabled = clientFor('http://localhost');
    assert.ok(enabled.webhooks);
    assert.equal(typeof enabled.webhooks.capture, 'function');
  });

  test('bad shared and webhook configuration is rejected without exposing credentials', () => {
    for (const baseUrl of [
      'ftp://localhost',
      'http://name:password@localhost',
      'http://localhost/api',
      'http://localhost?x=1',
      'http://localhost/#fragment',
    ]) {
      assert.throws(() => clientFor(baseUrl));
    }
    for (const timeoutMs of [0, -1, NaN, Infinity, 1.5, 60001]) {
      assert.throws(() => clientFor('http://localhost', { timeoutMs }));
    }
    for (const maxInFlight of [0, -1, NaN, Infinity, 1.5, 1025]) {
      assert.throws(() => clientFor('http://localhost', { maxInFlight }));
    }
    assert.throws(() => clientFor('http://localhost', { apiKey: '' }));
    assert.throws(() => clientFor('http://localhost', { webhooks: { signingSecret: '' } }));
  });
});

describe('2. AsyncLocalStorage (ALS) Context & Recording Hooks', () => {
  test('ALS maintains episode isolation across concurrent async chains', async () => {
    const ep1 = createEpisode({ framework: 'node-http', method: 'POST', rawUrl: '/1', headers: {} });
    const ep2 = createEpisode({ framework: 'node-http', method: 'POST', rawUrl: '/2', headers: {} });

    assert.equal(getCurrentEpisode(), undefined);

    const task1 = runInEpisode(ep1, async () => {
      assert.equal(getCurrentEpisode()?.episodeId, ep1.episodeId);
      await new Promise((r) => setTimeout(r, 20));
      recordIdentity({ provider: 'stripe', eventId: 'evt_1' });
      assert.equal(getCurrentEpisode()?.identity.eventId, 'evt_1');
    });

    const task2 = runInEpisode(ep2, async () => {
      assert.equal(getCurrentEpisode()?.episodeId, ep2.episodeId);
      await new Promise((r) => setTimeout(r, 10));
      recordIdentity({ provider: 'github', eventId: 'evt_2' });
      assert.equal(getCurrentEpisode()?.identity.eventId, 'evt_2');
    });

    await Promise.all([task1, task2]);

    assert.equal(ep1.identity.eventId, 'evt_1');
    assert.equal(ep2.identity.eventId, 'evt_2');
    assert.equal(getCurrentEpisode(), undefined);
  });

  test('bindToEpisode re-enters episode across callbacks and event emitters', async () => {
    const ep = createEpisode({ framework: 'node-http', method: 'POST', rawUrl: '/queue', headers: {} });
    let executedInEpisode = false;

    const callback = bindToEpisode(ep, () => {
      assert.equal(getCurrentEpisode()?.episodeId, ep.episodeId);
      executedInEpisode = true;
    });

    await new Promise<void>((resolve) => {
      setTimeout(() => {
        callback();
        resolve();
      }, 10);
    });

    assert.equal(executedInEpisode, true);
  });

  test('host recording hooks safely no-op outside an episode', () => {
    assert.doesNotThrow(() => {
      recordVerification({ state: 'VERIFIED' });
      recordIdentity({ eventId: 'test' });
      recordEncryption({ scheme: 'AES-256-GCM', authenticatesSender: false, decryptedOk: true });
      recordIdempotency({ handlerIdempotent: true });
      recordError(new Error('test'));
    });
  });
});

describe('3. Passive Body Tap & Paused-Mode Preservation', () => {
  test('passive tap wraps emit without putting stream into flowing mode', async (t) => {
    const server = createServer(async (req, res) => {
      const ep = createEpisode({ framework: 'node-http', method: 'POST', rawUrl: req.url || '/', headers: req.headers });
      const { finalizeTap } = attachPassiveBodyTap(req, ep, { maxTapBytes: 1024 });

      // Crucial: readableFlowing must remain null until host reads!
      assert.equal(req.readableFlowing, null);

      // Async delay before host body parser starts reading
      await new Promise((r) => setTimeout(r, 30));

      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.from(chunk));
      }
      finalizeTap();

      const receivedText = Buffer.concat(chunks).toString('utf8');
      assert.equal(receivedText, raw.toString('utf8'));
      assert.equal(ep.bodyTap.totalBytesSeen, raw.length);
      assert.ok(ep.bodyTap.wireBodyHmac.length > 0);
      assert.equal(ep.identity.eventId, 'evt-sdk');
      assert.equal(ep.identity.eventType, 'invoice.paid');

      res.writeHead(200).end('ok');
    });

    const url = await listen(t, server);
    const res = await fetch(`${url}/webhook`, { method: 'POST', body: raw });
    assert.equal(res.status, 200);
  });

  test('tap respects maxTapBytes cap without truncating stream', async (t) => {
    const bigPayload = Buffer.alloc(100 * 1024, 'a');
    const server = createServer(async (req, res) => {
      const ep = createEpisode({ framework: 'node-http', method: 'POST', rawUrl: req.url || '/', headers: req.headers });
      const { finalizeTap } = attachPassiveBodyTap(req, ep, { maxTapBytes: 1024 });

      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.from(chunk));
      }
      finalizeTap();

      assert.equal(Buffer.concat(chunks).length, bigPayload.length);
      assert.equal(ep.bodyTap.totalBytesSeen, bigPayload.length);
      assert.equal(ep.bodyTap.tappedBytes, 1024);
      assert.equal(ep.bodyTap.truncatedByCap, true);
      assert.ok(ep.bodyTap.wireBodyHmac.length > 0);

      res.writeHead(200).end('ok');
    });

    const url = await listen(t, server);
    const res = await fetch(`${url}/webhook`, { method: 'POST', body: bigPayload });
    assert.equal(res.status, 200);
  });
});

describe('4. diagnostics_channel & undici Outbound HTTP Tracing', () => {
  test('downstream fetch is attributed to the active Episode via ALS', async (t) => {
    const downstream = createServer((_req, res) => {
      res.writeHead(401, { 'content-type': 'application/json' }).end('{"error":"unauthorized"}');
    });
    const downstreamUrl = await listen(t, downstream);

    const recorder = new FlightRecorder({ observeAllInHook: true });
    let observedDecision: any;
    let observedEpisode: any;

    recorder.options.onEpisodeSealed = (ep, dec) => {
      observedEpisode = ep;
      observedDecision = dec;
    };

    const server = createServer(
      recorder.middleware.nodeHttp(async (_req, res) => {
        // Outbound downstream call inside webhook handler
        const outRes = await fetch(`${downstreamUrl}/v1/charges`);
        await outRes.text();

        // Host swallows 401 and returns 200
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ received: true }));
      })
    );

    const url = await listen(t, server);
    const res = await fetch(`${url}/webhook`, { method: 'POST', body: raw });
    assert.equal(res.status, 200);

    // Wait for episode sealing
    await new Promise((r) => setTimeout(r, 60));

    assert.ok(observedEpisode);
    assert.equal(observedEpisode.downstreamCalls.length, 1);
    assert.equal(observedEpisode.downstreamCalls[0].statusCode, 401);
    assert.equal(observedDecision.primaryClass, 'AUTH_FAILURE');
    assert.equal(observedDecision.shouldShip, true);
  });
});

describe('5. Deduplication Sketch, Ordering & Replay Gates', () => {
  test('duplicate deliveries within window are detected via bounded sketch', () => {
    const sketch = new DeliveryHistorySketch(100);
    assert.equal(sketch.checkAndRecordDuplicate('stripe:id:evt_1'), false);
    assert.equal(sketch.checkAndRecordDuplicate('stripe:id:evt_1'), true);
    assert.equal(sketch.checkAndRecordDuplicate('stripe:id:evt_2'), false);
  });

  test('out of order deliveries detected comparing provider creation timestamps', () => {
    const sketch = new DeliveryHistorySketch(100);
    const first = sketch.checkAndRecordOrdering('stripe:cust_123', 1000);
    assert.equal(first.isOutOfOrder, false);

    const outOfOrder = sketch.checkAndRecordOrdering('stripe:cust_123', 950);
    assert.equal(outOfOrder.isOutOfOrder, true);
    assert.equal(outOfOrder.lastSeenTimestampSec, 1000);
  });

  test('decide() flags auto-replay hazards when handler commits after abort', () => {
    const ep = createEpisode({ framework: 'node-http', method: 'POST', rawUrl: '/webhook', headers: {} });
    ep.socket.closeFired = true;
    ep.socket.writableEndedAtClose = false;
    ep.socket.committedAfterAbort = true;
    ep.idempotency.handlerIdempotent = false;

    const decision = decide(ep);
    assert.equal(decision.primaryClass, 'INGRESS_ABORTED');
    assert.equal(decision.autoReplaySafe, false);
    assert.ok(decision.replayGateReasons.includes('committed-after-abort'));
    assert.ok(decision.replayGateReasons.includes('handler-not-idempotent'));
  });
});

describe('6. Encryption & Decryption Classification', () => {
  test('AES-256-GCM encryption produces unique ciphertexts, decryptedOk classifies known crypto errors', () => {
    const key = Buffer.alloc(32, 7);
    const plaintext = 'sensitive-customer-data';

    const enc1 = encryptAes256Gcm(plaintext, key);
    const enc2 = encryptAes256Gcm(plaintext, key);
    assert.notEqual(enc1.ivHex, enc2.ivHex);
    assert.notEqual(enc1.ciphertextHex, enc2.ciphertextHex);

    const decrypted = decryptAes256Gcm(enc1, key);
    assert.equal(decrypted, plaintext);

    // Tampered tag throws
    assert.throws(() =>
      decryptAes256Gcm({ ...enc1, authTagHex: Buffer.alloc(16, 0).toString('hex') }, key)
    );
  });
});

describe('7. Tail-Based Sampling (decide)', () => {
  test('healthy 200 delivery with no exceptions or downstream failures is dropped (shouldShip=false)', () => {
    const ep = createEpisode({ framework: 'node-http', method: 'POST', rawUrl: '/webhook', headers: {} });
    ep.statusCode = 200;
    ep.socket.finishFired = true;
    ep.socket.closeFired = true;
    ep.socket.writableEndedAtClose = true;
    ep.idempotency.handlerIdempotent = true;

    const decision = decide(ep);
    assert.equal(decision.shouldShip, false);
    assert.equal(decision.primaryClass, 'HEALTHY');
  });

  test('failure sets shouldShip=true with correct classification', () => {
    const ep = createEpisode({ framework: 'node-http', method: 'POST', rawUrl: '/webhook', headers: {} });
    ep.verification.state = 'REJECTED';
    ep.verification.reason = 'Invalid HMAC signature';

    const decision = decide(ep);
    assert.equal(decision.shouldShip, true);
    assert.equal(decision.primaryClass, 'SIGNATURE_INVALID');
  });
});

describe('8. Zero-Tampering Guarantee (Control vs Instrumented)', () => {
  test('produces byte-for-byte identical request handling and response even if exporter throws', async (t) => {
    const coreHandler = async (req: IncomingMessage, res: ServerResponse) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.from(chunk));
      }
      const bodyStr = Buffer.concat(chunks).toString('utf8');
      res.writeHead(202, {
        'content-type': 'application/json',
        'x-custom-header': 'faultlens-test',
      });
      res.end(
        JSON.stringify({
          bytes: Buffer.byteLength(bodyStr),
          echo: JSON.parse(bodyStr),
        })
      );
    };

    // 1. Uninstrumented control server
    const controlServer = createServer(coreHandler);
    const controlUrl = await listen(t, controlServer);

    // 2. Instrumented server with deliberately failing exporter
    const recorder = new FlightRecorder({
      observeAllInHook: true,
      onEpisodeSealed: () => {
        throw new Error('Deliberate hook failure to verify fail-open');
      },
    });
    const instrumentedServer = createServer(
      recorder.middleware.nodeHttp(coreHandler, { routeTemplate: '/webhook' })
    );
    const instUrl = await listen(t, instrumentedServer);

    const testPayload = JSON.stringify({ event_id: 'evt_123', type: 'order.completed', amount: 5000 });
    const [resControl, resInst] = await Promise.all([
      fetch(`${controlUrl}/webhook`, { method: 'POST', body: testPayload }),
      fetch(`${instUrl}/webhook`, { method: 'POST', body: testPayload }),
    ]);

    assert.equal(resInst.status, resControl.status);
    assert.equal(await resInst.text(), await resControl.text());
    assert.equal(resInst.headers.get('content-type'), resControl.headers.get('content-type'));
    assert.equal(resInst.headers.get('x-custom-header'), resControl.headers.get('x-custom-header'));
  });
});

describe('9. Wire Ingest & Shared Delivery Transport', () => {
  test('webhook capability posts exact snapshotted bytes with API key and HMAC', { timeout: 5000 }, async (t) => {
    const received = deferred<void>();
    const server = createServer(async (req, res) => {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const body = Buffer.concat(chunks);
        assert.equal(req.method, 'POST');
        assert.equal(req.url, '/v1/ingest');
        assert.equal(req.headers.authorization, `Bearer ${apiKey}`);
        assert.equal(req.headers['content-type'], 'application/json');
        assert.deepEqual(body, raw);
        assert.equal(
          verify(body, { [INGEST_SIGNATURE_HEADER]: String(req.headers[INGEST_SIGNATURE_HEADER]) }, signingSecret),
          'VERIFIED'
        );
        assert.equal(validateEventSchema(body).ok, true);
        res.writeHead(200).end('ok');
      } finally {
        received.resolve();
      }
    });

    const client = clientFor(await listen(t, server));
    const mutable = Buffer.from(raw);
    const delivery = client.webhooks!.capture(mutable);
    mutable.fill(0);
    assert.deepEqual(await delivery, { outcome: 'delivered', status: 200 });
    await received.promise;
  });

  test('HTTP refusals are returned as data without upstream body or secrets', { timeout: 5000 }, async (t) => {
    let status = 400;
    const client = clientFor(
      await listen(
        t,
        createServer((req, res) => {
          req.resume();
          res.writeHead(status).end(`${apiKey} ${signingSecret}`);
        })
      )
    );
    for (status of [400, 401, 409, 413, 503]) {
      assert.deepEqual(await client.webhooks!.capture(raw), { outcome: 'failed', reason: 'http', status });
    }
  });

  test('socket failures never reject', { timeout: 5000 }, async (t) => {
    const client = clientFor(await listen(t, createServer((req) => req.socket.destroy())));
    assert.deepEqual(await client.webhooks!.capture(raw), { outcome: 'failed', reason: 'network' });
  });

  test('timeouts release capacity so later deliveries still work', { timeout: 5000 }, async (t) => {
    let respond = false;
    const client = clientFor(
      await listen(
        t,
        createServer((req, res) => {
          req.resume();
          if (respond) res.writeHead(200).end();
        })
      ),
      { timeoutMs: 150, maxInFlight: 1 }
    );
    assert.deepEqual(await client.webhooks!.capture(raw), { outcome: 'failed', reason: 'timeout' });
    respond = true;
    assert.deepEqual(await client.webhooks!.capture(raw), { outcome: 'delivered', status: 200 });
  });

  test('concurrent deliveries beyond client budget are dropped rather than queued', { timeout: 5000 }, async (t) => {
    const started = deferred<void>();
    let finish!: () => void;
    let calls = 0;
    const client = clientFor(
      await listen(
        t,
        createServer((req, res) => {
          req.resume();
          calls++;
          finish = () => res.writeHead(200).end();
          started.resolve();
        })
      ),
      { maxInFlight: 1, timeoutMs: 2000 }
    );
    const first = client.webhooks!.capture(raw);
    await started.promise;
    assert.deepEqual(await client.webhooks!.capture(raw), { outcome: 'dropped', reason: 'busy' });
    assert.equal(calls, 1);
    finish();
    assert.deepEqual(await first, { outcome: 'delivered', status: 200 });
  });

  test('webhook body bounds reject oversized inputs locally and accept exact limit', { timeout: 5000 }, async (t) => {
    let calls = 0;
    const client = clientFor(
      await listen(
        t,
        createServer((req, res) => {
          calls++;
          req.resume();
          req.on('end', () => res.end());
        })
      )
    );
    assert.deepEqual(await client.webhooks!.capture(new Uint8Array(MAX_INGEST_BODY_BYTES + 1)), {
      outcome: 'dropped',
      reason: 'oversized',
    });
    // @ts-expect-error JavaScript runtime guard
    assert.deepEqual(await client.webhooks!.capture('not raw bytes'), { outcome: 'failed', reason: 'invalid-input' });
    assert.equal(calls, 0);
    assert.deepEqual(await client.webhooks!.capture(new Uint8Array(MAX_INGEST_BODY_BYTES)), {
      outcome: 'delivered',
      status: 200,
    });
    assert.equal(calls, 1);
  });

  test('redirects never forward payloads or credentials to another endpoint', { timeout: 5000 }, async (t) => {
    const paths: string[] = [];
    const client = clientFor(
      await listen(
        t,
        createServer((req, res) => {
          req.resume();
          paths.push(req.url ?? '');
          res.writeHead(307, { location: '/collect-secrets' }).end();
        })
      )
    );
    assert.deepEqual(await client.webhooks!.capture(raw), { outcome: 'failed', reason: 'network' });
    assert.deepEqual(paths, ['/v1/ingest']);
  });

  test('sample host does not wait for telemetry to settle before responding', { timeout: 5000 }, async (t) => {
    const pending = deferred<DeliveryResult>();
    const called = deferred<void>();
    const url = await listen(
      t,
      createSampleHost({
        capture: () => {
          called.resolve();
          return pending.promise;
        },
      })
    );
    try {
      const response = await fetch(`${url}/webhook`, { method: 'POST', body: raw });
      assert.equal(response.status, 202);
      assert.deepEqual(await response.json(), { accepted: true });
      await called.promise;
    } finally {
      pending.resolve({ outcome: 'failed', reason: 'network' });
    }
  });

  test('FlightRecorder ships failure episodes to /v1/ingest/episodes without signingSecret and strips capturedBytes', { timeout: 5000 }, async (t) => {
    const requests: Array<{ path: string; auth: string | undefined; body: Record<string, unknown> }> = [];
    const baseUrl = await listen(
      t,
      createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          requests.push({
            path: req.url ?? '',
            auth: req.headers.authorization,
            body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>,
          });
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ outcome: 'stored' }));
        });
      })
    );

    const recorder = createFaultLensClient({ baseUrl, apiKey: 'flk_episode_only_key' });
    const ep = createEpisode({ framework: 'node-http', method: 'POST', rawUrl: '/orders', headers: {} });
    ep.statusCode = 500;
    ep.bodyTap.capturedBytes = Buffer.from('{"secret":"raw"}');
    ep.exceptions.push({
      layer: 'CONTROLLER',
      name: 'Error',
      message: 'DB pool exhausted',
      escapedAfterResponse: false,
      recordedAtMs: Date.now(),
    });

    const decision = recorder.finalizeAndExport(ep);
    assert.equal(decision.shouldShip, true);

    await new Promise((r) => setTimeout(r, 80));
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.path, '/v1/ingest/episodes');
    assert.equal(requests[0]?.auth, 'Bearer flk_episode_only_key');
    assert.equal((requests[0]?.body['bodyTap'] as Record<string, unknown>)['capturedBytes'], undefined);
  });
});
