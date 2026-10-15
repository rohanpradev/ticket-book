# Operations runbook

The default deployment is a local single-region demonstration. Read the architecture boundaries before treating any console indicator as a production guarantee.

## Start and inspect

Run the README setup. `docker compose --profile full up --build -d --wait` starts the gateway, two APIs, a worker, and the stores. The one-shot migration service verifies migration checksums and seeds missing seats without overwriting bookings.

- `/api/health/live`: process liveness.
- `/api/health/ready`: database readiness; Redis is not required for existing-order completion.
- `/api/health`: database/cache state and sandbox-provider status.
- Control room → Observability: per-process request samples, Redis circuit, capacity, worker heartbeat, durable outbox, and dead letters.

The Nginx gateway distributes requests between replicas; successive per-process metrics can differ. For a stable view of one instance, inspect port 3001 or 3002. Service-wide SLO calculations require scraping every replica. `/api/admin/metrics` requires `X-Admin-Token`; configure the collector to supply it securely. Never put the token in a URL.

## Admissions paused

Check the Redis state and circuit. Existing orders remain in PostgreSQL and checkout/replay paths do not require a new Redis admission. After the dependency returns, each API allows one half-open probe. Queue heartbeat cleanup and committed-admission reconciliation run during joins. Redis data loss resets ordering; communicate that limitation rather than promising preserved global position.

## Delivery backlog

Check the oldest pending event age, recent worker heartbeat, lab pause flag, and delivery ledger. A recent heartbeat with a growing backlog can indicate repeated provider errors or insufficient throughput; inspect attempts and last error. A missing heartbeat usually means the worker is stopped or cannot reach the database.

After an unexpected worker death, a live claim remains owned until its 30-second lease expires. Starting a replacement immediately does not permit it to steal an unexpired claim. After expiry it can retry with the same event ID. Do not manually erase claim tokens to force overlapping delivery.

## Dead letters and replay

After five claims, failed work becomes visible in the ledger. Investigate the provider and order state before selecting Replay. The server resets the selected failed job's attempts and availability in a transaction and writes an operator audit entry. Batch replay is bounded to 50 jobs. A replay does not change the provider idempotency key.

Replay is an operational action protected by operator authorization. Fault injection and forced order expiry additionally require `LAB_ENABLED=true` and should remain confined to an isolated demo environment.

## Contention and overload

409 means the selected seats conflict with another reservation, or an idempotency key was reused with different seats. 429 means the session token bucket is exhausted. 503 with `Retry-After` can indicate bounded overload, a dependency pause, or a database deadline. A client retry of a reservation must preserve the original request key and selection.

Compare status counts with latency; a low percentile dominated by quick rejections does not show useful purchase throughput. The checked-in benchmark reports each status and discloses that its overall percentiles include rejections.

## Migrations and stopping

Add a new numbered migration; never edit an applied one or override its checksum. Back up persistent data before a production schema rollout. This project provides additive migrations, not an automatic production rollback system.

Stop the local stack with `docker compose --profile full down`. Named volumes remain. Do not add `--volumes` unless deliberately discarding local data. API shutdown closes listeners and connections; a worker stops claiming new work and finishes its bounded current batch. A hard process death is recovered through the durable lease protocol.
