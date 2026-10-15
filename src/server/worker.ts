import { sql } from './db';
import { expireReservations } from './service';
import { log } from './telemetry';
export interface DeliveryJob {
  id: string;
  order_id: string;
  kind: string;
  attempts: number;
  claim_token: string;
  trace_id?: string;
}
export type DeliverySink = (job: DeliveryJob) => Promise<void>;
const MAX_ATTEMPTS = 5;
/** Separate transaction from claim and acknowledgement; job.id is the idempotency key. */
export const sandboxSink: DeliverySink = async (job) => {
  await sql.begin(async (tx) => {
    const inserted =
      await tx`INSERT INTO deliveries(id,order_id,kind) VALUES(${job.id},${job.order_id},${job.kind}) ON CONFLICT DO NOTHING RETURNING id`;
    if (!inserted.length) return;
    if (job.kind === 'refund')
      await tx`UPDATE orders SET status='refunded' WHERE id=${job.order_id} AND status='refund_pending'`;
    await tx`INSERT INTO audits(id,type,message,order_id) VALUES(${crypto.randomUUID()},'worker',${job.kind === 'refund' ? 'Sandbox refund completed.' : 'Confirmation delivered to sandbox sink.'},${job.order_id})`;
  });
};
const httpSink: DeliverySink = async (job) => {
  const url = process.env.DELIVERY_URL;
  if (!url) throw new Error('HTTP delivery requires DELIVERY_URL.');
  const response = await fetch(url, {
    method: 'POST',
    signal: AbortSignal.timeout(3000),
    headers: {
      'content-type': 'application/json',
      'idempotency-key': job.id,
      ...(job.trace_id
        ? {
            traceparent: `00-${job.trace_id}-${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}-01`,
          }
        : {}),
    },
    body: JSON.stringify({ eventId: job.id, orderId: job.order_id, kind: job.kind }),
  });
  await response.body?.cancel();
  if (!response.ok) throw new Error(`Delivery provider returned ${response.status}`);
};
export async function drainOutbox(
  deliver: DeliverySink = process.env.DELIVERY_URL ? httpSink : sandboxSink,
  afterDelivery?: (job: DeliveryJob) => Promise<void>,
): Promise<number> {
  const [flags] = await sql`SELECT worker_paused FROM lab_flags WHERE id=true`;
  if (flags?.worker_paused) return 0;
  const token = crypto.randomUUID();
  const jobs = await sql.begin(async (tx) => {
    await tx`UPDATE outbox SET failed=true,last_error='Worker lease expired after final attempt',claim_token=NULL,lease_until=NULL WHERE processed_at IS NULL AND failed=false AND attempts>=${MAX_ATTEMPTS} AND lease_until<=now()`;
    return tx<
      DeliveryJob[]
    >`UPDATE outbox SET claim_token=${token},lease_until=clock_timestamp()+interval '30 seconds',attempts=attempts+1
      WHERE id IN (SELECT id FROM outbox WHERE processed_at IS NULL AND failed=false AND attempts<${MAX_ATTEMPTS} AND available_at<=now() AND (lease_until IS NULL OR lease_until<=now()) ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 10) RETURNING *`;
  });
  // Network IO does not hold the queue transaction open. Independent jobs run concurrently.
  const outcomes = await Promise.all(
    jobs.map(async (job) => {
      try {
        await deliver(job);
        await afterDelivery?.(job);
        const ack = await sql.begin(async (tx) => {
          const rows =
            await tx`UPDATE outbox SET processed_at=clock_timestamp(),claim_token=NULL,lease_until=NULL,last_error=NULL WHERE id=${job.id} AND claim_token=${job.claim_token} RETURNING id`;
          if (rows.length && job.kind === 'refund')
            await tx`UPDATE orders SET status='refunded' WHERE id=${job.order_id} AND status='refund_pending'`;
          return rows;
        });
        log('info', 'delivery_completed', {
          jobId: job.id,
          orderId: job.order_id,
          traceId: job.trace_id,
          acknowledged: !!ack.length,
        });
        return ack.length ? 1 : 0;
      } catch (error) {
        const failed = job.attempts >= MAX_ATTEMPTS;
        const delay = Math.random() * Math.min(300, 2 ** job.attempts);
        await sql.begin(async (tx) => {
          const updated =
            await tx`UPDATE outbox SET failed=${failed},claim_token=NULL,lease_until=NULL,last_error=${error instanceof Error ? error.message.slice(0, 300) : 'Delivery failed'},available_at=clock_timestamp()+${delay}*interval '1 second' WHERE id=${job.id} AND claim_token=${job.claim_token} RETURNING id`;
          if (updated.length)
            await tx`INSERT INTO audits(id,type,message,order_id) VALUES(${crypto.randomUUID()},${failed ? 'delivery_failed' : 'delivery_retry'},${failed ? 'Delivery exhausted five attempts; operator replay required.' : 'Delivery failed; retry scheduled with full jitter.'},${job.order_id})`;
        });
        return 0;
      }
    }),
  );
  return outcomes.reduce<number>((a, b) => a + b, 0);
}
if (import.meta.main) {
  let stopping = false;
  const workerId = process.env.INSTANCE_ID || `worker-${process.pid}`;
  process.on('SIGTERM', () => {
    stopping = true;
  });
  process.on('SIGINT', () => {
    stopping = true;
  });
  log('info', 'worker_started', { workerId });
  while (!stopping) {
    try {
      await sql`INSERT INTO worker_heartbeats(id) VALUES(${workerId}) ON CONFLICT(id) DO UPDATE SET last_seen=clock_timestamp()`;
      await sql`DELETE FROM worker_heartbeats WHERE last_seen<now()-interval '1 day'`;
      await expireReservations();
      await drainOutbox();
    } catch (error) {
      log('error', 'worker_cycle_failed', {
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
    if (!stopping) await Bun.sleep(1000);
  }
  await sql`DELETE FROM worker_heartbeats WHERE id=${workerId}`.catch(() => {});
  await sql.end();
}
