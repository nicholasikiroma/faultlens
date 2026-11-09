# WireSleuth Node SDK: webhook capability

WireSleuth is a self-hosted, open-source incident investigation tool, not a Sentry replacement. Webhook investigation is its first capability; the SDK is structured to support additional investigation sources later. See [SDK architecture](sdk-architecture.md) for the shared-core/feature boundary and future scope.

Milestone 13 adds `createWireSleuthClient` in `packages/sdk/src/index.ts` and a runnable host in `apps/sdk-example/src/`. The SDK has no HTTP-framework, database, Redis, or model dependency. This monorepo uses the root `#sdk` import; it is not a published npm package and has no nested manifest. Run TypeScript examples through the root `tsx` scripts.

## Provisioning

1. Apply migrations and create an integration in the intended workspace/environment.
2. Create its API key with `npm run ingest-key -- create <integrationId>` (see [ingest keys](ingest-keys.md)).
3. Configure the host with that API key and the integration's signing secret. The signing secret is **not** the API key. Keep both in a secret store.
4. Set `WIRESLEUTH_API_URL` to the WireSleuth API origin, for example `https://wiresleuth.example.com`. Use HTTPS across untrusted networks; HTTP is supported for local development.

## Use in a host

```ts
import { createWireSleuthClient } from '#sdk';

// Construct once at application startup, not once per request.
const wiresleuth = createWireSleuthClient({
  baseUrl: process.env['WIRESLEUTH_API_URL']!,
  apiKey: process.env['WIRESLEUTH_INGEST_KEY']!,
  timeoutMs: 1000,  // default
  maxInFlight: 8,  // default, shared per client
  webhooks: {
    signingSecret: process.env['WIRESLEUTH_SIGNING_SECRET']!,
  },
});

// In the host's own webhook handler, after its verification/business processing:
response.writeHead(202, { 'content-type': 'application/json' });
response.end(JSON.stringify({ accepted: true }));
void wiresleuth.webhooks.capture(rawBody); // Uint8Array or Buffer; never rejects
```

`webhooks` is an opt-in capability. The core client can be constructed with only shared configuration and requires no signing secret; without `webhooks` configuration, `client.webhooks` is undefined. There are no other implemented capabilities yet.

For this webhook capability, `rawBody` must contain the exact bytes of an API-compatible JSON object with non-empty `event_id` and `type`, and optional `occurred_at`. The SDK does not parse or reserialize those bytes. A normal API schema error is returned as an HTTP delivery failure. Provider-specific payloads that do not have these fields need application-side mapping before capture; signing a new envelope means signing those new bytes, not the provider's original JSON.

The webhook capability computes HMAC-SHA256 over a snapshot of the supplied bytes and sets `x-wiresleuth-signature`. The shared transport posts them to the capability's `/v1/ingest` endpoint with the scoped bearer key. It never forwards incoming request headers, cookies, or provider credentials. It does **not** verify the provider's incoming signature or perform business processing: those remain host responsibilities. The API still controls capture policy and defaults to metadata-only persistence.

## Results and isolation

Configuration errors throw at construction so they can be fixed at startup. Delivery promises resolve to data and never reject:

- `{ outcome: 'delivered', status }`: the API returned 2xx; this does not mean background classification has completed.
- `{ outcome: 'failed', reason: 'http', status }`: an HTTP refusal, including authentication and schema failures.
- `{ outcome: 'failed', reason: 'network' | 'timeout' | 'invalid-input' }`.
- `{ outcome: 'dropped', reason: 'oversized' | 'busy' }`.

There are no retries, queues, durable buffers, or background jobs. Inputs over 1 MiB are dropped without a request. At the concurrency limit, new deliveries are dropped rather than queued. Deadlines default to one second (configurable from 1 to 60,000 milliseconds). Fetches are aborted on timeout. Redirects are refused to avoid forwarding credentials or payloads to another endpoint. Response bodies are discarded, not returned or logged. The SDK itself logs nothing.

For non-blocking capture, do not await delivery on the host's business-response path. Callers that need diagnostic results may await the promise separately. Synchronous copying/signing work is bounded by the payload limit. This is best-effort telemetry: a busy client, an unavailable API, or host-process termination can lose an observation. There is no flush guarantee at shutdown. Do not use delivery success to decide whether to acknowledge a provider's webhook.

## Runnable sample

Set these values in the environment (or root `.env`):

```dotenv
WIRESLEUTH_API_URL=http://127.0.0.1:3000
WIRESLEUTH_INGEST_KEY=<key returned at creation>
WIRESLEUTH_SIGNING_SECRET=<the integration signing secret>
```

Then run:

```sh
npm run start:api
# In another terminal:
npm run start:sdk-example
# In another terminal:
curl -i http://127.0.0.1:3001/webhook \
  -H 'Content-Type: application/json' \
  --data '{"event_id":"evt-sdk-demo","type":"invoice.paid"}'
```

The sample returns HTTP 202 with `{"accepted":true}`. Stop the API and repeat the request: the host still returns the same response. The sample binds only to loopback, has a 1 MiB host input limit, and deliberately omits provider verification and business persistence. It is not a production webhook receiver.

## Tests

`npm run test:sdk` checks the product-level client and optional webhook capability, and runs real-socket, database-free tests for shared transport isolation, exact-byte signatures, immutable input snapshots, API-key headers, body bounds, HTTP errors, socket errors, timeouts, concurrency limits, redirect refusal, and the sample host's independent response. `npm test` includes these tests as well.
