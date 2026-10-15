import { z } from 'zod';

const seatStatusSchema = z.enum(['available', 'held', 'sold']);
const orderStatusSchema = z.enum(['held', 'confirmed', 'expired', 'refund_pending', 'refunded']);
const timestamp = z.number().int().nonnegative();
const seatSchema = z.object({
  id: z.string().regex(/^[A-J](10|[1-9])$/),
  row: z.string().regex(/^[A-J]$/),
  number: z.number().int().min(1).max(10),
  zone: z.string().min(1),
  price: z.number().int().nonnegative(),
  status: seatStatusSchema,
  bookingId: z.string().uuid().optional(),
  expiresAt: timestamp.optional(),
});
export const orderSchema = z.object({
  id: z.string().uuid(),
  seatIds: z.array(seatSchema.shape.id).min(1).max(4),
  amount: z.number().int().nonnegative(),
  status: orderStatusSchema,
  createdAt: timestamp,
  expiresAt: timestamp,
  sessionId: z.string().min(1),
  key: z.string().uuid(),
});
export const snapshotSchema = z.object({
  seats: z.array(seatSchema),
  orders: z.array(orderSchema),
  activity: z.array(
    z.object({
      id: z.string().uuid(),
      at: timestamp,
      type: z.string(),
      message: z.string(),
      orderId: z.string().uuid().optional(),
    }),
  ),
  queue: z.number().int().nonnegative(),
  workerPaused: z.boolean(),
  redisDown: z.boolean(),
  outboxPending: z.number().int().nonnegative(),
  mode: z.enum(['sandbox', 'server']),
  consistent: z.boolean().optional(),
  viewerSessionId: z.string().optional(),
  failedDeliveries: z.number().int().nonnegative().optional(),
  metrics: z.object({
    requests: z.number().int().nonnegative(),
    conflicts: z.number().int().nonnegative(),
    duplicates: z.number().int().nonnegative(),
    latencies: z.array(z.number().nonnegative()),
  }),
});
export const admissionSchema = z.object({
  admitted: z.boolean(),
  position: z.number().int().nonnegative(),
});
export const okSchema = z.object({ ok: z.literal(true) });
export const replaySchema = z.object({ retried: z.number().int().nonnegative() });
export type SeatStatus = z.infer<typeof seatStatusSchema>;
export type OrderStatus = z.infer<typeof orderStatusSchema>;
export type Seat = z.infer<typeof seatSchema>;
export type Order = z.infer<typeof orderSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;

export const HOLD_MS = 5 * 60 * 1000;
export function makeSeats(): Seat[] {
  return Array.from({ length: 100 }, (_, i) => {
    const r = Math.floor(i / 10);
    return {
      id: `${String.fromCharCode(65 + r)}${(i % 10) + 1}`,
      row: String.fromCharCode(65 + r),
      number: (i % 10) + 1,
      zone: r < 3 ? 'Front row' : r < 7 ? 'Floor' : 'Balcony',
      price: r < 3 ? 3999 : r < 7 ? 2999 : 1999,
      status: 'available',
    };
  });
}
export function total(seats: Seat[]) {
  return seats.reduce((n, s) => n + s.price, 0);
}
export function money(n: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n);
}
export function invariant(seats: Seat[], orders: Order[]) {
  const active = orders.filter((o) => o.status === 'held' || o.status === 'confirmed');
  const seen = new Set<string>();
  for (const o of active)
    for (const id of o.seatIds) {
      if (seen.has(id)) return false;
      seen.add(id);
      const s = seats.find((x) => x.id === id);
      if (!s || s.bookingId !== o.id || s.status !== (o.status === 'held' ? 'held' : 'sold'))
        return false;
    }
  return seats.every(
    (s) =>
      s.status === 'available' ||
      active.some((o) => o.id === s.bookingId && o.seatIds.includes(s.id)),
  );
}
