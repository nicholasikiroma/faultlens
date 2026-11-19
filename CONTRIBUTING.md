# Contributing to FaultLens

Thank you for contributing! FaultLens is licensed under Apache License 2.0.

## Local Development

1. Ensure PostgreSQL (>= 15) and Redis are running locally (or run `docker compose up -d postgres redis`).
2. Copy `.env.example` to `.env`.
3. Install dependencies and run the local backend + seeded fixtures (no AI key required):
   ```bash
   npm install
   npm run start:local
   ```
4. Start the web workbench in another terminal:
   ```bash
   npm run dev:web
   ```

## Checks Before Submitting

Run the verification suite before opening a PR:
```bash
npm run typecheck
npm run build:web
npm test
```

If you modify `apps/api/src/http/routes.ts`, update `docs/http-routes.md` in the same change (`routes.test.ts` enforces 1-to-1 sync). If you modify `prisma/schema.prisma`, run `npm run contract:emit` and keep `prisma/sql/incidents.sql` in sync.
