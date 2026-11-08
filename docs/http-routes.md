# HTTP routes

`apps/api/src/http/routes.ts` is the route list. `apps/api/src/http/routes.test.ts` fails when a heading in this file and a `ROUTES` entry disagree.

`apps/api/src/http/server.ts` is the HTTP adapter. It uses Hono (`hono` and `@hono/node-server`). `createApiApp` registers each mounted route with `app.on`. `createApiServer` passes `app.fetch` to `createAdaptorServer`. Each matched route calls one domain function. A success body and a domain-failure body are that function's result. `Date` values are JSON ISO-8601 strings. A refusal that happens before a domain call uses `error`. The domain functions do not import Hono.

Admin routes require `Authorization: Bearer <WIRESLEUTH_ADMIN_TOKEN>`. The workspace id is `WIRESLEUTH_WORKSPACE_ID`, and the actor recorded on writes is `WIRESLEUTH_ADMIN_ACTOR`. The server does not read either value from the query string or the JSON body. A missing or wrong admin token is 401 with `WWW-Authenticate: Bearer` and this body.

```json
{ "kind": "unauthorized", "error": "unauthorized" }
```

A blank workspace id is the same 401. The server checks the token and the workspace id before it reads a request body.

A query key the route does not list is 400 `{ "error": "invalid_request", "field": "<key>" }`. `workspaceId` is never a listed key, so `?workspaceId=` is 400. A repeated query key is 400. The field names the key.

`POST /hooks/:token` is mounted only when `WIRESLEUTH_SIMULATED_WEBHOOKS` is `1`. Otherwise that path is 404. Real deliveries use `POST /v1/ingest`.

No matching path is 404 `{ "error": "not_found" }`. A path that matches another method is 405 `{ "error": "method_not_allowed" }` and the `Allow` header lists the methods for that path.

## Routes

### POST /v1/ingest

Real traffic. The bearer token is the ingest credential `ingest` looks up. The raw body is at most 1,048,576 bytes, which is `MAX_BODY_BYTES`. The server reads one extra byte and then stops, and `ingest` returns `oversized` when the body is longer than the limit. The signature header is `x-wiresleuth-signature`. Duplicate header values keep the first value. `authorization` and `cookie` are not forwarded.

There is no query contract. Ingest ignores the query string.

| Outcome | Status |
| --- | --- |
| `stored` | 200 |
| `duplicate` | 200 |
| `conflict` | 409 |
| `schema-error` | 400 |
| `rejected` | 401 |
| `unknown-token` | 401 |
| `oversized` | 413 |

`stored` and `duplicate` use 200 so the HTTP status matches `DeliveryAttempt.httpStatus` for those outcomes. The body is the `IngestResult`.

### POST /hooks/:token

Simulated and test traffic only. The credential is the `:token` path segment, and it is the same ingest credential as `POST /v1/ingest`. The body, the signature header, and the status table are the same. The server calls `ingest` only when `WIRESLEUTH_SIMULATED_WEBHOOKS` is `1`. When that variable is unset or any other value, the path is not mounted and the response is 404.

### GET /v1/events

Admin. Calls `listEvents`.

Query keys are `cursor`, `limit`, `integrationId`, `from`, `to`, `externalEventId`, `status`, `errorClass`, `failureClass`, and `traceId`.

`limit` is an integer from 1 to 100. An omitted `limit` leaves the domain default, `DEFAULT_EVENT_PAGE_SIZE`, which is 20. `cursor` is the previous page's `nextCursor`. An unknown cursor is an empty page from the domain, not a 400.

`from` and `to` are ISO-8601 instants on `firstReceivedAt`. If both are present and `from` is later than `to`, the response is 400 and the field is `from`.

`status` is a `PROCESSING_STATES` label. The labels are `RECEIVED`, `QUEUED`, `PROCESSED`, and `FAILED`.

`errorClass` and `failureClass` are `FAILURE_CLASSES` labels. The labels are `AUTH_FAILURE`, `RATE_LIMIT`, `NETWORK_TIMEOUT`, `UPSTREAM_5XX`, `SCHEMA_MISMATCH`, `INVALID_SIGNATURE`, `DUPLICATE_DELIVERY`, `OUT_OF_ORDER`, and `UNKNOWN`. If both keys are present and the values differ, the response is 400 and the field is `failureClass`. If only one key is present, that value is the filter. If both values are the same, both fields are set.

| Kind | Status |
| --- | --- |
| `ok` | 200 |
| `unauthorized` | 401 |

An `ok` body has `items` and `nextCursor`. `nextCursor` is null on the last page.

### GET /v1/events/:eventId/attempts

Admin. Calls `listAttempts`. No query keys. An unknown event id is 200 with `items` set to an empty array.

| Kind | Status |
| --- | --- |
| `ok` | 200 |
| `unauthorized` | 401 |

### GET /v1/incidents

Admin. Calls `listIncidents`. The only query key is `failureClass`, and it uses the same labels as `GET /v1/events`.

| Kind | Status |
| --- | --- |
| `ok` | 200 |
| `unauthorized` | 401 |

### GET /v1/incidents/:incidentId/export

Admin. Calls `exportIncident`. No query keys. The body has no signing secret and no raw payload.

| Kind | Status |
| --- | --- |
| `ok` | 200 |
| `missing` | 404 |
| `unauthorized` | 401 |

### PUT /v1/incidents/:incidentId/status

Admin write. Calls `transitionIncident`. `Content-Type` must be `application/json`. Any other media type is 415 `{ "error": "unsupported_media_type" }`. A body larger than 16,384 bytes is 413 `{ "error": "payload_too_large" }`. The server does not call `transitionIncident` in either case.

The JSON object has one key, `status`. `status` is an `INCIDENT_STATUSES` label. The labels are `OPEN`, `INVESTIGATING`, `RESOLVED`, and `ARCHIVED`. Any other key, including `actor` and `workspaceId`, is 400. The actor is `WIRESLEUTH_ADMIN_ACTOR`.

| Outcome | Status |
| --- | --- |
| `transitioned` | 200 |
| `unchanged` | 200 |
| `illegal` | 409 |
| `missing` | 404 |

A repeated status is `unchanged` and writes no audit row. That stays inside `transitionIncident`.

### PUT /v1/findings/:findingId/feedback

Admin write. Calls `rateFinding`. The content type and the size limit match `PUT /v1/incidents/:incidentId/status`.

The JSON object requires `rating`. `rating` is `USEFUL` or `INCORRECT`. `note` is optional and is a string or null. Any other key, including `actor` and `workspaceId`, is 400. The actor is `WIRESLEUTH_ADMIN_ACTOR`. A second rating from that actor replaces the row.

| Outcome | Status |
| --- | --- |
| `rated` | 201 |
| `replaced` | 200 |
| `missing` | 404 |

### GET /v1/findings/:findingId/feedback

Admin. Calls `listFindingFeedback`. No query keys.

| Kind | Status |
| --- | --- |
| `ok` | 200 |
| `unauthorized` | 401 |

### GET /v1/audit-events

Admin. Calls `listAuditEvents`. Query keys are `objectType` and `objectId`. `objectType` is `INCIDENT` or `FINDING`. `objectId` is the incident id or the finding id.

| Kind | Status |
| --- | --- |
| `ok` | 200 |
| `unauthorized` | 401 |

## Shell errors

| `error` | Status | When |
| --- | --- | --- |
| `invalid_request` | 400 | A query key, a query value, or a JSON body failed the check. `field` names the key or `$`. |
| `not_found` | 404 | No mounted route matched the path. |
| `method_not_allowed` | 405 | The path matched another method. |
| `unsupported_media_type` | 415 | A JSON route did not receive `application/json`. |
| `payload_too_large` | 413 | A JSON body is larger than 16,384 bytes. An ingest body that is too large uses `outcome` `oversized` instead. |
| `internal` | 500 | The handler threw. The body has no exception text. |
