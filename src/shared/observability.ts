import { z } from 'zod';

const count = z.number().int().nonnegative();
const seconds = z.number().finite();
export const telemetrySchema = z.object({
  instanceId: z.string(),
  uptimeSeconds: count,
  scope: z.string(),
  requests: count,
  serverErrors: count,
  availability: z.number().min(0).max(1).nullable(),
  latency: z.object({
    p50: seconds.nullable(),
    p95: seconds.nullable(),
    p99: seconds.nullable(),
    samples: count,
  }),
  circuit: z.enum(['closed', 'open', 'half-open']),
  bulkheads: z.record(z.string(), z.object({ active: count, capacity: count, rejected: count })),
  recent: z.array(
    z.object({
      requestId: z.string(),
      traceId: z.string(),
      route: z.string(),
      method: z.string(),
      status: z.number().int().min(100).max(599),
      durationMs: seconds,
      at: count,
    }),
  ),
  backlog: z.object({ pending: count, failed: count, oldest_seconds: seconds }),
  admission: z.object({ active: count, capacity: count }),
  workers: z.array(z.object({ id: z.string(), age_seconds: seconds })),
  events: z.object({ connections: count, revision: count }),
  targets: z.object({
    availability: z.number().min(0).max(1),
    latencyP95Ms: seconds,
    note: z.string(),
  }),
});
const outboxJobSchema = z.object({
  id: z.string().uuid(),
  order_id: z.string().uuid(),
  kind: z.enum(['confirmation', 'refund']),
  attempts: count,
  created_at: z.iso.datetime(),
  available_at: z.iso.datetime(),
  processed_at: z.iso.datetime().nullable(),
  failed: z.boolean(),
  lease_until: z.iso.datetime().nullable(),
  last_error: z.string().nullable(),
  trace_id: z.string().nullable(),
});
export const outboxSchema = z.object({ jobs: z.array(outboxJobSchema), limit: count });
export type Telemetry = z.infer<typeof telemetrySchema>;
export type OutboxJob = z.infer<typeof outboxJobSchema>;
