# Decisions from the spec's open questions

These are the operator's answers on 7 Nov 2026. They are not guesses. `07-DECISIONS-AND-QUESTIONS.md` is still not in this repo.

## PRD section 15

The first user is backend engineers and small engineering teams on Node.js and TypeScript applications that receive third-party webhooks and process events asynchronously. Webhook failures come first. Distributed-system investigations come later.

Deployment is self-hosted and team-oriented. Individual developers use local Docker. Engineering teams use a shared deployment. Hosted SaaS is outside the initial scope.

The source connector is a lightweight SDK in the application service layer, plus a versioned HTTP ingestion API. The SDK starts with webhook instrumentation. Later it covers HTTP requests, queues, and background jobs. Telemetry delivery must not interfere with application operations.

Dashboard users authenticate with OIDC. Ingestion uses project and environment API keys. Local development has a simplified authentication mode.

Raw payloads are stored. Capture has three modes. Metadata-only, redacted, and full payload. Metadata-only is the default. Redacted and raw capture require explicit configuration. Raw payloads have configurable retention, encryption, and access controls.

AI is optional. A model-provider abstraction supports local inference through Ollama or vLLM, and configurable external model endpoints. The deterministic investigation engine works with no model.

The first release license is Apache License 2.0.

## Technical architecture section 15

Dashboard authentication is OIDC. Ingestion uses scoped, hashed API keys. Those keys support environment-level permissions, rotation, and revocation.

Generic webhook routes do not accept real traffic in the MVP. They accept simulated and test traffic only. Real production observations come through authenticated SDK instrumentation and the ingestion API.

Capture policy is centralized, with the same three modes. Metadata-only is the default. Raw capture must be explicitly enabled. Redaction happens before persistence and before evidence is sent to a model.

Retention is configurable by data category. The initial defaults are event metadata for 30 days, redacted payloads for 7 days, and raw payloads for 1 day.

Dependencies should prefer MIT, Apache-2.0, BSD, and ISC. Restrictive or commercial licenses are reviewed before adoption. License notices are kept, and an SBOM is generated.

Projects and environments are logically isolated inside one deployment. Each environment has its own identifier, ingestion credentials, capture policy, and retention settings. Isolation is enforced in the backend and in database queries.

The backend (`apps/api` and `apps/worker`) stays lightweight. Domain modules are plain TypeScript and do not import an HTTP framework. `apps/api/src/http/server.ts` uses Hono (`hono` and `@hono/node-server`) as the thin HTTP adapter. It dispatches routes. `apps/api/src/http/request.ts` parses the HTTP boundary, and controllers in `apps/api/src/http/controllers/` call the domain functions. Queue work stays in a standalone BullMQ worker. The apps do not use a heavyweight framework such as NestJS. The monorepo uses a single root `package.json` with Node.js subpath imports (`#db`, `#sql`, `#domain`, `#rules`) rather than nested package manifests or external monorepo task runners.

A GitHub read-only integration waits until the core investigation workflow exists. It would later retrieve commits, deployment information, and code changes through a GitHub App, on explicitly selected repositories, with read-only permissions.
