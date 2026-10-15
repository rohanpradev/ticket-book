import type { OutboxJob } from '../../shared/observability';
import { one } from '../result';
import { Hono } from 'hono';

import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import { sql } from '../db';
import { DomainError } from '../service';
import { ADMISSION_CAPACITY } from '../queue';
import { telemetrySnapshot, prometheus } from '../telemetry';
import { eventStatus } from '../events';
import type { AppEnv } from '../context';

export const operationsRoutes = new Hono<AppEnv>();
operationsRoutes.get('/admin/observability', async (c) => {
  const backlog = one(
    await sql`SELECT count(*) FILTER (WHERE failed=false)::int AS pending,count(*) FILTER (WHERE failed=true)::int AS failed,COALESCE(EXTRACT(epoch FROM (now()-min(created_at) FILTER (WHERE failed=false))),0)::float AS oldest_seconds FROM outbox WHERE processed_at IS NULL`,
  );
  const admission = one(
    await sql`SELECT count(*)::int AS active FROM admissions WHERE expires_at>now()`,
  );
  const workers =
    await sql`SELECT id,EXTRACT(epoch FROM (now()-last_seen))::float AS age_seconds FROM worker_heartbeats ORDER BY last_seen DESC LIMIT 20`;
  return c.json({
    ...telemetrySnapshot(),
    backlog,
    admission: { active: admission.active, capacity: ADMISSION_CAPACITY },
    workers,
    events: eventStatus(),
    targets: {
      availability: 0.999,
      latencyP95Ms: 300,
      note: 'Design targets; not a production SLA. Request timings exclude SSE.',
    },
  });
});
operationsRoutes.get('/admin/metrics', async (c) => {
  const b = one(
    await sql`SELECT count(*) FILTER(WHERE failed=false)::int AS pending,count(*) FILTER(WHERE failed=true)::int AS failed,COALESCE(EXTRACT(epoch FROM (now()-min(created_at) FILTER(WHERE failed=false))),0)::float AS oldest FROM outbox WHERE processed_at IS NULL`,
  );
  return c.text(
    prometheus() +
      `# TYPE rush_outbox_pending gauge
rush_outbox_pending ${b.pending}
# TYPE rush_outbox_dead_letters gauge
rush_outbox_dead_letters ${b.failed}
# TYPE rush_outbox_oldest_seconds gauge
rush_outbox_oldest_seconds ${b.oldest}
`,
    200,
    { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' },
  );
});
operationsRoutes.get('/admin/outbox', async (c) => {
  const jobs = await sql<
    OutboxJob[]
  >`SELECT id,order_id,kind,attempts,created_at,available_at,processed_at,failed,lease_until,last_error,trace_id FROM outbox ORDER BY created_at DESC,id DESC LIMIT 50`;
  return c.json({
    jobs: jobs.map((job) => ({
      ...job,
      created_at: new Date(job.created_at).toISOString(),
      available_at: new Date(job.available_at).toISOString(),
      processed_at: job.processed_at ? new Date(job.processed_at).toISOString() : null,
      lease_until: job.lease_until ? new Date(job.lease_until).toISOString() : null,
    })),
    limit: 50,
  });
});
operationsRoutes.get('/admin/auth', (c) => c.json({ ok: true }));
operationsRoutes.post(
  '/admin/control',
  zValidator('json', z.object({ action: z.enum(['worker', 'redis']) })),
  async (c) => {
    if (process.env.LAB_ENABLED !== 'true')
      throw new DomainError('Lab controls are disabled.', 403);
    const { action } = c.req.valid('json');
    if (action === 'worker')
      await sql`UPDATE lab_flags SET worker_paused=NOT worker_paused WHERE id=true`;
    else await sql`UPDATE lab_flags SET redis_down=NOT redis_down WHERE id=true`;
    return c.json({ ok: true });
  },
);
operationsRoutes.post(
  '/admin/outbox/retry',
  zValidator('json', z.object({ id: z.string().uuid().optional() })),
  async (c) => {
    const { id } = c.req.valid('json');
    const retried = await sql.begin(async (tx) => {
      const rows = id
        ? await tx`UPDATE outbox SET failed=false,attempts=0,available_at=now(),last_error=NULL WHERE id=${id} AND failed=true AND processed_at IS NULL RETURNING id,order_id`
        : await tx`UPDATE outbox SET failed=false,attempts=0,available_at=now(),last_error=NULL WHERE id IN(SELECT id FROM outbox WHERE failed=true AND processed_at IS NULL ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 50) RETURNING id,order_id`;
      for (const row of rows)
        await tx`INSERT INTO audits(id,type,message,order_id) VALUES(${crypto.randomUUID()},'operator_replay',${'Operator replayed delivery ' + row.id},${row.order_id})`;
      return rows;
    });
    return c.json({ retried: retried.length });
  },
);
operationsRoutes.post('/admin/expire/:id', async (c) => {
  if (process.env.LAB_ENABLED !== 'true') throw new DomainError('Lab controls are disabled.', 403);
  await sql`UPDATE orders SET expires_at=now()-interval '1 second' WHERE id=${c.req.param('id')} AND status='held'`;
  return c.json({ ok: true });
});
