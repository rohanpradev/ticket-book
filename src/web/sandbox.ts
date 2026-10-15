import {
  HOLD_MS,
  makeSeats,
  total,
  type Snapshot,
  type Order,
  snapshotSchema,
} from '../shared/model';
const KEY = 'rush:sandbox:v1';
const uuid = () => crypto.randomUUID();
function initial(): Snapshot {
  return {
    seats: makeSeats(),
    orders: [],
    activity: [
      {
        id: uuid(),
        at: Date.now(),
        type: 'system',
        message: 'Sandbox ready. 100 seats, one unforgettable night.',
      },
    ],
    queue: 0,
    workerPaused: false,
    redisDown: false,
    outboxPending: 0,
    mode: 'sandbox',
    metrics: { requests: 0, conflicts: 0, duplicates: 0, latencies: [] },
  };
}
function read(): Snapshot {
  try {
    const result = snapshotSchema.safeParse(JSON.parse(localStorage.getItem(KEY) || 'null'));
    return result.success ? result.data : initial();
  } catch {
    return initial();
  }
}
function log(s: Snapshot, type: string, message: string, orderId?: string) {
  s.activity.unshift({
    id: uuid(),
    at: Date.now(),
    type,
    message,
    ...(orderId ? { orderId } : {}),
  });
  s.activity = s.activity.slice(0, 150);
}
function expire(s: Snapshot) {
  for (const o of s.orders)
    if (o.status === 'held' && o.expiresAt <= Date.now()) {
      o.status = 'expired';
      s.seats
        .filter((x) => x.bookingId === o.id)
        .forEach((x) => {
          x.status = 'available';
          delete x.bookingId;
          delete x.expiresAt;
        });
      log(s, 'expired', `Reservation ${o.id.slice(0, 8)} expired; seats released.`, o.id);
    }
  if (!s.workerPaused && s.outboxPending) {
    log(s, 'worker', `Worker delivered ${s.outboxPending} pending confirmation event(s).`);
    s.outboxPending = 0;
    for (const o of s.orders)
      if (o.status === 'refund_pending') {
        o.status = 'refunded';
        log(s, 'refund', 'Sandbox refund completed.', o.id);
      }
  }
}
async function mutate<T>(fn: (s: Snapshot) => T, notify = true): Promise<T> {
  const run = () => {
    const s = read();
    expire(s);
    let result: T;
    try {
      result = fn(s);
    } finally {
      localStorage.setItem(KEY, JSON.stringify(s));
      if (notify) window.dispatchEvent(new Event('rush-update'));
    }
    return result;
  };
  return navigator.locks ? navigator.locks.request('rush-sandbox', run) : run();
}
export async function snapshot() {
  return mutate((s) => s, false);
}
export async function join() {
  return mutate((s) => {
    if (s.redisDown)
      throw new Error(
        'Admissions are paused while Redis is unavailable. Existing reservations remain safe.',
      );
    log(s, 'admission', 'A visitor was admitted to the drop.');
    return { admitted: true, position: 0 };
  });
}
export async function reserve(ids: string[], key: string, sessionId: string): Promise<Order> {
  return mutate((s) => {
    const start = performance.now();
    s.metrics.requests++;
    const prior = s.orders.find((o) => o.key === key && o.sessionId === sessionId);
    if (prior) {
      if ([...prior.seatIds].sort().join() !== [...ids].sort().join())
        throw new Error('This request key belongs to another selection.');
      s.metrics.duplicates++;
      return prior;
    }
    if (ids.length < 1 || ids.length > 4 || new Set(ids).size !== ids.length)
      throw new Error('Choose 1–4 different seats.');
    const seats = s.seats.filter((seat) => ids.includes(seat.id));
    if (seats.length !== ids.length || seats.some((x) => x.status !== 'available')) {
      s.metrics.conflicts++;
      throw new Error('Someone just reserved one of those seats. Please choose another.');
    }
    const o: Order = {
      id: uuid(),
      seatIds: ids,
      amount: total(seats),
      status: 'held',
      createdAt: Date.now(),
      expiresAt: Date.now() + HOLD_MS,
      sessionId,
      key,
    };
    s.orders.unshift(o);
    seats.forEach((x) => {
      x.status = 'held';
      x.bookingId = o.id;
      x.expiresAt = o.expiresAt;
    });
    s.metrics.latencies.push(performance.now() - start);
    s.metrics.latencies = s.metrics.latencies.slice(-500);
    log(s, 'reservation', `${ids.join(', ')} held for five minutes.`, o.id);
    return o;
  });
}
export async function pay(id: string) {
  return mutate((s) => {
    const o = s.orders.find((x) => x.id === id);
    if (!o) throw new Error('Reservation not found.');
    if (o.status === 'confirmed') {
      s.metrics.duplicates++;
      log(s, 'deduplicated', 'Duplicate payment ignored; original ticket returned.', o.id);
      return o;
    }
    if (o.status === 'expired') {
      o.status = 'refund_pending';
      s.outboxPending++;
      log(s, 'refund', 'Late payment received. Seat remains released; refund queued.', o.id);
      return o;
    }
    if (o.status === 'held') {
      o.status = 'confirmed';
      s.seats
        .filter((x) => x.bookingId === o.id)
        .forEach((x) => {
          x.status = 'sold';
          delete x.expiresAt;
        });
      s.outboxPending++;
      log(s, 'confirmed', `Order confirmed for ${o.seatIds.join(', ')}.`, o.id);
    }
    return o;
  });
}
export async function control(action: string) {
  return mutate((s) => {
    if (action === 'reset') {
      const clean = initial();
      Object.assign(s, clean);
      return;
    }
    if (action === 'worker') {
      s.workerPaused = !s.workerPaused;
      log(
        s,
        'worker',
        s.workerPaused
          ? 'Worker paused. Durable events will accumulate.'
          : 'Worker resumed. Pending work will drain.',
      );
    }
    if (action === 'redis') {
      s.redisDown = !s.redisDown;
      log(
        s,
        'system',
        s.redisDown
          ? 'Redis disconnected. New admissions paused.'
          : 'Redis restored. Admissions reopened.',
      );
    }
  });
}
export async function expireOrder(id: string) {
  await mutate((s) => {
    const o = s.orders.find((x) => x.id === id);
    if (o && o.status === 'held') o.expiresAt = Date.now() - 1;
  });
  await snapshot();
}
