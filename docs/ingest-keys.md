# Ingest keys

Real traffic to `POST /v1/ingest` requires a scoped API key in `Authorization: Bearer <key>`. The key identifies one integration in one workspace and environment. No workspace or environment supplied by the client can widen that scope. HMAC verification of the raw body with the integration's signing secret is still required; the API key does not replace the signature.

## Upgrade

Run `npx prisma db migrate` to apply `20261108T2356_hashed_ingest_keys`. Existing integration `endpointToken` values are **not** accepted by `/v1/ingest` after this change. Provision a new key for each integration and update callers. Existing endpoint tokens remain simulation credentials only; there is no automatic legacy fallback or raw-key backfill.

## Operator commands

These commands require direct database access through `DATABASE_URL`. They are not public HTTP endpoints. Set `WIRESLEUTH_WORKSPACE_ID` to the intended workspace (the local default is `workspace-1`). They refuse integrations or keys outside that workspace.

```sh
npm run ingest-key -- create <integrationId>
npm run ingest-key -- rotate <keyId>
npm run ingest-key -- revoke <keyId>
```

Creation returns JSON with `outcome: created`, `id`, `key`, `integrationId`, `workspaceId`, `environment`, and `createdAt`. Rotation returns the same fields with `outcome: rotated`. **The raw `key` is shown only in these responses.** Copy it to the caller's secret store. Protect terminal output and do not send it to shared logs. The raw key cannot be retrieved later; rotate if it is lost. Revocation is idempotent (`revoked` then `unchanged`). Missing or wrong-workspace objects return `missing` and a nonzero exit code.

Keys contain 32 cryptographically random bytes encoded as base64url with a `wsk_` prefix. Only the SHA-256 hash is stored in `ingest_keys`, together with its scope, creation time, and optional revocation time. High-entropy random credentials do not need password hashing. Signing secrets remain on integrations and are not included in key results, event reads, or incident exports.

Rotation atomically revokes the old key and creates its replacement with the same scope. It does not provide an overlap period. For a staged rollout, create a second key, deploy it, then revoke the old key. Rotating an already revoked key returns `missing` rather than reactivating it.

Ingest holds a row lock on the authorized key until its transaction finishes. Revocation and rotation wait for an already-authorized delivery to finish; after either command returns, further requests with the old key fail with 401 `unknown-token` and create no delivery records. If the integration's workspace or environment changes, old keys fail closed and must be replaced.

## Simulated webhooks

`POST /hooks/:token` uses the legacy integration endpoint token and is mounted only when `WIRESLEUTH_SIMULATED_WEBHOOKS=1`. It never interprets that token as an API key. Do not enable this route for real production observations. Direct domain callers must explicitly choose `ingestSimulated`; `ingest` always requires an API key.

## Tests

`npm run test:keys` exercises key creation, valid HTTP ingest, revocation, rotation, workspace/environment scope, and production/simulation separation against PostgreSQL. It creates uniquely named integrations and removes only its own fixtures. It does not reset application tables. `npm run test:http` is the database-free transport suite.
