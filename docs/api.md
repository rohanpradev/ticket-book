# API contract

All mutations require JSON and reject an unexpected Origin. The server issues an HTTP-only signed session cookie. Operator endpoints require `X-Admin-Token`; ordinary snapshots expose only the current visitor's orders and audit entries. Do not send the operator token to third-party destinations.

| Method | Path                       | Purpose                                                   |
| ------ | -------------------------- | --------------------------------------------------------- |
| GET    | `/api/health/live`         | Process liveness                                          |
| GET    | `/api/health/ready`        | Database readiness                                        |
| GET    | `/api/health`              | Dependency and provider summary                           |
| GET    | `/api/snapshot`            | Authorized consistent inventory/order snapshot            |
| GET    | `/api/events`              | Coalesced SSE invalidation hints and heartbeat            |
| POST   | `/api/queue`               | Join/heartbeat waiting room; return admission or position |
| POST   | `/api/reservations`        | Reserve 1–4 unique seat IDs with a UUID request key       |
| POST   | `/api/orders/:id/pay`      | Session-owned sandbox checkout                            |
| POST   | `/api/webhooks/payment`    | Signed sandbox payment-success event                      |
| GET    | `/api/admin/auth`          | Verify operator credentials                               |
| GET    | `/api/admin/observability` | Process telemetry and durable system signals              |
| GET    | `/api/admin/metrics`       | Prometheus text exposition                                |
| GET    | `/api/admin/outbox`        | Latest 50 delivery events and failure/lease state         |
| POST   | `/api/admin/outbox/retry`  | Replay one failed UUID event, or a bounded batch          |
| POST   | `/api/admin/control`       | Toggle `worker` or `redis` lab fault                      |
| POST   | `/api/admin/expire/:id`    | Force held order expiry for the lab                       |

## Reservation retries

Body: `{ "seatIds": ["A1"], "key": "<UUID>" }`. A new order returns 201; an equal committed retry returns 200 with the current order state. Same key with a different canonical selection returns 409. Keys are scoped to the signed session, remain with their orders, and must be retained by the client after an unknown request outcome.

New reservations require admission and a rate-limit token. Committed retries are resolved before those new-work gates. A retry after confirmation may return a confirmed order; after expiry it may return an expired order.

## Payment webhook

The sandbox body is `{ "orderId": "<UUID>", "eventId": "<stable-provider-event-id>" }`. `X-Payment-Timestamp` is Unix seconds; `X-Payment-Signature` is the hex HMAC-SHA256 of `timestamp + '.' + rawBody` using `PAYMENT_WEBHOOK_SECRET`. The timestamp tolerance is five minutes, signatures are compared safely, and event IDs are persistently deduplicated. This is a deliberately scoped sandbox protocol, not Stripe's webhook format.

## Errors and correlation

400 invalid input; 401 missing/invalid operator or webhook credential; 403 admission/origin/lab restriction; 404 missing or non-owned resource; 409 inventory/key conflict; 413 excessive request body; 415 non-JSON mutation; 429 session quota; 503 bounded overload or dependency failure.

Responses carry `X-Request-ID` and W3C `traceparent` context. Incoming valid trace context is correlated into request logs and outbox jobs. It does not establish identity or authorization. Retryable 429/503 responses include `Retry-After`. Streams are excluded from request-duration histograms.

## Response contracts

Browser-facing order, snapshot, admission, telemetry, outbox, and command responses have executable schemas in `src/shared/model.ts` and `src/shared/observability.ts`. The HTTP adapter validates success responses, preserves HTTP failures, and reports invalid payloads as connection/protocol errors. Optional ownership and audit IDs are omitted when unavailable; they are never emitted as null. Private ownership remains hidden from other sessions. Unknown additive fields are accepted for forward compatibility.
