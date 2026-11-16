# Fill the skeleton functions

Decisions that override this guide are in `docs/decisions.md`. Where this page disagrees with that file, follow that file. Milestone status lives in `docs/mvp-backend-plan.md`. Update that file in the same change that finishes a milestone.

Real production traffic is the SDK and the versioned ingestion API. A generic webhook route is for simulated traffic only. Capture defaults to metadata-only. Redacted and raw capture are explicit. Redact before persistence and before any model call. Raw payloads are encrypted, access-controlled, and kept 1 day unless that retention is changed. Dashboard users use OIDC. Ingestion uses scoped hashed API keys. Local development has a simplified authentication mode.

Fill the functions in the order below. Each one throws `not implemented` until you replace that throw. Steps 1 through 10 are implemented, including the duration-based `NETWORK_TIMEOUT` rule and the authenticated read API.

The tests only check the throw. When your function returns a promise, change the test so it `await`s that promise. A function that fails inside `async` rejects. The old test still expects a synchronous throw, so it fails for the wrong reason.

1. `verify` in `apps/api/src/ingest/verify.ts`
2. `redact` in `apps/api/src/ingest/redact.ts`
3. `ingest` in `apps/api/src/ingest/ingest.ts`
4. `dispatchPending` in `apps/worker/src/dispatcher.ts`
5. `classifyJob` in `apps/worker/src/classify-job.ts`
6. `evaluate` in each file under `packages/rules/src/classes/`
7. `fingerprint` in `packages/rules/src/fingerprint.ts`
8. `listEvents` and `listAttempts` in `apps/api/src/read/events.ts`
9. `listIncidents` in `apps/api/src/read/incidents.ts`
10. `exportIncident` in `apps/api/src/read/export.ts`

## verify

`verify(rawBody, headers)` returns `VERIFIED` or `REJECTED`. It does not write a row.

`Integration` has no signing-secret column. Add one first. Keep the secret off `WebhookEvent` and out of every read response.

Write this.

1. HMAC-SHA256 the raw bytes. Hash those bytes, not a re-parsed JSON object.
2. Compare the header to that digest with `crypto.timingSafeEqual`. The buffers must be the same length.
3. Return `REJECTED` when the header is missing or the MAC does not match.
4. Return `VERIFIED` when the MAC matches.

Done when a known body and secret return `VERIFIED`, and a wrong secret returns `REJECTED`. There is no test file yet. Add `apps/api/src/ingest/verify.test.ts`.

Read [RFC 2104](https://www.rfc-editor.org/rfc/rfc2104) for HMAC, and [Node `timingSafeEqual`](https://nodejs.org/api/crypto.html#cryptotimingsafeequala-b) for the compare. [Stripe webhook signatures](https://docs.stripe.com/webhooks/signature) are a worked example. Use the idea. Pick your own header name.

## redact

`redact(rawBody)` returns `{ digest, redacted }`. It does not write a row.

Write this.

1. Set `digest` to the hex SHA-256 of the raw buffer. Same bytes, same digest. The hex string is 64 characters.
2. Parse the body as JSON. If parsing fails, set `redacted` to `null` and still return the digest.
3. Remove fields that hold secrets. Start with `secret`, authorization material, and a signing key.

Done when a body that contains `secret` comes back without that value, and the digest does not change between two calls.

Read the hash in `unreliable-systems/receiver/src/ingest.js`. It hashes raw bytes for the same reason. The [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html) is the rule for what you strip.

## ingest

`ingest({ token, rawBody, headers })` commits one delivery and returns a discriminated result. It does not call Redis. Milestone 12 is implemented: real ingest resolves a hashed key scoped to the integration, workspace, and environment. `ingestSimulated` is the explicit simulation-only entry point that resolves `Integration.endpointToken`. Key creation, rotation, and revocation are in `apps/api/src/ingest/keys.ts`; operator commands are documented in `docs/ingest-keys.md`.

Call `verify` and `redact`. Do not copy their logic into this file.

The return type cannot say "unknown token" or "conflict". `attemptId` is a `string`. Change the return type when you need those results. Prefer a result you can switch on. Do not `throw` a plain string.

The client is `src/prisma/db.ts`. `DATABASE_URL` points at the `faultlens` database.

Write this.

1. Resolve an active `IngestKey` by the SHA-256 hash of the provided key, then find its integration in the stored workspace and environment. A missing, revoked, or mismatched key writes no row. Only `ingestSimulated` uses `endpointToken`.
2. If `verify` returns `REJECTED`, insert a `DeliveryAttempt` with `eventId` null and an `Outbox` row for that attempt. Commit.
3. If `verify` returns `VERIFIED`, call `redact`.
4. Insert the `WebhookEvent`, or reuse the one that already has this `integrationId` and `externalEventId`. A second delivery keeps the same event and adds another attempt. A different digest is a conflict. Still store the attempt.
5. Insert the attempt and the outbox row in the same transaction. Leave `enqueuedAt` null.
6. Commit. Then return. `eventId` is null when you stored no event.

`workspaceId` comes from the integration. Ignore a workspace id in the webhook body.

Done when a forced rollback leaves `webhook_events` and `outbox` unchanged. Update `apps/api/src/ingest/ingest.test.ts`. It currently only expects the throw.

Read [Prisma interactive transactions](https://www.prisma.io/docs/orm/prisma-client/queries/transactions). Two null `externalEventId` values do not collide in PostgreSQL. That is [unique-index behavior](https://www.postgresql.org/docs/current/indexes-unique.html). The duplicate-versus-conflict branch already exists in `unreliable-systems/receiver/src/ingest.js`. This schema has no `outcome` column. Use `verificationState` and `handlerState`.

## dispatchPending

`dispatchPending()` publishes outbox rows that have no `enqueuedAt`. It returns how many rows it marked. The API does not call it. A failed enqueue does not change a delivery that already committed.

Write this.

1. Read `Outbox` rows where `enqueuedAt` is null.
2. Enqueue one BullMQ job per row. The job id is the event id, or the attempt id when the event id is null.
3. Set `enqueuedAt` only after that enqueue succeeds.
4. If Redis is down, leave `enqueuedAt` null. The next call retries those rows.
5. Return the count.

Done when a second call does not enqueue the same row again. Update the `dispatchPending` test in `apps/worker/src/classify-job.test.ts`.

Read [BullMQ job ids](https://docs.bullmq.io/guide/jobs/job-ids). The id is what makes the second call a no-op. The pattern name is the [transactional outbox](https://microservices.io/patterns/data/transactional-outbox.html). `ingest` wrote the row. This function publishes it.

## classifyJob

`classifyJob(eventId)` stores findings for one event. A second call does not insert those findings again.

Stop here if `Finding`, `Incident`, and `InvestigationRun` are still missing from `prisma/schema.prisma`. Add them before this function. The minimum the later checks need:

- `Finding` stores the event id, the failure class, the explanation, `certainty`, and links to `Evidence` ids.
- `Incident` stores the workspace id, the fingerprint, the failure class, and an `IncidentStatus`.
- `InvestigationRun` stores the event id, `mode` `RULES`, the rule `version`, and a run state.

`design-spec/WireSleuth_Technical_Architecture.docx` has the rest of those records. Do not call a model.

Write this.

1. Load the event, its attempts, and its evidence.
2. Build an `IncidentContext`. Rules only read that object. They do not query the database.
3. Call `evaluate` on every entry in `RULES` from `packages/rules/src/index.ts`.
4. Keep every match. Two rules may both match.
5. Upsert each finding on event id + rule id + rule version.
6. Upsert the incident on the fingerprint from the next section.
7. Write the investigation run with `mode` `RULES`.

Done when two calls for one event leave one finding per match. Replace the throw test in `apps/worker/src/classify-job.test.ts`.

Read the [idempotent consumer](https://microservices.io/patterns/communication-style/idempotent-consumer.html). The upsert key is the idempotency key.

## evaluate

Each class file exports `rule`. Fill `rule.evaluate`. Leave `id` and `version` alone. `version` is `"0"`.

`packages/rules/src/index.ts` already lists `RULES` in `FAILURE_CLASSES` order. Do not rebuild that list.

Every `evaluate(ctx)` does four things.

1. Return `[]` when this class does not apply.
2. Return one `RuleMatch` when it does. `failureClass` is the file's `id`.
3. `evidenceIds` are ids from `ctx.evidence`. An id from anywhere else is wrong.
4. `certainty` is `observed` when a status, a digest, or a stored timestamp shows the fact. It is `inferred` when you compared two durations. Write `explanation` from those facts. Leave `severityHint` unset.

`UNKNOWN` is a normal return. Use it when the other rules returned `[]`, or when the evidence they need is missing.

| Class | File | Return a match when |
| --- | --- | --- |
| `AUTH_FAILURE` | `packages/rules/src/classes/auth-failure.ts` | An attempt is an authentication failure, such as HTTP 401. |
| `RATE_LIMIT` | `packages/rules/src/classes/rate-limit.ts` | An attempt is HTTP 429. |
| `NETWORK_TIMEOUT` | `packages/rules/src/classes/network-timeout.ts` | The attempt timed out. Compare in-flight time with how long the sender waited. |
| `UPSTREAM_5XX` | `packages/rules/src/classes/upstream-5xx.ts` | An attempt status is 500 through 599. |
| `SCHEMA_MISMATCH` | `packages/rules/src/classes/schema-mismatch.ts` | The body failed validation. |
| `INVALID_SIGNATURE` | `packages/rules/src/classes/invalid-signature.ts` | `verify` returned `REJECTED` for that attempt. |
| `DUPLICATE_DELIVERY` | `packages/rules/src/classes/duplicate-delivery.ts` | Two deliveries share an external id and a digest. |
| `OUT_OF_ORDER` | `packages/rules/src/classes/out-of-order.ts` | Arrival order and `occurredAt` disagree. |
| `UNKNOWN` | `packages/rules/src/classes/unknown.ts` | No other rule matched. |

Done when `node --import tsx --test packages/rules/src/rules.test.ts` still shows the nine ids in order, and one context for a class returns that class.

Read `timeoutFindings`, `validationFindings`, and `duplicateFindings` in `unreliable-systems/diagnose/diagnose.js` before those three rules. Compare durations for the timeout. Do not compare clocks from two machines. Auth, rate limit, upstream 5xx, and invalid signature have no fixture bytes yet. You cannot assert those four until you add the bytes.

`RuleMatch` and `ClassificationRule` are in `packages/domain/src/entities.ts` (exported from `#domain`). The class list is also in `design-spec/WireSleuth_Technical_Architecture.docx`.

## fingerprint

`fingerprint({ integrationId, environment, failureClass, endpoint })` returns a string. Group incidents with that string.

Write this.

1. Normalize the endpoint the same way every time. Pick one rule for case and trailing slashes.
2. Combine integration, environment, failure class, and that endpoint.
3. Return the string. Same inputs, same string. A different class, a different string.

Done when two timeouts for one integration and one endpoint produce one key, and a timeout plus a schema failure produce two keys.

A hash is fine if you also store the four parts on the incident. Otherwise you cannot see why two events grouped.

## listEvents

`listEvents(cursor)` returns one page of `WebhookEvent` and `nextCursor`. It does not write.

The arguments have no admin token and no workspace id. Add both. A missing token fails. The workspace id comes from the caller you trust, not from the query string alone. Apply that same pair to `listAttempts`, `listIncidents`, and `exportIncident`.

Write this.

1. Order by `firstReceivedAt`, then `id`.
2. A null cursor is the first page. Any other cursor is the last row of the previous page.
3. Return `nextCursor: null` on the last page.

Done when page two does not repeat an id from page one. Update `apps/api/src/read/read.test.ts`.

## listAttempts

`listAttempts(eventId)` returns the attempts for that event.

Write this.

1. Return only rows with that `eventId`.
2. Return `[]` when the event has no attempts.

Done when a second event's attempts are absent from the result.

## listIncidents

`listIncidents(failureClass)` returns `{ id, failureClass }` rows. It needs the `Incident` table from `classifyJob`.

Write this.

1. A null class returns the workspace's incidents.
2. A class returns only that class.

Done when a `NETWORK_TIMEOUT` filter returns no other class.

## exportIncident

`exportIncident(incidentId)` returns the incident id and each finding's `evidenceIds`. It needs the finding-to-evidence link from `classifyJob`.

Write this.

1. Load the incident and its findings.
2. Every evidence id in the result exists in `evidence`.
3. The JSON has no signing secret and no raw payload.

Done when a known incident returns its evidence ids, and a missing incident does not return another incident's findings.

## Specs

`design-spec/WireSleuth_PRD.docx` is who the product is for.

`design-spec/WireSleuth_Technical_Architecture.docx` is the records and the rule contract.

`prisma/schema.prisma` is the database that exists today.

`packages/domain/src/entities.ts` is the TypeScript shape of an event, an attempt, evidence, and `IncidentContext`.

If the request has a `traceparent` header, copy the trace id onto the event. [W3C Trace Context](https://www.w3.org/TR/trace-context/) is the header. The lab already sends it. Do not put the raw body on a span.
