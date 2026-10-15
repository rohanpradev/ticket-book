import { describe, expect, test } from 'bun:test';
import { makeSeats, orderSchema, snapshotSchema } from '../src/shared/model';

const order = {
  id: crypto.randomUUID(),
  seatIds: ['A1'],
  amount: 3999,
  status: 'held',
  createdAt: 1,
  expiresAt: 300001,
  sessionId: crypto.randomUUID(),
  key: crypto.randomUUID(),
};
describe('untrusted data contracts', () => {
  test('rejects unknown order states, invalid timestamps, and fractional money', () => {
    expect(orderSchema.safeParse({ ...order, status: 'paid' }).success).toBe(false);
    expect(orderSchema.safeParse({ ...order, amount: 39.99 }).success).toBe(false);
    expect(orderSchema.safeParse({ ...order, expiresAt: Infinity }).success).toBe(false);
  });
  test('accepts omitted private ownership and rejects null ownership or corrupt persisted state', () => {
    const snapshot = {
      seats: makeSeats(),
      orders: [],
      activity: [],
      queue: 0,
      workerPaused: false,
      redisDown: false,
      outboxPending: 0,
      mode: 'sandbox',
      metrics: { requests: 0, conflicts: 0, duplicates: 0, latencies: [] },
    };
    expect(snapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(
      snapshotSchema.safeParse({ ...snapshot, seats: [{ ...snapshot.seats[0], bookingId: null }] })
        .success,
    ).toBe(false);
    expect(snapshotSchema.safeParse({ ...snapshot, orders: 'corrupt' }).success).toBe(false);
  });
});
