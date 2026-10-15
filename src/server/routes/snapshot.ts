import { one } from '../result';
import type { Snapshot, Seat } from '../../shared/model';
import type { SqlOrder } from '../service';

import { Hono } from 'hono';

import { sql, redis } from '../db';
import { normalizeOrder } from '../service';
import { queueKeys } from '../queue';
import { metrics } from '../telemetry';

import type { AppEnv } from '../context';
import { admin } from '../auth';

type SeatRow = Omit<Seat, 'bookingId' | 'expiresAt'> & {
  bookingId: string | null;
  expiresAt: string | Date | null;
};
type AuditRow = {
  id: string;
  at: string | Date;
  type: string;
  message: string;
  order_id: string | null;
};

export const snapshotRoutes = new Hono<AppEnv>();
snapshotRoutes.get('/snapshot', async (c) => {
  const isAdmin = admin(c.req.header('x-admin-token') || '');
  const sessionId = c.get('sessionId');
  const result = await sql.begin('isolation level repeatable read', async (tx) => {
    const seats = await tx<
      SeatRow[]
    >`SELECT id,row,number,zone,price,status,booking_id AS "bookingId",expires_at AS "expiresAt" FROM seats ORDER BY row,number`;
    const orders = isAdmin
      ? await tx<SqlOrder[]>`SELECT * FROM orders ORDER BY created_at DESC LIMIT 500`
      : await tx<
          SqlOrder[]
        >`SELECT * FROM orders WHERE session_id=${sessionId} ORDER BY created_at DESC LIMIT 100`;
    const activity = isAdmin
      ? await tx<AuditRow[]>`SELECT * FROM audits ORDER BY at DESC LIMIT 100`
      : await tx<
          AuditRow[]
        >`SELECT * FROM audits WHERE order_id IN (SELECT id FROM orders WHERE session_id=${sessionId}) ORDER BY at DESC LIMIT 30`;
    const flags = one(
      await tx<
        { worker_paused: boolean; redis_down: boolean }[]
      >`SELECT * FROM lab_flags WHERE id=true`,
    );
    const pending = one(
      await tx<
        { n: number; failed: number }[]
      >`SELECT count(*) FILTER (WHERE failed=false)::int AS n, count(*) FILTER (WHERE failed=true)::int AS failed FROM outbox WHERE processed_at IS NULL`,
    );
    const reconciliation = one(
      await tx<{ consistent: boolean }[]>`SELECT NOT EXISTS (
      SELECT 1 FROM seats s LEFT JOIN orders o ON s.booking_id=o.id
      WHERE s.status<>'available' AND (o.id IS NULL OR NOT o.seat_ids ? s.id OR
      (s.status='held' AND o.status<>'held') OR (s.status='sold' AND o.status<>'confirmed'))
      UNION ALL
      SELECT 1 FROM orders o CROSS JOIN LATERAL jsonb_array_elements_text(o.seat_ids) x(id)
      LEFT JOIN seats s ON s.id=x.id
      WHERE o.status IN ('held','confirmed') AND (s.id IS NULL OR s.booking_id IS DISTINCT FROM o.id)
    ) AS consistent`,
    );

    return {
      seats: seats.map((s) => ({
        id: s.id,
        row: s.row,
        number: s.number,
        zone: s.zone,
        price: s.price,
        status: s.status,
        ...(s.bookingId && (isAdmin || orders.some((o) => o.id === s.bookingId))
          ? {
              bookingId: s.bookingId,
              ...(s.expiresAt ? { expiresAt: new Date(s.expiresAt).getTime() } : {}),
            }
          : {}),
      })),
      orders: orders.map((o) => normalizeOrder(o)),
      activity: activity.map((a) => ({
        id: a.id,
        at: new Date(a.at).getTime(),
        type: a.type,
        message: a.message,
        ...(a.order_id ? { orderId: a.order_id } : {}),
      })),
      consistent: reconciliation.consistent,
      workerPaused: isAdmin ? flags.worker_paused : false,
      redisDown: flags.redis_down,
      outboxPending: isAdmin ? pending.n : 0,
      failedDeliveries: isAdmin ? pending.failed : 0,
      viewerSessionId: sessionId,
    } satisfies Omit<Snapshot, 'queue' | 'mode' | 'metrics'>;
  });
  let queue = 0;
  try {
    queue = await redis.zcard(queueKeys.waiting);
  } catch {}
  return c.json({
    ...result,
    queue,
    mode: 'server',
    metrics: isAdmin ? metrics : { requests: 0, conflicts: 0, duplicates: 0, latencies: [] },
  });
});
