# Coding standards

These rules apply to Rush's actual failure model. They are enforced by configuration where practical and by review where a tool cannot judge correctness.

## Automated baseline

`bun run check` runs Vite+ formatting, type-aware Oxlint, TypeScript checks, Knip unused-code analysis, and unit tests. `bun run lint` additionally treats warnings as failures. `bun run audit` checks locked dependencies against published advisories. CI runs it, builds the production application and runs the real integration suite and benchmark.

| Rule                         | Enforcement                                                                                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One formatting policy        | Oxfmt in the root `vite.config.ts`; no parallel formatter configuration                                                                                             |
| Type correctness             | Strict TypeScript; checked indexed access; exact optional properties; unused locals/parameters; switch fallthrough; consistent import casing; explicit type imports |
| Runtime contracts            | Shared Zod schemas derive browser types and validate success payloads and persisted sandbox snapshots                                                               |
| No assertion escapes         | `no-explicit-any` and `no-non-null-assertion`; narrow unknown values and check required results                                                                     |
| Unused code and dependencies | Knip 6.42, including explicit process-fixture entry points; unused exports are kept local                                                                           |
| CI supply chain              | Actions pinned to verified full commit SHAs; Dependabot proposes weekly action updates                                                                              |
| Promise ownership            | Type-aware `no-floating-promises`; await work, return it, or explicitly use `void` only when rejection is handled                                                   |
| React correctness            | Hook order, effect dependencies, render purity, and compiler correctness rules                                                                                      |
| Accessible interactions      | JSX accessibility rules; semantic elements and associated labels                                                                                                    |
| Module boundaries            | Import-cycle checks and restricted browser/server imports                                                                                                           |
| SQL injection boundary       | Parameterized queries; unsafe query methods prohibited in operational modules                                                                                       |
| Repeatable dependencies      | Bun package-manager pin, frozen lockfile in CI and containers, exact Vite+ toolchain version                                                                        |

Run `bun run format` to format changes. Run `bun run verify` for static checks, unit tests, build, and integration tests together after the isolated stores are available. Repository instructions live in `AGENTS.md`; editor defaults live in `.editorconfig` and `.vscode/settings.json`.

## Design rules

Keep route modules concerned with transport: runtime input validation, authentication, ownership checks, response status, and safe errors. Keep business transactions in the domain service. A browser component should not know how a row lock, payment signature, or claim token works.

Use abstractions at a real boundary. `DeliverySink` is useful because the transactional sandbox and HTTP provider have different effects. The circuit breaker and bulkhead are independent, deterministic primitives. Avoid wrapping every ORM method in a generic repository or splitting modules into services without a scaling or ownership reason.

Prefer data transformations and named functions to implicit side effects. Model legal order transitions explicitly in the transactional workflow; final ownership must also satisfy database constraints. Use `unknown` for untrusted values and narrow them with schemas or guards. Do not use `any` to escape an inconvenient contract. Use typed SQL projections and check singleton results at runtime with `one()`. Do not assert that an unchecked array entry, DOM element, cookie, or environment variable exists. Omit absent optional JSON fields rather than serializing private ownership as null.

Use comments to explain why an invariant, lock order, recovery step, or deadline exists. Avoid comments that repeat the next line. Extract a module when it owns a coherent responsibility, not because of an arbitrary line-count target.

## Tooling decisions

Vite+ owns formatting, linting, and type checks. Bun owns application execution and tests. Knip checks reachability and dependency use, which are different from local lint rules; its Vite+ plugin discovers the build configuration. Declare files spawned as subprocesses as entry points instead of suppressing their unused-file findings. Keep advisory checks separate from the offline developer check because they require the registry.

Upgrade `vite-plus`, the `vite` npm alias, and `overrides.vite` to the same exact Vite+ release, then regenerate the Bun lockfile. Dependabot's Bun updater can leave the alias and override behind even in a grouped update; inspect all three entries before accepting a toolchain upgrade. Keep CodeQL's `init` and `analyze` actions on the same commit; their Dependabot updates are grouped. CI removes the saved benchmark before measuring and uploads only a report from a benchmark that actually ran, including failed measurements.

Shared response schemas are the source of browser-facing types. Parse unknown data before it enters React state. Additive response fields are accepted and stripped by the parser; missing required fields, illegal states, invalid timestamps, and invalid money values fail with a controlled connection error. HTTP status codes remain available on `HttpError`, including protocol failures returned with status 200. Do not automatically retry mutations with a new idempotency key.

## Distributed work

State the authority, atomic boundary, and failure response before adding a cache, queue, or background operation. Redis Lua atomicity applies to Redis; it does not make a PostgreSQL write atomic. Preserve correctness when either process dies between those writes.

Treat timeouts as unknown outcomes. Retrying a committed reservation must reuse its request key. External delivery is at least once; require provider deduplication. Do not describe leases or fencing as exactly-once network delivery.

Use database time for persisted reservation and admission deadlines and Redis time for Redis refill/heartbeat calculations. Lock scarce resources in deterministic order. Bound admission, in-flight work, query duration, batch size, retry count, and failure queues. Distinguish a capacity rejection from a seat conflict in UI and benchmark reports.

Add a migration for schema changes, keep applied migrations unchanged, and make data-preservation implications reviewable. Seed scripts must preserve bookings. Reset scripts must refuse non-test database names and non-isolated Redis databases.

## UI and accessibility

Keep render calculations pure; initialize clocks and generated IDs lazily, then update them from events or external subscriptions. Derived values belong in render, not in another state variable synchronized by an effect. Clean up timers, SSE connections, event handlers, and dialogs.

Use buttons for actions, links for navigation, fieldsets for related controls, and native dialogs for modal interactions. Keep keyboard focus visible, controls labeled, and disabled/loading states understandable. Verify user-visible outcomes in both a normal desktop viewport and a narrow viewport. Do not represent simulated data as live infrastructure telemetry.

## Operational review

For a changed endpoint or worker transition, reviewers should be able to answer:

1. What invariant can fail, and which test demonstrates it?
2. What happens if the response is lost or the operation is duplicated?
3. What commits if the process dies at each IO boundary?
4. What limits latency, contention, memory, and retry amplification?
5. Which metric, audit entry, or trace field explains a failure?
6. Does the migration preserve existing data, and can deployment be repeated?

Do not make coverage percentage or performance assertions without evidence. Publish the workload and environment with timing results. Request samples are bounded, and IDs belong in correlation fields rather than metric labels. Explain cache consistency, transient notifications, and process-local metrics honestly.

## Sources behind the rules

The implementation follows [Vite+ checks](https://viteplus.dev/guide/check), [TypeScript strictness](https://www.typescriptlang.org/tsconfig/strict.html), [React effect guidance](https://react.dev/learn/you-might-not-need-an-effect), and [Hono application structure](https://hono.dev/docs/guides/best-practices). The review questions are informed by [Google's engineering review guidance](https://google.github.io/eng-practices/review/reviewer/looking-for.html), with operational signals informed by [Google SRE monitoring guidance](https://sre.google/sre-book/monitoring-distributed-systems/). These sources guide judgment; they do not replace tests of this system's own invariants.

The stricter boundary policy follows [checked indexed access](https://www.typescriptlang.org/tsconfig/noUncheckedIndexedAccess.html), [exact optional properties](https://www.typescriptlang.org/tsconfig/exactOptionalPropertyTypes.html), [Zod parsing and inferred types](https://zod.dev/basics), [Knip’s Vite+ integration](https://knip.dev/reference/plugins/vite-plus), [Bun audit](https://bun.com/docs/pm/cli/audit), and [GitHub’s secure action usage](https://docs.github.com/en/actions/reference/security/secure-use).
