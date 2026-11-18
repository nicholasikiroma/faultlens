# Security Policy

## Architectural Trust Boundaries

WireSleuth / FaultLens enforces the following security invariants:

- **Ingest Authentication**: Production delivery (`POST /v1/ingest`, `POST /v1/ingest/episodes`) requires an active scoped `IngestKey` bearer token stored only as a SHA-256 hash. Webhook payloads are verified with constant-time HMAC-SHA256 (`crypto.timingSafeEqual`).
- **Redaction Before Storage & LLM**: Secret fields (`secret`, `authorization`, `signingKey`, `apiKey`, `cookie`) and token patterns (`Bearer ...`, `sk_live_...`, `whsec_...`) are scrubbed before database persistence and before tool outputs are sent to any model.
- **Read-Only Agent Sandbox**: `packages/agent` has zero write, shell, or arbitrary network-fetch tools. All 6 allowlisted tools enforce server-side `workspaceId` scoping, wrap untrusted data in `<untrusted_observation>` tags, and downgrade ungrounded `OBSERVED`/`INFERRED` claims to `UNVERIFIED`.
- **Admin Isolation**: All read/investigation endpoints require `Authorization: Bearer <FAULTLENS_ADMIN_TOKEN>` and reject `workspaceId` query overrides.

## Reporting a Vulnerability

Please do not open public issues with exploit payloads or live credentials. Report security concerns privately to the maintainers with reproduction steps and affected commit hash.
