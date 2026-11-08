# MVP backend plan

This is the status of the WireSleuth MVP backend. Read the table first. The sections below it are the work.

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

Last checked against the source on 8 Nov 2026. Earlier that day `npm test` was green and `npx prisma db sign` signed space `app` as `b34168499028a08c57d0b23c5456220acb24cb7344d1435037262f7219a8bc5e`. This pass did not re-run those commands.

| | Milestone | Status | Done when |
| --- | --- | --- | --- |
| 1 | Verified ingest | Done | A known body is stored once. A bad signature stores an attempt and no event. A forced rollback leaves the tables unchanged. |
| 2 | Classify and group | Done | Two calls for one event leave one finding. Two events with one fingerprint share one incident. |
| 3 | Publish the outbox | Now | A second `dispatchPending` does not enqueue the same row. Redis down leaves `enqueuedAt` null. |
| 4 | Consume and classify | Left | One verified ingest, one publish, and the handler leave one finding. Running that path again leaves the same finding. |
| 5 | Crash and queue tests | Left | Duplicate delivery, database interruption, worker crash, queue downtime, and a rejected signature are covered by tests. |
| 6 | Payload bounds and schema errors | Left | An oversized body is refused. A malformed body returns a schema error with a field path and no secret. |
| 7 | Timeout finding | Left | A timeout scenario creates a `NETWORK_TIMEOUT` finding that cites the attempt. |
| 8 | Incident lifecycle | Left | A legal transition changes status. An illegal one does not. A manual override is recorded. |
| 9 | Authenticated read | Left | Page two repeats no id from page one. Search filters match the P0 list. An export has evidence ids and no signing secret. A bad token is `unauthorized`. |
| 10 | Feedback and audit | Left | A rating is stored for a finding. An audit row records who changed an incident status and when. |
| 11 | HTTP shell | Left | The route list is in the repo. A tokened request returns one page. A request without a token is unauthorized. |
| 12 | Hashed ingest keys | Left | A revoked key writes no event. A valid key stores one event, one attempt, and one outbox row. |
| 13 | SDK | Left | A sample host returns its own response when the SDK post fails. |
| 14 | Local install | Left | One documented command seeds fixtures and starts the backend with no model key. |

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

Status. Now.

`dispatchPending` in `apps/worker/src/dispatcher.ts` still throws. This is the next change.

`ingest` already inserts `outbox` rows with `enqueuedAt` null. This milestone publishes them. It does not classify.

Work.

1. Add `bullmq` and a local Redis. The lab compose file at `unreliable-systems/docker-compose.yml` runs Postgres only.
2. Read `outbox` rows whose `enqueuedAt` is null.
3. Enqueue one job per row. The job id is `eventId`. When `eventId` is null, the job id is `attemptId`. That row is a rejected delivery.
4. Set `enqueuedAt` only after that enqueue succeeds.
5. If Redis is down, leave `enqueuedAt` null. The next call retries those rows.
6. Return the count of rows marked.
7. The API does not call this function. A loop in the worker does.

Done when a second call does not enqueue the same row, and a failed Redis connection leaves `enqueuedAt` null. Replace the throw test in `apps/worker/src/classify-job.test.ts`.

Not in this milestone. The handler that calls `classifyJob`. That is milestone 4.

## 4. Consume and classify

Status. Left.

A worker handler takes the job from milestone 3.

A job with an event id calls `classifyJob`. A job with only an attempt id is a rejected delivery. The handler finishes it and does not classify. A second delivery of the same job id is a no-op in BullMQ, and `classifyJob` already refuses a second finding.

Done when one verified ingest, one `dispatchPending` call, and the handler leave one finding, and running that path again leaves the same finding.

Not in this milestone. The crash matrix. That is milestone 5.

## 5. Crash and queue tests

Status. Left.

The M1 exit is that a duplicate delivery does not duplicate logical processing, and source history survives crashes. The duplicate and rollback cases already pass in `ingest.test.ts`. The rest do not exist yet.

Add tests for a database interruption during ingest, a worker crash after the outbox insert and before `enqueuedAt` is set, a queue outage, and a rejected signature. A failed enqueue must not change the committed delivery. The next `dispatchPending` retries rows that are still null.

Done when those four cases, plus the existing duplicate case, pass against the real database and a real Redis.

## 6. Payload bounds and schema errors

Status. Left.

PRD P0-03 and AC-03. Ingest rejects an invalid signature. It does not yet reject an oversized body, and a malformed body does not return a field path.

Work.

1. Refuse a body over a fixed byte limit before persistence. Record the limit next to the check.
2. A body that is not the expected shape returns a schema error that names the field path.
3. The error and any stored attempt contain no signing secret and no raw secret field.
4. A rejected signature still stores the attempt and the outbox row, as it does now.

Done when an oversized body writes no event, and a malformed body returns the field path with no secret in the result.

## 7. Timeout finding

Status. Left.

PRD P0-05 and AC-04 require a timeout finding that cites the attempt. `packages/rules/src/classes/network-timeout.ts` returns no match. One `durationMs` cannot show a timeout. The lab compares in-flight time on the same row with how long the sender waited. Do not subtract clocks from two machines.

Work.

1. Extend `IncidentContext` with the two durations the comparison needs. Both come from stored columns, not from a second machine's clock.
2. Return one `NETWORK_TIMEOUT` match when the comparison says the attempt timed out. `evidenceIds` are ids already on the context. `certainty` is `inferred` because this compares two durations.
3. Leave the rule empty if those two values are absent. Do not guess.

Done when a fixture with both durations creates one timeout finding that cites that attempt, and a context without them creates none.

`OUT_OF_ORDER` stays empty. It is not in the P0 class list. It is under Later.

## 8. Incident lifecycle

Status. Left.

PRD P0-06. Classification inserts `OPEN` and never changes it. The legal transitions already live in `INCIDENT_TRANSITIONS` in `packages/domain/src/states.ts`.

```
OPEN -> INVESTIGATING, RESOLVED, ARCHIVED
INVESTIGATING -> RESOLVED, ARCHIVED
RESOLVED -> ARCHIVED
ARCHIVED -> none
```

Work.

1. Add a command that applies one transition for a workspace. An edge that is not in the table does not write.
2. A manual override uses the same table. It does not invent a fifth status.
3. The write that records who did it belongs to milestone 10. This milestone returns the new status. Milestone 10 stores the audit row for that write.

Done when a legal move changes `status`, an illegal move leaves it, and a second identical move stays on the same status.

## 9. Authenticated read

Status. Left.

`listEvents`, `listAttempts`, `listIncidents`, and `exportIncident` still throw. The fill steps are in `docs/filling-the-skeletons.md`. P0-04 and AC-06 ask for more than those steps.

Every read takes an admin token and a workspace id. The workspace id is an argument from the caller. It is not taken from the query string alone. The local check is `WIRESLEUTH_ADMIN_TOKEN`, compared in constant time. A missing or wrong token returns `{ kind: 'unauthorized' }`. It does not throw a string. This is the simplified local mode in `docs/decisions.md`. OIDC is under Later.

`listEvents` orders by `firstReceivedAt`, then `id`. A null cursor is the first page. Any other cursor is the last row of the previous page. The last page has `nextCursor: null`. Filters are integration, time range, external event id, status, error class, and trace id. That is P0-04.

`listAttempts` returns only that event in that workspace, or an empty list.

`listIncidents` returns the workspace's incidents. A failure class argument keeps only that class. The row includes the status from milestone 8.

`exportIncident` returns the incident, the timeline of linked events, the attempts, and each finding's evidence ids. Every evidence id exists in `evidence`. The JSON has no signing secret and no raw payload. A missing incident returns `{ kind: 'missing' }` and no other incident's rows.

Done when page two repeats no id from page one, each P0-04 filter excludes a non-matching row, a class filter returns only that class, an export cites the stored evidence, and a bad token is `unauthorized`. Update `apps/api/src/read/read.test.ts`.

## 10. Feedback and audit

Status. Left.

PRD P0-10 and AC-10. The architecture doc names `Feedback` and `AuditEvent`. Neither table exists.

`Feedback` stores the finding id, the actor, the rating, an optional note, and the time. Ratings are useful and incorrect. A second rating from the same actor replaces the earlier one.

`AuditEvent` stores the actor, the action, the object type, the object id, the old state, the new state, and the time. The status command from milestone 8 writes one row. A rating writes one row.

Done when a finding has one rating after two ratings from the same actor, and a status change can be read back as who moved it and from which status.

## 11. HTTP shell

Status. Left.

No Nest controller until the route list is a file in this repo. The architecture doc names NestJS for `apps/api` and the worker. A controller with no route is not that app.

Write the route list first. It covers the versioned ingest POST and the reads and writes from milestones 8, 9, and 10. Then add Nest controllers that call those functions and nothing else.

Done when a request with the admin token returns one page of events, and a request without it returns unauthorized. The generic webhook path stays simulated traffic.

## 12. Hashed ingest keys

Status. Left.

`docs/decisions.md` says real traffic uses scoped hashed API keys. The integration still stores a signing secret. The secret must stay out of read and export responses.

Work.

1. Store a hash of the ingest key. The raw key is shown once at creation.
2. The key is scoped to the workspace and can be rotated and revoked.
3. The versioned ingest route from milestone 11 accepts that key.
4. The generic webhook path still accepts simulated traffic only.

Done when a revoked key writes no event, and a valid key stores one event, one attempt, and one outbox row.

## 13. SDK

Status. Left.

`packages/sdk` does not exist. The SDK is a webhook helper for a Node service. It signs the raw body and posts to the versioned ingest route. A failure to deliver does not fail the host handler. The host still returns its own response.

Done when a sample host returns that response while the SDK post fails.

Not in this milestone. HTTP client instrumentation, queues, and background jobs. The decision says those come after webhook instrumentation.

## 14. Local install

Status. Left.

PRD P0-11 and AC-11. A fresh checkout needs one documented command that seeds fixtures and starts the backend with no model key. Today the only compose file is the lab. There is no product seed command.

The command starts Postgres, Redis, the API, and the worker. The seed loads the eight lab scenarios into the product database. The docs say how to run it and how to see one incident.

Done when that command is the one in the doc, and a second run does not duplicate the seeded events.

## Later

These stay out of the milestone count until an operator moves one up.

OIDC. `docs/decisions.md` says dashboard users use OIDC. The PRD puts SSO in P1 and says the MVP is one admin with server-side authentication. Milestone 9 is that local admin. OIDC is not started here.

`OUT_OF_ORDER`. The rule file returns no match. The P0 class list does not include it. Add a milestone only when the context can show arrival order against more than one `occurredAt`.

The UI. Overview, incident list, investigation detail, and the layout acceptance test are M2 product work and are not this backend plan.

OpenTelemetry, model calls, and the GitHub integration. The roadmap puts traces in M3, the model in M4, and the decisions doc holds GitHub until the investigation workflow exists. The deterministic path has to meet milestones 1 through 14 first.

Multiple workspaces, roles, retention settings, and CSV or PDF export. The PRD lists those as P1 or optional later features. Metadata-only capture stays the default while they wait.
