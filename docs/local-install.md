# Local install

Milestone 14 provides a one-command bootstrap that starts PostgreSQL, Redis, the API, and the classification worker, and idempotently seeds the eight deterministic webhook failure scenarios into the product database with no AI/model key required.

## Start the full stack with Docker Compose

From a fresh checkout at the repository root:

```sh
docker compose up --build -d
```

This command:
1. Starts `postgres` (database `wiresleuth` on port `5432`) and `redis` (port `6379`).
2. Runs the `seed` service (`npm run seed`), which applies the idempotent schema (`prisma/sql/incidents.sql`), seeds two integrations (`/hooks/billing` and `/hooks/orders`) and the eight deterministic failure scenarios, and runs the deterministic rule engine (`classifyJob`) to group them into incidents.
3. Starts the `api` service (`npm run start:api` on `http://127.0.0.1:3000`) and the `worker` service (`npm run start:worker`) with no model key.

Re-running `docker compose up --build -d` or `npm run seed` is idempotent: deterministic IDs and `ON CONFLICT DO NOTHING` constraints ensure a second run never duplicates the seeded events, delivery attempts, evidence rows, findings, or incidents.

### Start from the host when PostgreSQL and Redis are already running

If PostgreSQL (`localhost:5432/wiresleuth`) and Redis (`localhost:6379`) are already running locally:

```sh
npm run start:local
```

Or run the steps individually:

```sh
npm run seed
npm run start:api
npm run start:worker
```

## Seeded scenarios

`npm run seed` loads two integrations in `workspace-1` (`billing` on `/hooks/billing` and `orders` on `/hooks/orders`) and eight scenarios:

| Scenario | External Event ID | Endpoint | Failure Class |
| --- | --- | --- | --- |
| `auth-401` | `seed-evt-auth-401` | `/hooks/billing` | `AUTH_FAILURE` |
| `rate-limit-429` | `seed-evt-rate-limit-429` | `/hooks/billing` | `RATE_LIMIT` |
| `upstream-503` | `seed-evt-upstream-503` | `/hooks/billing` | `UPSTREAM_5XX` |
| `network-timeout` | `seed-evt-network-timeout` | `/hooks/billing` | `NETWORK_TIMEOUT` |
| `schema-mismatch` | `seed-evt-schema-mismatch` | `/hooks/orders` | `SCHEMA_MISMATCH` |
| `invalid-signature` | `seed-evt-invalid-signature` | `/hooks/orders` | `INVALID_SIGNATURE` |
| `duplicate-delivery` | `seed-evt-duplicate-delivery` | `/hooks/orders` | `DUPLICATE_DELIVERY` |
| `out-of-order` | `seed-evt-out-of-order` | `/hooks/orders` | `UNKNOWN` |

## Inspect one incident

The local stack uses `WIRESLEUTH_ADMIN_TOKEN=local-dev-admin-token` and `WIRESLEUTH_WORKSPACE_ID=workspace-1` by default.

1. List all eight seeded incidents:

```sh
curl -s http://127.0.0.1:3000/v1/incidents \
  -H "Authorization: Bearer local-dev-admin-token"
```

2. Filter for the `NETWORK_TIMEOUT` incident:

```sh
curl -s "http://127.0.0.1:3000/v1/incidents?failureClass=NETWORK_TIMEOUT" \
  -H "Authorization: Bearer local-dev-admin-token"
```

3. Export one incident with its timeline of events, delivery attempts, findings, and cited evidence IDs (using the `id` returned above):

```sh
curl -s "http://127.0.0.1:3000/v1/incidents/<incidentId>/export" \
  -H "Authorization: Bearer local-dev-admin-token"
```
