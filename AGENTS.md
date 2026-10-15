# Rush repository instructions

Read `README.md` and the relevant sections of `docs/coding-standards.md` before changing behavior. Preserve the guarantees described in `docs/architecture.md`.

## Required boundaries

- Browser code may import browser-safe contracts from `src/shared`; it must not import server modules, database clients, Node-only APIs, or secrets.
- HTTP routes validate and authorize input, call domain operations, and translate outcomes. Reservation, payment, and expiry invariants belong in `service.ts` and database constraints.
- PostgreSQL owns inventory, orders, admission capacity, and pending delivery. Redis owns transient queue ordering and rate limits. Never use cache expiry or a notification as the authoritative purchase decision.
- Preserve session-scoped idempotency and canonical payload comparison. A committed retry must work before new-work admission gates.
- Keep business writes and their outbox event in one transaction. Do not perform external network delivery while holding a claim transaction open.
- Claims require an expiring lease and an ownership token. Acknowledgements, retries, and failure updates must be fenced by that token. External sinks must deduplicate by event ID.
- New IO needs a deadline and a documented failure policy. Bound concurrency and retry attempts. Avoid automatic retries of mutations without an explicit idempotency contract.
- Treat applied SQL migrations as immutable. Add the next numbered migration and update ORM declarations when relevant; do not alter recorded checksums or use destructive resets for an upgrade.

## Code and review

- Use strict TypeScript, explicit module exports, small cohesive modules, and descriptive domain names. Use `unknown` with validation at external boundaries. Shared Zod schemas derive response types; validate API and persisted data before UI state. Do not use `any` or non-null assertions; check indexed values and singleton database results.
- Use the formatter and linter configured in `vite.config.ts`. Do not create competing ESLint, Prettier, or Oxfmt configurations.
- Keep React rendering and state updater functions pure. User actions belong in handlers; effects synchronize external systems and must clean up subscriptions, timers, and listeners.
- Use semantic HTML, labeled controls, keyboard access, visible focus, and responsive layouts. Verify the affected desktop and narrow viewport flows.
- Keep metric labels low-cardinality. IDs are correlation fields in logs and request samples, never metric labels. Never log cookies, tokens, webhook signatures, or secrets.
- Add focused tests for changed invariants and failure boundaries. Prefer real PostgreSQL/Redis tests for concurrency and process-crash behavior; do not substitute an in-memory mock for those guarantees.
- Run `bun run check` and `bun run build`. The check includes Knip; declare spawned process fixtures as entry points rather than suppressing genuine findings. Run `bun run audit` when dependency inputs change. For backend or migration changes, also run `bun run test:integration` against the isolated services. Rerun the benchmark when performance behavior or published evidence changes.
- Do not weaken a rule or add a suppression to silence a new failure. Fix the cause; a narrow exception needs a concrete explanation and review.
- Preserve `.env`, persistent volumes, existing bookings, and the Sites project identity. Never commit runtime credentials or build artifacts.
- Document what changed, relevant checks, operational implications, and any unfinished verification. Do not claim guarantees beyond measured evidence.
