import { api, HttpError, serverMode } from './api';
export type ExperimentKind = 'race' | 'duplicate' | 'late' | 'worker';
export type ExperimentResult = { name: string; detail: string; pass: boolean; at: number };
/** Executable scenarios live outside React so rendering remains pure. */
export async function runExperiment(
  kind: ExperimentKind,
  report: (message: string) => void,
): Promise<ExperimentResult> {
  if (serverMode && !(await api.join()).admitted)
    throw new Error(
      'Waiting-room capacity is full. Complete existing checkouts or wait for a lease.',
    );
  const initial = await api.snapshot();
  const seat = initial.seats.find((s) => s.status === 'available');
  if (!seat) throw new Error('No available seats. Use a fresh sandbox to run this scenario.');
  const key = crypto.randomUUID();
  if (kind === 'race') {
    const started = performance.now();
    report('Sending 40 concurrent attempts for one seat…');
    const outcomes = await Promise.allSettled(
      Array.from({ length: 40 }, () => api.reserve([seat.id], crypto.randomUUID())),
    );
    const winners = outcomes.filter((x) => x.status === 'fulfilled');
    const shed = outcomes.filter(
      (x) => x.status === 'rejected' && x.reason instanceof HttpError && x.reason.status === 503,
    ).length;
    const conflicts = outcomes.filter(
      (x) =>
        x.status === 'rejected' &&
        (!serverMode || (x.reason instanceof HttpError && x.reason.status === 409)),
    ).length;
    const duration = performance.now() - started;
    if (winners[0]?.status === 'fulfilled') await api.expire(winners[0].value.id);
    return {
      name: 'Concurrent reservation',
      detail: `${winners.length} winner · ${conflicts} conflicts · ${shed} load shed · seat ${seat.id} · ${duration.toFixed(0)} ms`,
      pass: winners.length === 1 && winners.length + shed + conflicts === 40,
      at: Date.now(),
    };
  }
  if (kind === 'duplicate') {
    const order = await api.reserve([seat.id], key);
    const responses = await Promise.all(Array.from({ length: 6 }, () => api.pay(order.id)));
    return {
      name: 'Duplicate checkout',
      detail: `6 checkout retries → one confirmed order · ${order.id.slice(0, 8)}`,
      pass: responses.every((x) => x.id === order.id && x.status === 'confirmed'),
      at: Date.now(),
    };
  }
  if (kind === 'late') {
    const order = await api.reserve([seat.id], key);
    await api.expire(order.id);
    const paid = await api.pay(order.id),
      after = await api.snapshot();
    return {
      name: 'Late payment',
      detail: `${seat.id} released · refund workflow queued · no seat reclaimed`,
      pass:
        ['refund_pending', 'refunded'].includes(paid.status) &&
        after.seats.find((x) => x.id === seat.id)?.status === 'available',
      at: Date.now(),
    };
  }
  try {
    if (!initial.workerPaused) await api.control('worker');
    const order = await api.reserve([seat.id], key);
    await api.pay(order.id);
    const pending = await api.snapshot();
    report('Event committed while worker is paused. Resuming delivery…');
    await api.control('worker');
    let after = await api.snapshot();
    const deadline = Date.now() + 8000;
    while (after.outboxPending && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 300));
      after = await api.snapshot();
    }
    return {
      name: 'Worker recovery',
      detail: `${pending.outboxPending} pending event(s) recovered · backlog ${after.outboxPending}`,
      pass: pending.outboxPending > 0 && after.outboxPending === 0,
      at: Date.now(),
    };
  } finally {
    const current = await api.snapshot();
    if (current.workerPaused !== initial.workerPaused) await api.control('worker');
  }
}
