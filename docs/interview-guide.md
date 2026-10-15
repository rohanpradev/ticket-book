# A five-minute interview walkthrough

## 0:00 — State the invariant

“Rush handles a flash-sale ticket drop. The important invariant is one active owner per seat, even when clients retry and workers fail.” Open the booking flow and reserve a seat. Explain that the displayed inventory is a view; the database decides whether the transaction succeeds.

## 0:45 — Show the implementation map

Open Control room → Architecture. Select Transactional locking and Durable idempotency. Explain the lock order, session-scoped key, and changed-payload rejection. Point to the replay-before-admission behavior: a lost response must still be recoverable after the original admission expires.

## 1:30 — Demonstrate a failure

Open Reliability lab and run the last-seat race, then duplicate checkout. In server mode these hit the real API; in the hosted sandbox clearly identify browser simulation. Read the outcome counts: distinguish one winner, conflicts, and deliberate load shedding. Do not call a browser scenario a distributed benchmark.

## 2:15 — Trace durable work

Pause the worker and confirm an order. Open Observability in server mode: inspect backlog age and the event's attempt state. Resume delivery. Explain claim, delivery, and fenced acknowledgement as three distinct steps.

The automated crash fixtures are the deeper proof: one terminates before delivery commit, another after delivery commit but before acknowledgement. Both recover without another local sink effect. Explain why a remote provider still needs idempotency.

## 3:15 — Explain compensation and dependency failure

Run late payment. Show that the seat remains released while a refund is queued. Then explain the Redis-loss test: PostgreSQL still caps admissions at 25 after all Redis state disappears. Queue ordering can reset; inventory and durable admission capacity cannot be reconstructed incorrectly from an empty cache.

## 4:00 — Show evidence and limits

Open the measured benchmark table and `docs/benchmarks/latest.json`. Explain two API processes, direct local HTTP, offered burst size, status distribution, hardware, and percentile scope. Show `bun run check` and the integration suite. Mention Vite+ type-aware checks, accessibility rules, migration checksums, and CI.

Finish by naming the actual next scaling boundary: the database writer, serialized admission decision, shared pool, and single region. Discuss what evidence would justify partitioning by event or extracting admission/delivery services.

## Questions to prepare for

- Why is an advisory lock combined with a unique constraint for request keys?
- Why can a successful reservation replay bypass admission, while new work cannot?
- What happens between a committed admission and failed Redis cleanup?
- Why does a lease need a fencing token, and what does the token not protect?
- What happens if payment succeeds after a replacement buyer purchases the seat?
- What is lost when `NOTIFY` is missed, and how does the UI recover?
- Which latency samples belong to rejected requests versus successful work?
- Which signals are durable, and which reset when an API restarts?
- Why keep one modular application instead of adding microservices?
- What would be required before integrating a real payment provider?
