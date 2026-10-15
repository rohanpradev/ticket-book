# Rush

[![Verify Rush](https://github.com/rohanpradev/rush/actions/workflows/ci.yml/badge.svg)](https://github.com/rohanpradev/rush/actions/workflows/ci.yml)
[![CodeQL](https://github.com/rohanpradev/rush/actions/workflows/codeql.yml/badge.svg)](https://github.com/rohanpradev/rush/actions/workflows/codeql.yml)

**A ticket drop platform you can inspect under failure.**

Rush combines a React concert-booking experience with a Bun/Hono API, PostgreSQL inventory, Redis admission control, and independently recoverable workers. Its control room connects working system-design concepts to their implementation, failure tests, operational signals, and tradeoffs.

## Start locally

Use Bun 1.4.3 and Docker. Node 26.3.0 is pinned for developers who use the Node-based Vite+ CLI; project scripts invoke the local CLI through Bun.

```sh
bun install --frozen-lockfile
bun run setup
docker compose up -d --wait
bun run db:migrate
bun run db:seed
bun run dev:full
```

Open `http://127.0.0.1:5173`. The source app defaults to the real API; `bun run dev:sandbox` explicitly starts the browser-only demonstration. The setup command creates unique local secrets if `.env` is missing. To unlock the control room, use your local `.env` file's `ADMIN_TOKEN`. Do not publish that token. Existing `.env` files and bookings are preserved.

For the complete deployment—Nginx, two API replicas, a worker, PostgreSQL, and Redis:

```sh
docker compose --profile full up --build -d --wait
```

Open `http://127.0.0.1:8080`. Host development and the full container profile both use port 3001; run one API mode at a time. The gateway, APIs, and stores bind only to loopback on the host. This Compose setup is a local demonstration, without TLS.

## What is implemented

| Concern               | Implementation                                                                                | Evidence                                                         |
| --------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Inventory correctness | Deterministically ordered row locks, atomic group reservations, database constraints          | 100 competing buyers; overlapping groups; two API processes      |
| Retry safety          | Durable session-scoped keys; payload comparison; replay before admission gates                | One order across retries, including after admission expiry       |
| Waiting room          | Redis FIFO sequence and heartbeat leases; PostgreSQL capacity guard                           | Redis data-loss recovery; abandoned-waiter progress              |
| Traffic control       | Atomic token bucket; per-process read, reservation, and payment bulkheads                     | Exact token consumption; recorded load shedding                  |
| Dependency resilience | Redis circuit breaker with one half-open probe; connection/command and SQL deadlines          | Deterministic breaker tests; held-lock timeout and pool recovery |
| Reliable delivery     | Transactional outbox; short claims; leases; fencing; idempotent sink                          | Worker death before and after delivery commit                    |
| Compensation          | Durable expiry and late-payment refund workflow                                               | New seat ownership survives the former buyer's late payment      |
| Recovery operations   | Full-jitter retries, dead letters, bounded audited replay                                     | Five-attempt exhaustion and successful operator replay           |
| Live updates          | Transactional PostgreSQL notifications; coalesced SSE; snapshot reconciliation                | Cross-process invalidation test                                  |
| Observability         | Structured logs; W3C trace correlation; Prometheus histograms; worker heartbeats; backlog age | Route-template labels and trace-to-outbox assertions             |
| Schema delivery       | Ordered SQL migrations, checksums, migration lock                                             | Rerunnable migrations; changed checksums fail                    |
| Engineering workflow  | Vite+ 1.2, Oxfmt, type-aware Oxlint, strict TypeScript, Knip, shared Zod contracts, CI        | `bun run check`, production build, integration suite             |

## Verify and measure

```sh
bun run check                  # Format, type-aware lint, types, unused code, and unit tests
bun run audit                  # Locked dependency advisory check (requires network)
bun run build                  # Production bundle through Vite+
bun run test:prepare           # Creates rush_test and rush_benchmark if missing
bun run test:integration       # Two actual API processes + PostgreSQL + Redis
bun run benchmark             # Writes docs/benchmarks/latest.json
```

Integration tests can reset only `rush_test` and Redis database 1. The benchmark can reset only `rush_benchmark` and Redis database 2. Both refuse other database names. The benchmark records hardware, runtime, HTTP statuses, percentiles, and inventory reconciliation; it is a local burst experiment, not a production capacity claim.

## Code map

```text
src/server/app.ts          HTTP middleware, authorization boundaries, route composition
src/server/routes/        Checkout, snapshot, health, events, operator endpoints
src/server/service.ts     Reservation, expiry, and payment transactions
src/server/queue.ts       FIFO ordering, durable admissions, token bucket
src/server/worker.ts      Claim → deliver → fenced acknowledgement
src/server/resilience.ts  Circuit breaker and bulkhead primitives
src/server/telemetry.ts   Bounded metrics, trace correlation, structured logs
src/server/migrations/    Authoritative, ordered SQL migrations
src/shared/               Browser-safe contracts and inventory invariants
src/web/                  Booking, operations, architecture, experiment runner
```

## Engineering guides

- [Architecture and decisions](docs/architecture.md)
- [Coding standards](docs/coding-standards.md)
- [Interview walkthrough](docs/interview-guide.md)
- [Operations runbook](docs/runbook.md)
- [API contract](docs/api.md)
- [Research and primary sources](docs/research.md)
- [Latest benchmark evidence](docs/benchmarks/latest.json)

## Explicit boundaries

The hosted Sites preview is a browser-local sandbox; the real Bun/PostgreSQL/Redis stack runs locally or in containers. Payments and local delivery are simulated. The optional HTTP delivery adapter requires an idempotent provider; it is not a complete Stripe integration.

The system is single-region with one PostgreSQL writer. Redis loss resets queue ordering but cannot increase durable admission capacity. SSE notifications are transient hints, repaired by fresh snapshots. Metrics are per process until collected from every replica; W3C trace correlation is implemented, while an OpenTelemetry collector/exporter is not. Production targets in the console are design targets, not an SLA.

## Repository automation

Every pull request and push to `main` runs formatting, type-aware linting, TypeScript, unused-code analysis, unit tests, dependency auditing, a production build, PostgreSQL/Redis integration tests, and the isolated benchmark. CI uploads the benchmark report for inspection. CodeQL scans TypeScript/JavaScript and GitHub Actions on pushes, pull requests, and weekly. Dependabot proposes weekly Bun, Actions, Docker, and Compose updates; updates still need review and passing checks.

The repository excludes local environment files, generated output, and private Sites hosting metadata. `bun run setup` generates local secrets. See `.env.example` for supported variables.
