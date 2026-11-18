# MVP backend plan

This is the status of the FaultLens MVP backend. Read the table first. The sections below it are the work.

`docs/decisions.md` wins when it disagrees with this file, `docs/filling-the-skeletons.md`, or a design doc. The PRD and the roadmap used here are `design-spec/WireSleuth_PRD.docx` and `design-spec/WireSleuth_Implementation_Roadmap.docx`. P0 is the must-ship list in that PRD. M1 and M2 in the roadmap are the backend gate this file tracks. The UI, OpenTelemetry, model calls, and the GitHub integration are not in this gate.

## Keep this file current

Update this file in the same change that finishes a milestone.

1. Set that row in the table to `Done`, and set the next open row to `Now`. Only one row is `Now`.
2. Add the date and the check that proved it under that milestone. Name the command and the result. Do not write "done" because the code compiles.
3. If the work split or a P0 item was missing, add a row. Do not hide it in a paragraph.
4. If `docs/filling-the-skeletons.md` names the same function, update that line in the same change.
5. Leave `Later` rows alone until an operator moves one into the table.

A finished milestone that still says `Left` will be built twice.

## At a glance

Last checked against the source on 9 Nov 2026 for milestone 14: `npm run typecheck`, `npm run test:seed` (2 passed), and `npm test` (97 passed, 0 failed) are green. Space `app` is `4a8360364ef68361027912468ca5b834e3021eb93e348ba39934c388bb01721b`.

| | Milestone | Status | Done when |
| --- | --- | --- | --- |
| 1 | Verified ingest | Done | A known body is stored once. A bad signature stores an attempt and no event. A forced rollback leaves the tables unchanged. |
| 2 | Classify and group | Done | Two calls for one event leave one finding. Two events with one fingerprint share one incident. |
| 3 | Publish the outbox | Done | A second `dispatchPending` does not enqueue the same row. Redis down leaves `enqueuedAt` null. |
| 4 | Consume and classify | Done | One verified ingest, one publish, and the handler leave one finding. Running that path again leaves the same finding. |
| 5 | Crash and queue tests | Done | Duplicate delivery, database interruption, worker crash, queue downtime, and a rejected signature are covered by tests. |
| 6 | Payload bounds and schema errors | Done | An oversized body is refused. A malformed body returns a schema error with a field path and no secret. |
| 7 | Timeout finding | Done | A timeout scenario creates a `NETWORK_TIMEOUT` finding that cites the attempt. |
| 8 | Incident lifecycle | Done | A legal transition changes status. An illegal one does not. A manual override is recorded. |
| 9 | Authenticated read | Done | Page two repeats no id from page one. Search filters match the P0 list. An export has evidence ids and no signing secret. A bad token is `unauthorized`. |
| 10 | Feedback and audit | Done | A rating is stored for a finding. An audit row records who changed an incident status and when. |
| 11 | HTTP shell | Done | The route list is in the repo. A tokened request returns one page. A request without a token is unauthorized. |
| 12 | Hashed ingest keys | Done | A revoked key writes no event. A valid key stores one event, one attempt, and one outbox row. |
| 13 | SDK | Done | A sample host returns its own response when the SDK post fails. |
| 14 | Local install | Done | One documented command seeds fixtures and starts the backend with no model key. |
| 15 | Episode ingest & runtime rules | Done | Sealed `FlightRecorder` episodes post to `/v1/ingest/episodes`, redact secrets, and classify `INGRESS_ABORTED`, `DECRYPT_FAILURE`, `DOWNSTREAM_NETWORK_ERROR`, `UNHANDLED_EXCEPTION`, `ASYNC_ESCAPE_FAILURE`, and multi-event `OUT_OF_ORDER`. |
| 16 | Bounded read-only AI agent | Done | Optional agent runs in `apps/worker` (`packages/agent`), persists `ToolCall`/`Hypothesis`/`IncidentQuestion` provenance and USD cost estimates, enforces grounding/injection/workspace guardrails, and reports evaluation metrics. |

`Later`, not in the count above. OIDC for dashboard users. `OUT_OF_ORDER`. The UI. OpenTelemetry. Model calls. GitHub. Multiple workspaces, roles, and retention settings. CSV and PDF export.

## 1. Verified ingest

Status. Done.

`verify`, `redact`, and `ingest` are in `apps/api/src/ingest/`. A matching HMAC is `VERIFIED`. A missing or wrong header is `REJECTED`. The digest is the SHA-256 of the raw bytes. Secret fields are removed before persistence. `redactedPayloadJson` stays null under metadata-only capture. `workspaceId` comes from the integration.

The ingest result is a union a caller can switch on. `unknown-token` writes nothing. `rejected` stores an attempt with a null event id and an outbox row. `stored` writes the event, the attempt, and the outbox row in one transaction. The same body again is `duplicate`. A different digest for the same external id is `conflict`, and the first digest stays. `ingest` does not call Redis.

Checked by `apps/api/src/ingest/ingest.test.ts`, `verify.test.ts`, and `redact.test.ts`.

## 2. Classify and group

Status. Done.

`classifyJob` in `apps/worker/src/classify-job.ts` loads one event, builds an `IncidentContext`, and runs `RULES`. A finding is unique on event id, rule id, and rule version, and it belongs to an incident. The incident is unique on workspace, fingerprint, and rule version. The fingerprint is the integration, environment, failure class, and normalized endpoint. A new incident starts at `event_count` 1. A second event on that incident increments the count. A replay does not.

Rules that match from the current context are auth failure, rate limit, upstream 5xx, schema mismatch, invalid signature, duplicate delivery, and unknown. Evidence ids come from the context. `certainty` for those matches is `observed`. No model call.

Known limit. A replay does not refresh an explanation, and it does not drop an evidence link a later run would remove. The job loads every attempt and every evidence row, then filters in memory. `NETWORK_TIMEOUT` and `OUT_OF_ORDER` return no match. Timeout is milestone 7. Out of order is under Later.

Checked by `apps/worker/src/classify-job.test.ts` and `packages/rules/src/rules.test.ts`. The incident tables are in `prisma/schema.prisma` and `prisma/sql/incidents.sql`.

## 3. Publish the outbox

Status. Done.

`dispatchPending` in `apps/worker/src/dispatcher.ts` reads `outbox` rows whose `enqueuedAt` is null, enqueues one BullMQ job per row using `eventId` (or `attemptId` when `eventId` is null) as the job id, and sets `enqueuedAt` after the enqueue succeeds. If Redis is down, `enqueuedAt` is left null for subsequent retries. Returns the count of rows marked.

Checked on 8 Nov 2026 by `apps/worker/src/classify-job.test.ts` via `npm test` (30 passed).

Not in this milestone. The handler that calls `classifyJob`. That is milestone 4.

## 4. Consume and classify

Status. Done.

A worker handler in `apps/worker/src/consumer.ts` (`handleOutboxJob` and `createOutboxWorker`) consumes jobs from `outbox`. Jobs with an `eventId` invoke `classifyJob(eventId)`. Jobs with only an `attemptId` represent rejected deliveries and are completed without classification. A second delivery of the same job id is deduplicated by BullMQ, and `classifyJob` idempotently preserves existing findings.

Checked on 8 Nov 2026 by `apps/worker/src/classify-job.test.ts` via `npm test` (32 passed: `one verified ingest, one dispatchPending call, and the handler leave one finding; running that path again leaves the same finding`, and `a job with only an attempt id is a rejected delivery and finishes without classifying`).

Not in this milestone. The crash matrix. That is milestone 5.

## 5. Crash and queue tests

Status. Done.

The M1 exit is that a duplicate delivery does not duplicate logical processing, and source history survives crashes. Duplicate delivery and synthetic rollback cases are verified in `apps/api/src/ingest/ingest.test.ts`. Database interruption during ingest, worker crash after outbox insert before `enqueuedAt` is set, queue outage with unchanged committed delivery and recovery retry, and the 4-vector signature rejection matrix are verified in `apps/worker/src/classify-job.test.ts`.

A failed enqueue leaves committed deliveries unmutated, and the subsequent `dispatchPending` retries rows whose `enqueuedAt` is null. BullMQ deduplicates jobs by `jobId`, and worker consumption leaves single findings without duplication.

Checked on 8 Nov 2026 by `apps/worker/src/classify-job.test.ts` and `apps/api/src/ingest/ingest.test.ts` via `npm test` (36 passed, 0 failed; all 4 crash and queue failure scenarios plus baseline duplicate/rollback cases pass against real PostgreSQL on port 5432 and real Redis on port 6379).

## 6. Payload bounds and schema errors

Status. Done.

PRD P0-03 and AC-03. Ingest rejects an invalid signature. Payloads over `MAX_BODY_BYTES` (1 MiB = 1,048,576 bytes) are refused before persistence, returning `{ outcome: 'oversized' }` without writing any rows to `webhook_events`, `delivery_attempts`, or `outbox`. Payloads with malformed JSON or invalid schema return `{ outcome: 'schema-error', fieldPath, message, attemptId }` and store a `DeliveryAttempt` with `httpStatus: 400`, `errorCode: 'schema_error'`, `verificationState: 'VERIFIED'`, `eventId: null`, and an outbox row. Secret fields are redacted before persistence, and neither schema error results nor stored attempt records disclose signing secrets or raw secrets. Rejected signatures continue storing the attempt and outbox row with `eventId: null`.

Checked on 8 Nov 2026 by `apps/api/src/ingest/ingest.test.ts` via `npm test` (42 passed, 0 failed; an oversized body writes no event and a malformed body returns the field path with no secret in the result).

## 7. Timeout finding

Status. Done.

`DeliveryAttempt` now stores receiver processing time in `durationMs` and the sender's wait threshold in `senderWaitMs`. Both values are durations recorded independently; the rule does not subtract timestamps from different machines. `NETWORK_TIMEOUT` matches when receiver processing meets or exceeds the sender wait, returns `certainty: inferred`, and only cites evidence linked to the matching attempts. Missing durations and processing completed before the sender deadline do not match.

The database change is in `migrations/app/20261108T2003_add_sender_wait_duration`. `classifyJob` carries both stored values into `IncidentContext`.

Checked on 8 Nov 2026 by `packages/rules/src/rules.test.ts` and `apps/worker/src/classify-job.test.ts` via `npm run typecheck` and `npm test` (43 passed, 0 failed). The integration fixture creates one `NETWORK_TIMEOUT` finding linked to its delivery-attempt evidence.

`OUT_OF_ORDER` stays empty. It is not in the P0 class list. It is under Later.

## 8. Incident lifecycle

Status. Done.

PRD P0-06. Classification inserts `OPEN` and never changes it. `transitionIncident` and `canTransitionIncident` in `apps/api/src/incidents/lifecycle.ts` (re-exported from `apps/api/src/read/incidents.ts`) apply transitions for a workspace using `INCIDENT_TRANSITIONS` (`OPEN -> INVESTIGATING, RESOLVED, ARCHIVED`, `INVESTIGATING -> RESOLVED, ARCHIVED`, `RESOLVED -> ARCHIVED`, `ARCHIVED -> []`).

A legal move updates `status` in a row-locked transaction and returns `{ outcome: 'transitioned', previousStatus, status }`. A second identical move does not write and returns `{ outcome: 'unchanged', previousStatus, status }`. An edge not in `INCIDENT_TRANSITIONS` does not write and returns `{ outcome: 'illegal', previousStatus, status }`. An unknown incident or mismatched workspace returns `{ outcome: 'missing', status: null }`. Manual overrides use the same `INCIDENT_TRANSITIONS` table without inventing a fifth status, and subsequent classifications preserve the overridden status. A transitioned move records `actor` on an `AuditEvent`. That write is milestone 10.

Checked on 8 Nov 2026 by `apps/api/src/incidents/lifecycle.test.ts` via `npm run typecheck` and `npm test` (47 passed, 0 failed).

## 9. Authenticated read

Status. Done.

PRD P0-04 and AC-06. `listEvents` and `listAttempts` in `apps/api/src/read/events.ts`, `listIncidents` in `apps/api/src/read/incidents.ts`, and `exportIncident` in `apps/api/src/read/export.ts` require an `adminToken` and a trusted `workspaceId` argument. `verifyAdminToken` in `apps/api/src/read/auth.ts` compares the provided token against `FAULTLENS_ADMIN_TOKEN` (from `apps/api/src/config.ts`) in constant time using `crypto.timingSafeEqual`. A missing or wrong token returns `{ kind: 'unauthorized' }` without throwing.

`listEvents` orders by `firstReceivedAt` ascending then `id` ascending, supports cursor pagination (`cursor: null` for page one, last row `id` for subsequent pages, and `nextCursor: null` on the last page), and filters by integration, time range (`from` / `to`), external event id, status (`processingState`), error class (`errorClass` / `failureClass`), and trace id. `listAttempts` returns only attempts for that event in that workspace, or `[]`. `listIncidents` returns the workspace's incidents with their lifecycle `status`, optionally filtered by `failureClass`. `exportIncident` returns the incident, chronological `timeline` of linked events, attempts, cited `evidence`, and findings with `evidenceIds` verified against `evidence`, containing no signing secret and no raw payload, or `{ kind: 'missing' }` when absent.

Checked on 8 Nov 2026 by `apps/api/src/read/read.test.ts` via `npm run typecheck` and `npm test` (49 passed, 0 failed).

## 10. Feedback and audit

Status. Done.

PRD P0-10 and AC-10. `Feedback` and `AuditEvent` are in `prisma/schema.prisma` and `prisma/sql/incidents.sql`. The migration is `migrations/app/20261108T2116_add_feedback_and_audit`. `npx prisma db migrate` and `npx prisma db sign` advanced space `app` to `550abe7d3161095409a9ec24dcdb674c2ab6c031e8fc4abe55c121c65915a1f6`.

`rateFinding` in `apps/api/src/feedback/feedback.ts` locks the finding in the caller's workspace. The first rating from an actor inserts one `Feedback` row. A later rating from that same actor updates that row's `rating`, `note`, and `createdAt`. The unique key is `(finding_id, actor)`. Two actors leave two rows. A missing finding returns `{ outcome: 'missing' }` and writes nothing. Ratings are `USEFUL` and `INCORRECT`.

`recordAudit` in `apps/api/src/audit/audit.ts` inserts one `AuditEvent` in the caller's transaction. `objectType` comes from `AUDIT_OBJECT_TYPE` in `packages/domain/src/states.ts`, so `INCIDENT_STATUS_CHANGED` is `INCIDENT` and `FINDING_RATED` is `FINDING`. `transitionIncident` writes that row only on `transitioned`, with `oldState` the status it moved from. `unchanged`, `illegal`, and `missing` write no audit row. Every `rated` or `replaced` result from `rateFinding` writes one `FINDING_RATED` row in the same transaction. The first rating stores `oldState` null. A replacement stores the previous rating.

`listFindingFeedback` and `listAuditEvents` take `adminToken` and `workspaceId`. `verifyAdminToken` rejects a missing or wrong token, and a blank workspace returns `{ kind: 'unauthorized' }`. Both reads stay inside the workspace. `listAuditEvents` orders by `timestamp` then `id`. `toAuditEvent` reads `old_state` and `new_state` back into `IncidentStatus` or `FeedbackRating` and throws when the stored text is not in that list.

Checked on 8 Nov 2026 by `apps/api/src/feedback/feedback.test.ts` via `npm run typecheck` and `npm test` (55 passed, 0 failed). Two ratings from one actor leave one `Feedback` row. A status change reads back as the actor and the status it moved from.

## 11. HTTP shell

Status. Done.

The route list is `apps/api/src/http/routes.ts`. `docs/http-routes.md` lists the same routes, and `apps/api/src/http/routes.test.ts` fails when a heading and a `ROUTES` entry disagree. `apps/api/src/http/server.ts` uses Hono (`hono` and `@hono/node-server`) as the HTTP adapter. It registers that list and checks the admin token before a controller reads a body. A controller in `apps/api/src/http/controllers/` calls one domain function per route. Those functions do not import Hono.

`POST /v1/ingest` takes the ingest credential as `Authorization: Bearer`. `stored` and `duplicate` respond 200, which matches the `httpStatus` `ingest` stores on the attempt. `POST /hooks/:token` is mounted only when `FAULTLENS_SIMULATED_WEBHOOKS` is `1`. Admin routes use `FAULTLENS_ADMIN_TOKEN`. The workspace id is `FAULTLENS_WORKSPACE_ID` and the actor on a write is `FAULTLENS_ADMIN_ACTOR`. A `workspaceId` query parameter is 400.

Checked on 8 Nov 2026 by `apps/api/src/http/server.test.ts` via `npm run typecheck` and `npm test` (65 passed, 0 failed). A tokened `GET /v1/events?limit=1` returns one page, and the next page does not repeat that id. The same path with no token or a wrong token is 401.

Checked again on 8 Nov 2026, after `apps/api/src/http/server.ts` moved to Hono, by `npm run typecheck` and `node --import tsx --test --test-concurrency=1 apps/api/src/http/routes.test.ts apps/api/src/http/server.test.ts` (10 passed, 0 failed).

## 12. Hashed ingest keys

Status. Done.

`IngestKey` stores only a SHA-256 hash of a 32-byte random credential, its integration/workspace/environment scope, creation time, and optional revocation time. `createIngestKey`, `rotateIngestKey`, and `revokeIngestKey` are in `apps/api/src/ingest/keys.ts`. Creation and rotation return the raw key once; reads cannot retrieve it. Rotation atomically revokes the previous key and inserts its replacement. Key row locks serialize authorization with revocation, so revocation waits for an already-authorized delivery to finish before returning. Scope mismatches fail closed.

`ingest` and `POST /v1/ingest` accept active hashed keys only; there is no fallback to legacy endpoint tokens. The signature still uses the integration's signing secret. `ingestSimulated` explicitly resolves legacy simulation tokens for the feature-gated `POST /hooks/:token` route. Operator-only creation, rotation, and revocation commands use `npm run ingest-key -- <command> <id>`, with the workspace from server configuration. Provisioning and upgrade instructions are in `docs/ingest-keys.md`.

Migration `20261108T2356_hashed_ingest_keys` adds the table and indexes. Existing endpoint tokens are not migrated into production keys. `npx prisma db migrate` and `npx prisma db sign` advanced space `app` to `4a8360364ef68361027912468ca5b834e3021eb93e348ba39934c388bb01721b`.

Checked on 9 Nov 2026 by `npm run typecheck`, `npm run test:keys` (6 passed), and `npm run test:http` (14 passed). Also checked `node --import tsx --test --test-concurrency=1 apps/api/src/ingest/ingest.test.ts apps/api/src/ingest/keys.test.ts apps/api/src/http/server.test.ts` against a newly migrated disposable PostgreSQL database (25 passed, 0 failed; database removed afterward). A revoked key writes no delivery records. A valid HTTP key stores one event, one attempt, and one outbox row. Rotation, workspace/environment isolation, hash-only persistence, and production/simulation credential separation are covered.

## 13. SDK

Status. Done.

`createFaultLensClient` in `packages/sdk/src/index.ts` is the product-level SDK entry point. It creates a shared transport for authentication, deadlines, concurrency bounds, and failure isolation. The optional `webhooks` capability exposes `client.webhooks.capture(rawBody)`, owns webhook signing configuration, signs a byte-for-byte snapshot with HMAC-SHA256, and selects the current `/v1/ingest` route. The shared core requires no webhook signing secret. Shared webhook signature-header and body-limit constants live in `packages/domain/src/ingest.ts`. The SDK has no database, Redis, HTTP-framework, or model dependency and is available through the root `#sdk` import without a nested package manifest. Product scope and SDK boundaries are in `docs/sdk-architecture.md`: incident investigation is the product; webhook investigation is its first capability, not the shape of all future observations.

Delivery failures resolve as data rather than rejecting. A bounded deadline aborts stalled requests, oversized payloads are dropped locally, and a per-client concurrency bound drops excess calls instead of queueing. Redirects are refused. Response bodies and errors are not exposed or logged. There are no retries or durable-delivery guarantees.

`apps/sdk-example/src/server.ts` is a sample Node webhook host. It sends its own 202 response without awaiting SDK delivery. Run it with `npm run start:sdk-example`; provisioning, usage, failure semantics, and the API-down demonstration are in `docs/webhook-sdk.md`.

Checked on 9 Nov 2026 by `npm run typecheck` and `npm run test:sdk` (13 passed, 0 failed). Tests cover optional capability composition, a webhook-independent shared transport, off-origin path rejection, and exact-byte signature compatibility, mutation safety, API-key headers, error responses, network failures, deadlines, concurrency limits, payload bounds, redirect refusal, and the sample host returning its unchanged response while telemetry fails or is still pending. Regression checks: `npm run test:http` (14 passed) and `node --import tsx --test apps/api/src/ingest/verify.test.ts apps/api/src/ingest/redact.test.ts packages/rules/src/rules.test.ts` (16 passed).

Not in this milestone. HTTP client instrumentation, queues, and background jobs. The decision says those come after webhook instrumentation.

## 14. Local install

Status. Done.

PRD P0-11 and AC-11. `docker-compose.yml` and `Dockerfile` at the repository root start `postgres`, `redis`, the `seed` job (`npm run seed`), the `api` server (`npm run start:api`), and the `worker` (`npm run start:worker` in `apps/worker/src/main.ts`) with `docker compose up --build -d` and no model key. When PostgreSQL and Redis are already running locally, `npm run start:local` (`apps/api/src/seed/local-start.ts`) seeds the product database and starts both the API server and worker in one command.

`seedProductFixtures` in `apps/api/src/seed/seed.ts` (invoked by `apps/api/src/seed/seed-cli.ts`) applies the idempotent schema (`prisma/sql/incidents.sql`), seeds two integrations (`/hooks/billing` and `/hooks/orders`) and their hashed ingest keys, loads the eight deterministic failure scenarios (`auth-401`, `rate-limit-429`, `upstream-503`, `network-timeout`, `schema-mismatch`, `invalid-signature`, `duplicate-delivery`, and `out-of-order`), and runs `classifyJob` to create the eight incidents (`AUTH_FAILURE`, `RATE_LIMIT`, `UPSTREAM_5XX`, `NETWORK_TIMEOUT`, `SCHEMA_MISMATCH`, `INVALID_SIGNATURE`, `DUPLICATE_DELIVERY`, and `UNKNOWN`) and their cited evidence links. Deterministic IDs and `ON CONFLICT DO NOTHING` ensure a second run does not duplicate any seeded events, attempts, evidence rows, findings, or incidents. Setup and incident inspection instructions are in `docs/local-install.md`.

Checked on 9 Nov 2026 by `apps/api/src/seed/seed.test.ts` via `npm run typecheck`, `npm run test:seed` (2 passed, 0 failed), and `npm test` (97 passed, 0 failed).

## Later

These stay out of the milestone count until an operator moves one up.

OIDC. `docs/decisions.md` says dashboard users use OIDC. The PRD puts SSO in P1 and says the MVP is one admin with server-side authentication. Milestone 9 is that local admin. OIDC is not started here.

OpenTelemetry collector ingest (`OTLP`) and read-only GitHub deploy/commit correlation remain post-MVP extensions.

Multiple workspaces, roles, and CSV or PDF export remain P1 or later features. Metadata-only capture stays the default.
