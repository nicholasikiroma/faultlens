# FaultLens

**Self-hosted, open-source incident investigation workbench for Node.js & TypeScript webhook receivers and asynchronous event pipelines.**

FaultLens acts as a precision flight recorder for ingress and downstream execution. It pairs a zero-blocking Node.js SDK (`FlightRecorder`), transactional ingestion, a deterministic classification rules engine, an optional read-only AI investigator, and a React triage workbench—so engineering teams can diagnose webhook and async failures with cryptographic and runtime receipts rather than guesswork.

Licensed under the [Apache License 2.0](LICENSE).

---

## Core Design Principles

1. **Epistemic Separation (`OBSERVED` vs `HYPOTHESIS`)**  
   Deterministic rule findings cite stored database `Evidence` records (HTTP status codes, HMAC verification states, socket timings, `undici` spans, host exceptions). Optional AI analysis runs strictly as unverified probabilistic hypotheses (`INFERRED`, `HYPOTHESIS`, or `UNVERIFIED`) that downgrade automatically if evidence citations cannot be verified.
2. **Deterministic First, AI Optional**  
   With `FAULTLENS_AI_ENABLED=0` (the default), FaultLens requires **no model key or LLM endpoint**. Ingestion, deduplication, transactional outbox dispatch, rule classification, incident grouping, and UI triage all run deterministically.
3. **Host Isolation**  
   `FlightRecorder` and the webhook capture transport use bounded concurrency (`maxInFlight`), strict timeouts, and `safeTry` isolation so telemetry shipping never blocks or crashes the host service's HTTP response.
4. **Redaction & Scoping Before Persistence**  
   Sensitive headers, secret JSON fields, and token patterns (`Bearer ...`, `sk_live_...`, `whsec_...`) are redacted before PostgreSQL persistence and again before any tool output reaches a model. Signing secrets are never exposed on events, exports, or AI tools.

---

## How Things Work

### End-to-End Architecture

```mermaid
flowchart LR
  Host["Host Service (Node / Express / Fastify / Hono / NestJS)"] -->|"createFaultLensClient / FlightRecorder"| SDK["packages/sdk (#sdk)"]
  SDK -->|"POST /v1/ingest (raw webhook + HMAC)"| API["apps/api (Hono HTTP Server)"]
  SDK -->|"POST /v1/ingest/episodes (sealed runtime episode)"| API
  API -->|"1. Verify IngestKey SHA-256 + HMAC\n2. Redact & Deduplicate\n3. Commit Event + Attempt + Evidence + Outbox"| PG[("PostgreSQL >= 15")]
  PG -->|"Poll outbox (enqueuedAt IS NULL)"| Dispatcher["apps/worker Outbox Dispatcher"]
  Dispatcher -->|"Enqueue jobId = eventId"| Redis[("Redis / BullMQ")]
  Redis -->|"Consume outbox job"| RulesWorker["apps/worker classifyJob"]
  RulesWorker -->|"Evaluate 14 rules on IncidentContext"| Rules["packages/rules (#rules)"]
  Rules -->|"Store Findings & Fingerprint Incident"| PG
  RulesWorker -.->|"If FAULTLENS_AI_ENABLED=1"| AgentQ["BullMQ investigations queue"]
  AgentQ -.->|"Read-only allowlisted tools (workspace-scoped)"| Agent["packages/agent (#agent)"]
  Agent -.->|"Ollama / vLLM / OpenAI-compatible / Anthropic"| LLM["External or Local LLM"]
  Agent -.->|"Persist ToolCall + Hypothesis"| PG
  API -->|"Authenticated /v1/* Admin API"| Web["apps/web (React + Vite Workbench)"]
```

### 1. Instrumentation Layer (`packages/sdk`, `#sdk`)

The SDK exposes `createFaultLensClient(...)` (backed by `FlightRecorder`):

- **Webhook Capture (`client.webhooks.capture(rawBody)`)**: Computes the HMAC-SHA256 signature header (`x-faultlens-signature`) using the integration's signing secret, checks payload bounds (`MAX_INGEST_BODY_BYTES = 1 MiB`), and delivers asynchronously through a shared bounded HTTP `Transport` (`timeoutMs`, `maxInFlight`, redirect refusal).
- **Runtime `FlightRecorder` Episodes**:
  - **Context propagation (`episode.ts`)**: Binds each incoming request to an `AsyncLocalStorage` `Episode` context.
  - **Passive body tap (`tap-stream.ts`)**: Inspects ingress request bytes without consuming or altering the host stream, computing a wire-body HMAC and extracting identity fields (`eventId`, `eventType`).
  - **Socket lifecycle observer (`socket-observer.ts`)**: Tracks `ingressReceivedAtMs`, `close` vs `finish`, `writableEndedAtClose`, `handlerSettled`, `committedAfterAbort`, and event-loop lag (`eventLoopMaxLagMs`).
  - **Downstream HTTP spans (`undici-observer.ts`)**: Subscribes to Node's `diagnostics_channel` (`undici:*`) to record outbound request spans, HTTP statuses, durations, and sub-HTTP network errors (`ECONNREFUSED`, `ETIMEDOUT`, TLS errors).
  - **Local decision & selective shipping (`decide.ts`)**: Evaluates local runtime signals and ships sealed, sanitized `Episode` payloads to `POST /v1/ingest/episodes`.

Framework adapters are built in under `packages/sdk/src/adapters/`:
- `nodeHttp` (`withFlightRecorderNodeHttp`)
- `express` / `expressError` (`flightRecorderExpressMiddleware`, `flightRecorderExpressErrorObserver`)
- `fastify` (`registerFlightRecorderFastify`)
- `hono` (`flightRecorderHonoMiddleware`)
- `nestMiddleware` / `nestInterceptor` (`createFlightRecorderNestMiddleware`, `createFlightRecorderRxjsInterceptor`)

### 2. Ingestion & Transactional Outbox (`apps/api`)

- **Authentication**: Real ingestion routes (`POST /v1/ingest` and `POST /v1/ingest/episodes`) authenticate via `Authorization: Bearer flk_...`. Keys are 32 random bytes stored only as SHA-256 hashes in `ingest_keys`, scoped strictly to `(integrationId, workspaceId, environment)`.
- **HMAC & Deduplication**: `POST /v1/ingest` verifies `x-faultlens-signature` with `crypto.timingSafeEqual` against the integration's `signingSecret`, computes the SHA-256 digest of the raw bytes, and deduplicates by `(integrationId, externalEventId)`:
  - Same `payloadDigest` → `duplicate` (HTTP 200, appends new `DeliveryAttempt`).
  - Different `payloadDigest` → `conflict` (HTTP 409, preserves original event, records conflicting attempt).
  - Invalid signature → `rejected` (HTTP 401, persists `DeliveryAttempt` with `eventId = null` + `Outbox` row).
  - Malformed JSON / invalid schema → `schema-error` (HTTP 400, persists attempt).
- **Atomicity**: Every accepted delivery commits `WebhookEvent`, `DeliveryAttempt`, `Evidence`, and an `Outbox` row (`enqueuedAt = null`) in a single PostgreSQL transaction without touching Redis on the request path.
- **Simulated Webhooks**: `POST /hooks/:token` (legacy `endpointToken` path) stays unmounted (`404`) unless `FAULTLENS_SIMULATED_WEBHOOKS=1`.

### 3. Background Worker & Deterministic Rules (`apps/worker` & `packages/rules`)

- **Outbox Relay (`apps/worker/src/dispatcher.ts`)**: Polls `outbox` rows where `enqueuedAt IS NULL` and enqueues BullMQ jobs using `eventId` (or `attemptId`) as the deduplicated `jobId`. If Redis is temporarily unreachable, `enqueuedAt` remains `NULL` for automatic retry.
- **Deterministic Classification (`apps/worker/src/classify-job.ts` & `packages/rules`)**:
  `classifyJob` builds an immutable `IncidentContext` and evaluates 14 deterministic rules:
  - `AUTH_FAILURE` (`401`/`403` auth errors)
  - `RATE_LIMIT` (`429` responses)
  - `NETWORK_TIMEOUT` (compares receiver `durationMs` against sender wait threshold `senderWaitMs`)
  - `UPSTREAM_5XX` (`5xx` upstream/downstream failures)
  - `SCHEMA_MISMATCH` (`400`/`422` schema/validation failures)
  - `INVALID_SIGNATURE` (`verificationState === 'REJECTED'`)
  - `DUPLICATE_DELIVERY` (multiple attempts for an idempotent event)
  - `OUT_OF_ORDER` (multi-event ordering violation)
  - `INGRESS_ABORTED` (client closed socket before handler settled / committed after abort)
  - `DECRYPT_FAILURE` (payload decryption failure)
  - `DOWNSTREAM_NETWORK_ERROR` (TCP/DNS/TLS failure captured by `undici` span)
  - `UNHANDLED_EXCEPTION` (synchronous/async error thrown inside handler)
  - `ASYNC_ESCAPE_FAILURE` (unhandled rejection / uncaught exception escaping handler scope)
  - `UNKNOWN` (fallback when no specific rule matches)
- **Incident Fingerprinting (`packages/rules/src/fingerprint.ts`)**: Groups matching findings into an `Incident` keyed by `(workspaceId, fingerprint, ruleVersion)` where the fingerprint combines `integrationId`, `environment`, `failureClass`, and normalized `endpoint`.
- **Automated Data Retention (`apps/worker/src/retention.ts`)**: When `FAULTLENS_RETENTION_ENABLED=1`, purges expired event metadata and payloads on a configurable schedule (`FAULTLENS_RETENTION_METADATA_DAYS`, `FAULTLENS_RETENTION_PAYLOAD_DAYS`).

### 4. Optional Read-Only AI Investigator (`packages/agent`, `#agent`)

When `FAULTLENS_AI_ENABLED=1`, incidents can be investigated automatically after classification (`FAULTLENS_AI_AUTO_INVESTIGATE=1`) or on demand via `POST /v1/incidents/:incidentId/investigate` and follow-up Q&A (`POST /v1/incidents/:incidentId/ask`):

- **Strictly Read-Only Tool Sandbox**: Only 6 allowlisted tools exist (`get_incident`, `list_event_attempts`, `get_evidence`, `search_related_events`, `get_integration_config_summary`, `get_rule_findings`). All queries enforce server-side `workspaceId` scoping (`packages/agent/src/postgres-repo.ts`, `#agent-repo`).
- **Prompt-Injection & Secret Guardrails**: Untrusted payloads and headers are wrapped in `<untrusted_observation>...</untrusted_observation>`, secrets are scrubbed before reaching the model, and output normalization downgrades any `OBSERVED`/`INFERRED` claim whose cited evidence IDs were not returned by a tool during the run to `UNVERIFIED`.
- **Provenance & Cost Accounting**: Every `InvestigationRun`, `ToolCall`, `Hypothesis`, `IncidentQuestion`, token count, and estimated USD cost (`cost.ts`) is persisted for auditability and precision evaluation (`GET /v1/evaluations/summary`).
- **Supported Providers**: `openai-compatible` (Ollama, vLLM, OpenAI, etc.), `anthropic`, and `mock`.

### 5. Web Workbench (`apps/web`)

A React 18 + Vite + Tailwind CSS console (`Obsidian` dark theme & `Crisp Slate` light theme) providing:
- **Overview**: Fleet failure spectrum, burst metrics, and open incident triage.
- **Incidents & Investigation View**: Timeline of events/attempts, deterministic rule receipts, cited evidence drawer (`EvidenceDrawer`), AI hypotheses with `USEFUL` / `INCORRECT` feedback, follow-up Q&A, and incident lifecycle transitions (`OPEN` → `INVESTIGATING` → `RESOLVED` → `ARCHIVED`).
- **Integrations, Playground, Evaluations, and Settings**: Connected source breakdown, synthetic scenario simulator, model precision/cost breakdown, and live API/token configuration.

---

## Quickstart

### Prerequisites

- **Node.js** >= 22 (recommended; `Dockerfile` uses `node:22-alpine`)
- **PostgreSQL** >= 15
- **Redis** >= 7
- Or **Docker & Docker Compose**

### Option A: Docker Compose (Backend + Seeded Fixtures)

1. Start PostgreSQL, Redis, idempotent schema/fixture seeding, API (`127.0.0.1:3000`), and worker:
   ```sh
   docker compose up --build -d
   ```
2. Start the Web Workbench locally (Vite proxies `/v1/*` to `http://127.0.0.1:3000`):
   ```sh
   npm --prefix apps/web install
   npm run dev:web
   ```
3. Open `http://localhost:5173`. Default local admin token is `local-dev-admin-token`.

### Option B: Local Host Development (No Docker Required for Node Processes)

1. Ensure PostgreSQL (`>= 15`) and Redis are running locally, then create `.env`:
   ```sh
   cp .env.example .env
   ```
   Update `DATABASE_URL` and `REDIS_URL` in `.env` if needed.
2. Install dependencies:
   ```sh
   npm install
   npm --prefix apps/web install
   ```
3. Seed the 8 deterministic scenarios and start both API + worker in one terminal:
   ```sh
   npm run start:local
   ```
   *(Or run `npm run seed`, `npm run start:api`, and `npm run start:worker` in separate terminals.)*
4. Start the Web Workbench in another terminal:
   ```sh
   npm run dev:web
   ```
5. *(Optional)* Run the interactive FlightRecorder SDK demo (`apps/commerce-service`) to stream live healthy and failing events into FaultLens:
   ```sh
   npm run start:commerce
   ```

See [docs/local-install.md](docs/local-install.md) for seeded scenario details and sample `curl` inspection commands.

---

## SDK Usage Example

```ts
import express from 'express';
import { createFaultLensClient } from '#sdk'; // or '@faultlens/sdk'

const faultlens = createFaultLensClient({
  baseUrl: process.env.FAULTLENS_API_URL ?? 'http://127.0.0.1:3000',
  apiKey: process.env.FAULTLENS_INGEST_KEY!,
  timeoutMs: 1000,
  maxInFlight: 8,
  webhooks: {
    signingSecret: process.env.FAULTLENS_SIGNING_SECRET!,
  },
});

const app = express();

// 1. Attach FlightRecorder middleware to capture socket aborts, exceptions, and downstream spans
app.use(faultlens.middleware.express());

// 2. Capture inbound webhook payloads asynchronously without blocking the HTTP response
app.post('/webhooks/orders', express.raw({ type: 'application/json' }), (req, res) => {
  void faultlens.webhooks.capture(req.body);
  res.status(202).json({ accepted: true });
});

app.use(faultlens.middleware.expressError());
```

See [docs/sdk-architecture.md](docs/sdk-architecture.md) and [`apps/commerce-service`](apps/commerce-service/src/main.ts) / [`apps/sdk-example`](apps/sdk-example/src/main.ts) for complete examples.

---

## Ingest Keys & API Reference

### Provisioning Scoped Ingest Keys

Production ingestion (`POST /v1/ingest` and `POST /v1/ingest/episodes`) requires a hashed `IngestKey` (`flk_...`):

```sh
npm run ingest-key -- create <integrationId>
npm run ingest-key -- rotate <keyId>
npm run ingest-key -- revoke <keyId>
```

Raw keys are printed once on creation/rotation and stored only as SHA-256 hashes. See [docs/ingest-keys.md](docs/ingest-keys.md) for lifecycle and rotation semantics.

### HTTP Endpoints

Admin routes require `Authorization: Bearer <FAULTLENS_ADMIN_TOKEN>` and reject `workspaceId` query/body overrides.

| Method & Path | Access | Purpose |
| --- | --- | --- |
| `POST /v1/ingest` | IngestKey + HMAC | Verified raw webhook ingestion |
| `POST /v1/ingest/episodes` | IngestKey | Sanitized `FlightRecorder` episode ingestion |
| `POST /hooks/:token` | Endpoint token | Simulated traffic only (mounted iff `FAULTLENS_SIMULATED_WEBHOOKS=1`) |
| `GET /v1/events` | Admin | Cursor-paginated webhook events with filters |
| `GET /v1/events/:eventId/attempts` | Admin | Delivery attempts for an event |
| `GET /v1/incidents` | Admin | List grouped incidents (`?failureClass=...`) |
| `GET /v1/incidents/:incidentId/export` | Admin | Redacted timeline, findings, and cited evidence IDs |
| `PUT /v1/incidents/:incidentId/status` | Admin | Transition status (`OPEN`, `INVESTIGATING`, `RESOLVED`, `ARCHIVED`) |
| `PUT /v1/findings/:findingId/feedback` | Admin | Rate deterministic finding (`USEFUL` / `INCORRECT`) |
| `GET /v1/findings/:findingId/feedback` | Admin | List feedback for a finding |
| `GET /v1/audit-events` | Admin | Query audit log (`objectType`, `objectId`) |
| `POST /v1/incidents/:incidentId/investigate` | Admin | Queue an optional AI investigation run (`202`) |
| `GET /v1/incidents/:incidentId/investigations` | Admin | List runs, tool calls, and hypotheses for an incident |
| `PUT /v1/hypotheses/:hypothesisId/feedback` | Admin | Rate AI hypothesis (`USEFUL` / `INCORRECT` / `UNVERIFIED`) |
| `POST /v1/incidents/:incidentId/ask` | Admin | Ask a grounded follow-up question over incident evidence |
| `GET /v1/incidents/:incidentId/questions` | Admin | List persisted follow-up Q&A turns |
| `GET /v1/evaluations/summary` | Admin | Aggregated run/token/cost/precision metrics |
| `GET /v1/settings/agent` | Admin | Non-secret AI configuration summary |

Full request/response status tables live in [docs/http-routes.md](docs/http-routes.md) (verified 1-to-1 by `routes.test.ts`).

---

## Configuration Reference

All environment variables are documented in [`.env.example`](.env.example):

| Variable | Default | Description |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql://lab:lab@localhost:5432/faultlens` | PostgreSQL (`>= 15`) connection string |
| `REDIS_URL` | `redis://127.0.0.1:6379` | Redis connection string for BullMQ |
| `FAULTLENS_ADMIN_TOKEN` | `local-dev-admin-token` | Bearer token for admin read/write routes |
| `FAULTLENS_WORKSPACE_ID` | `workspace-1` | Single-workspace deployment scope |
| `FAULTLENS_ADMIN_ACTOR` | `local-admin` | Actor recorded in `audit_events` |
| `FAULTLENS_API_HOST` / `FAULTLENS_API_PORT` | `127.0.0.1` / `3000` | API bind address and port |
| `FAULTLENS_CORS_ORIGIN` | *(unset)* | Optional comma-separated allowed non-localhost origins |
| `FAULTLENS_SIMULATED_WEBHOOKS` | `0` | Set to `1` to mount `POST /hooks/:token` |
| `FAULTLENS_DISPATCH_INTERVAL_MS` | `1000` | Worker outbox polling interval in ms (min `50`) |
| `FAULTLENS_AI_ENABLED` | `0` | Set to `1` to enable optional read-only AI investigation agent |
| `FAULTLENS_AI_AUTO_INVESTIGATE` | `1` | Auto-queue AI run after classification when AI is enabled |
| `FAULTLENS_AI_PROVIDER` | `openai-compatible` | `openai-compatible` \| `anthropic` \| `mock` |
| `FAULTLENS_AI_BASE_URL` | `http://127.0.0.1:11434/v1` | Base URL for OpenAI-compatible endpoints (e.g. Ollama) |
| `FAULTLENS_AI_MODEL` | `qwen2.5:14b-instruct` | Model identifier |
| `FAULTLENS_AI_API_KEY` | *(unset)* | Optional bearer/API key (required for `anthropic`) |
| `FAULTLENS_AI_MAX_TOOL_CALLS` | `8` | Per-run tool call budget (`1..20`) |
| `FAULTLENS_AI_TIMEOUT_MS` | `60000` | Per-run timeout budget in ms (`1000..300000`) |
| `FAULTLENS_AI_INPUT_COST_PER_1M` / `OUTPUT` | *(unset)* | Optional custom USD token rates per 1M tokens |
| `FAULTLENS_RETENTION_ENABLED` | `0` | Set to `1` to enable hourly retention purges |
| `FAULTLENS_RETENTION_METADATA_DAYS` | `30` | Retention days for metadata |
| `FAULTLENS_RETENTION_PAYLOAD_DAYS` | `7` | Retention days for redacted payloads |

---

## Project Structure

```text
├── apps/
│   ├── api/                 # Hono HTTP server, ingest, read/export, lifecycle, audit, investigations
│   ├── worker/              # BullMQ outbox dispatcher, classification consumer, AI job runner, retention
│   ├── web/                 # React 18 + Vite + Tailwind workbench UI (@faultlens/web)
│   ├── commerce-service/    # End-to-end FlightRecorder SDK demo + traffic generator
│   └── sdk-example/         # Minimal non-blocking webhook host example
├── packages/
│   ├── domain/              # Framework-agnostic types, status literals, and wire constants (#domain)
│   ├── rules/               # 14 deterministic classification rules & fingerprinting (#rules)
│   ├── sdk/                 # FlightRecorder, transports, observers, and framework adapters (#sdk)
│   └── agent/               # Read-only AI investigator, guardrails, providers, Q&A, evals (#agent, #agent-repo)
├── prisma/
│   ├── schema.prisma        # PostgreSQL schema contract
│   └── sql/incidents.sql    # Idempotent DDL applied on bootstrap
├── src/prisma/              # Generated Prisma 8 typed client & contract (#db, #sql)
├── migrations/              # Prisma schema migration history & snapshots
├── docs/                    # Public reference docs (HTTP routes, local install, ingest keys, SDK, UI tokens)
├── docker-compose.yml       # Local Postgres + Redis + Seed + API + Worker stack
├── Dockerfile               # Node 22 backend container image
├── CONTRIBUTING.md          # Contributor guidelines & pre-PR checks
└── SECURITY.md              # Trust boundaries & vulnerability reporting
```

---

## Testing & Verification

```sh
# Typecheck backend & packages
npm run typecheck

# Typecheck & build web workbench
npm run build:web

# Database-free unit suites
npm run test:sdk
npm run test:http
npm run test:agent

# Full integration suite (requires PostgreSQL >= 15 and Redis running; runs serially)
npm test
```

> **Note:** `npm test` runs with `--test-concurrency=1` because integration suites share a single PostgreSQL instance and reset fixtures between test files.

For security invariants and vulnerability reporting, see [SECURITY.md](SECURITY.md). For contribution guidelines, see [CONTRIBUTING.md](CONTRIBUTING.md).
