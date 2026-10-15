import assert from 'node:assert/strict';
import { describe, expect, test } from 'bun:test';
import { invariant, makeSeats, total, type Order } from '../src/shared/model';
describe('inventory invariants', () => {
  test('the venue contains 100 uniquely identified seats with integer prices', () => {
    const seats = makeSeats();
    expect(new Set(seats.map((s) => s.id)).size).toBe(100);
    expect(seats.every((s) => Number.isInteger(s.price) && s.price > 0)).toBe(true);
    expect(total(seats)).toBe(299900);
  });
  test('rejects an active order whose seat does not belong to it', () => {
    const seats = makeSeats();
    const first = seats[0];
    assert(first);
    const order: Order = {
      id: 'order-1',
      seatIds: ['A1'],
      amount: 3999,
      status: 'held',
      createdAt: 0,
      expiresAt: 100,
      sessionId: 's',
      key: 'k',
    };
    expect(invariant(seats, [order])).toBe(false);
    seats[0] = { ...first, status: 'held', bookingId: order.id };
    expect(invariant(seats, [order])).toBe(true);
  });
  test('rejects duplicate ownership and orphaned inventory', () => {
    const seats = makeSeats();
    const first = seats[0];
    assert(first);
    first.status = 'sold';
    expect(invariant(seats, [])).toBe(false);
    const order: Order = {
      id: 'o',
      seatIds: ['A1'],
      amount: 3999,
      status: 'confirmed',
      createdAt: 0,
      expiresAt: 0,
      sessionId: 's',
      key: 'k',
    };
    first.bookingId = 'o';
    expect(invariant(seats, [order, order])).toBe(false);
  });
});
