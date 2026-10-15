import { one } from './result';
import type { Order, OrderStatus } from '../shared/model';
import { and, eq, sql as q } from 'drizzle-orm';
import { db, sql } from './db';
import { orders, seats, audits } from './schema';
import { HOLD_MS } from '../shared/model';
const uuid = () => crypto.randomUUID();
export class DomainError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 403 | 404 | 409 | 429 | 503 = 409,
  ) {
    super(message);
  }
}
export async function expireReservations() {
  await sql.begin(async (tx) => {
    const expired =
      await tx`SELECT id FROM orders WHERE status='held' AND expires_at<=now() ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 200`;
    for (const o of expired) {
      await tx`UPDATE seats SET status='available',booking_id=NULL,expires_at=NULL WHERE booking_id=${o.id} AND status='held'`;
      await tx`UPDATE orders SET status='expired' WHERE id=${o.id}`;
      await tx`INSERT INTO audits(id,type,message,order_id) VALUES(${uuid()},'expired','Reservation expired; seats released.',${o.id})`;
    }
  });
}
export async function replayReservation(sessionId: string, ids: string[], key: string) {
  const [prior] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.sessionId, sessionId), eq(orders.key, key)));
  if (!prior) return null;
  if ([...prior.seatIds].sort().join() !== [...ids].sort().join())
    throw new DomainError('Idempotency key already used for a different selection.');
  return { ...prior, replayed: true };
}
export async function reserve(sessionId: string, ids: string[], key: string) {
  if (ids.length < 1 || ids.length > 4 || new Set(ids).size !== ids.length)
    throw new DomainError('Choose 1–4 different seats.', 400);
  await expireReservations();
  return db.transaction(async (tx) => {
    // Serializes retries of the same request across all API instances.
    await tx.execute(q`SELECT pg_advisory_xact_lock(hashtextextended(${sessionId + ':' + key},0))`);
    const [prior] = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.sessionId, sessionId), eq(orders.key, key)));
    if (prior) {
      if ([...prior.seatIds].sort().join() !== [...ids].sort().join())
        throw new DomainError('Idempotency key already used for a different selection.');
      return { ...prior, replayed: true };
    }
    const locked = await tx.execute(
      q`SELECT * FROM seats WHERE id IN (${q.join(
        [...ids].sort().map((id) => q`${id}`),
        q`,`,
      )}) ORDER BY id FOR UPDATE`,
    );
    if (locked.length !== ids.length || locked.some((s) => s.status !== 'available'))
      throw new DomainError('Someone just reserved one of those seats. Please choose another.');
    const clock = one(await tx.execute<{ now: string | Date }>(q`SELECT clock_timestamp() AS now`));
    const o = {
      id: uuid(),
      sessionId,
      key,
      seatIds: ids,
      amount: locked.reduce((n, s) => n + Number(s.price), 0),
      status: 'held' as const,
      expiresAt: new Date(new Date(clock.now).getTime() + HOLD_MS),
    };
    const saved = one(await tx.insert(orders).values(o).returning());
    await tx
      .update(seats)
      .set({ status: 'held', bookingId: o.id, expiresAt: o.expiresAt })
      .where(
        q`${seats.id} IN (${q.join(
          ids.map((id) => q`${id}`),
          q`,`,
        )})`,
      );
    await tx.insert(audits).values({
      id: uuid(),
      type: 'reservation',
      message: `${ids.join(', ')} held for five minutes.`,
      orderId: o.id,
    });
    return { ...saved, replayed: false };
  });
}
export async function payment(orderId: string, eventId: string, traceId: string | null = null) {
  await expireReservations();
  return sql.begin(async (tx) => {
    const [o] = await tx<SqlOrder[]>`SELECT * FROM orders WHERE id=${orderId} FOR UPDATE`;
    if (!o) throw new DomainError('Order not found.', 404);
    const inserted =
      await tx`INSERT INTO payment_events(id,order_id) VALUES(${eventId},${orderId}) ON CONFLICT DO NOTHING RETURNING id`;
    if (!inserted.length) {
      const [existing] = await tx`SELECT order_id FROM payment_events WHERE id=${eventId}`;
      if (!existing || existing.order_id !== orderId)
        throw new DomainError('Payment event belongs to a different order.');
      return o;
    }
    if (o.status === 'confirmed' || o.status === 'refund_pending' || o.status === 'refunded')
      return o;
    // Recheck after acquiring the order lock: expiry can race with payment.
    const clock = one(await tx`SELECT clock_timestamp() AS now`);
    if (o.status === 'held' && new Date(o.expires_at).getTime() <= new Date(clock.now).getTime()) {
      await tx`UPDATE seats SET status='available',booking_id=NULL,expires_at=NULL WHERE booking_id=${orderId} AND status='held'`;
      o.status = 'expired';
    }
    const status: OrderStatus = o.status === 'held' ? 'confirmed' : 'refund_pending';
    await tx`UPDATE orders SET status=${status} WHERE id=${orderId}`;
    if (status === 'confirmed')
      await tx`UPDATE seats SET status='sold',expires_at=NULL WHERE booking_id=${orderId}`;
    await tx`INSERT INTO outbox(id,order_id,trace_id,kind) VALUES(${uuid()},${orderId},${traceId},${status === 'confirmed' ? 'confirmation' : 'refund'})`;
    await tx`INSERT INTO audits(id,type,message,order_id) VALUES(${uuid()},${status},${status === 'confirmed' ? 'Payment accepted. Ticket confirmed.' : 'Late payment received; refund queued without reclaiming seats.'},${orderId})`;
    return { ...o, status };
  });
}
type StoredOrder = typeof orders.$inferSelect;
export type SqlOrder = {
  id: string;
  session_id: string;
  idempotency_key: string;
  seat_ids: string[];
  amount: number;
  status: OrderStatus;
  created_at: string | Date;
  expires_at: string | Date;
};
export function normalizeOrder(o: StoredOrder | SqlOrder): Order {
  const camel = 'sessionId' in o;
  return {
    id: o.id,
    sessionId: camel ? o.sessionId : o.session_id,
    key: camel ? o.key : o.idempotency_key,
    seatIds: camel ? o.seatIds : o.seat_ids,
    amount: o.amount,
    status: o.status,
    createdAt: new Date(camel ? o.createdAt : o.created_at).getTime(),
    expiresAt: new Date(camel ? o.expiresAt : o.expires_at).getTime(),
  };
}
