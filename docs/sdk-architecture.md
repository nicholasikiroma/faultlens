# SDK architecture: investigation first, webhooks first capability

## Product boundary

FaultLens is a self-hosted, open-source tool for examining incidents and deriving useful insights from evidence. It is not intended to replace Sentry or become a general-purpose error-monitoring platform. Webhook investigation is the first solution; it is not the boundary of the product or SDK. Distributed-system investigations and other incident sources will follow when their investigation requirements are defined.

The SDK supplies observations that support backend investigation. It does not diagnose incidents in the host, replace provider verification, decide business outcomes, or require the host to wait for telemetry delivery. Backend evidence, grouping, rules, and investigation remain separate concerns.

## Current public API

```ts
const faultlens = createFaultLensClient({
  baseUrl,
  apiKey,
  timeoutMs: 1000,
  maxInFlight: 8,
  webhooks: { signingSecret },
});

void faultlens.webhooks.capture(rawBody);
```

Capabilities are explicitly configured. Omitting `webhooks` constructs the shared client without requiring a webhook signing secret or exposing the webhook capability. A literal configuration that enables webhooks provides a non-optional `webhooks` property in TypeScript. Callers using a dynamically typed configuration must check whether the capability is enabled.

There is no root `captureWebhook`, generic public `send`, plugin registry, or placeholder HTTP/queue capability. The initial SDK API was uncommitted, so it has been replaced rather than kept as a compatibility alias.

## Implementation boundaries

- `packages/sdk/src/index.ts`: public composition and client-level configuration. Creates one transport per client and attaches enabled capabilities.
- `packages/sdk/src/transport.ts`: internal authenticated HTTP delivery. Owns origin validation, credential attachment, deadline cancellation, redirect refusal, concurrency bounds, response disposal, and failure isolation. It knows nothing about webhook HMACs, `/v1/ingest`, webhook payload fields, or their size limit. It is not exported through the public SDK entry point.
- `packages/sdk/src/webhooks.ts`: webhook configuration, byte validation, payload bounds, snapshotting, signature calculation, and the current webhook ingest route. Uses the shared transport rather than duplicating delivery behavior.
- `packages/domain/src/ingest.ts`: current API/SDK webhook wire constants. These are not a universal observation schema.

The transport reserves capacity before invoking a capability's synchronous preparation callback. This preserves the original bytes before the first asynchronous boundary without copying/signing payloads that would be dropped because the client is busy. The client has one delivery budget, rather than a separate unbounded sender for each future capability.

## Future evolution, not current implementation

New observation sources should be added only with concrete backend investigation requirements and acceptance tests. Each source should define its own useful context, evidence relationships, privacy constraints, payload contract, and appropriate endpoint/authentication scope. It should reuse the shared delivery isolation but not inherit webhook signing or an `event_id`/`type` envelope by accident.

HTTP requests, queue processing, and background jobs remain future work. No APIs or backend contracts for them are promised here. There is no universal event envelope, automatic instrumentation framework, exception tracking, retry queue, or durable telemetry store in the SDK. A different future transport or credential scope can be introduced when a real capability needs it; the current scoped ingest key must not imply permission to submit unrelated observations.

The existing backend remains webhook-specific in milestone 13. This refactor establishes SDK boundaries, not a claim that the API or investigation engine already handles arbitrary distributed-system incidents.

## Validation

`npm run test:sdk` covers the public client composition, optional webhook configuration, webhook wire compatibility, and shared delivery behavior. It also checks that a sample host keeps its own response when delivery fails or remains pending. `docs/webhook-sdk.md` documents the first capability's provisioning and usage.
