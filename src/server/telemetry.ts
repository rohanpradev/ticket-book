import { Bulkhead, CircuitBreaker } from './resilience';
const instanceId = process.env.INSTANCE_ID || `rush-${process.pid}`;
export const redisCircuit = new CircuitBreaker();
export const bulkheads = {
  reads: new Bulkhead(48),
  reservations: new Bulkhead(24),
  payments: new Bulkhead(12),
};
const buckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.3, 1, 3, 10];
type Metric = {
  route: string;
  method: string;
  status: number;
  count: number;
  sum: number;
  buckets: number[];
};
export type RequestSample = {
  requestId: string;
  traceId: string;
  route: string;
  method: string;
  status: number;
  durationMs: number;
  at: number;
};
const series = new Map<string, Metric>();
export const metrics = { requests: 0, conflicts: 0, duplicates: 0, latencies: [] as number[] };
const recent: RequestSample[] = [];
const startedAt = Date.now();
export function observe(sample: RequestSample) {
  metrics.requests++;
  if (sample.status === 409) metrics.conflicts++;
  metrics.latencies.push(sample.durationMs);
  if (metrics.latencies.length > 500) metrics.latencies.shift();
  recent.unshift(sample);
  if (recent.length > 40) recent.pop();
  const key = `${sample.method}:${sample.route}:${sample.status}`;
  let metric = series.get(key);
  if (!metric) {
    metric = {
      route: sample.route,
      method: sample.method,
      status: sample.status,
      count: 0,
      sum: 0,
      buckets: buckets.map(() => 0),
    };
    series.set(key, metric);
  }
  metric.count++;
  metric.sum += sample.durationMs / 1000;
  const counts = metric.buckets;
  metric.buckets = buckets.map(
    (boundary, index) => (counts[index] ?? 0) + Number(sample.durationMs / 1000 <= boundary),
  );
}
export function telemetrySnapshot() {
  const latencies = [...metrics.latencies].sort((a, b) => a - b);
  const quantile = (p: number) =>
    latencies.length ? (latencies[Math.ceil(latencies.length * p) - 1] ?? null) : null;
  const observations = [...series.values()];
  const total = observations.reduce((n, m) => n + m.count, 0);
  const errors = observations.filter((m) => m.status >= 500).reduce((n, m) => n + m.count, 0);
  return {
    instanceId,
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    scope: 'This API process since startup; scrape every replica for service-wide metrics.',
    requests: total,
    serverErrors: errors,
    availability: total ? (total - errors) / total : null,
    latency: {
      p50: quantile(0.5),
      p95: quantile(0.95),
      p99: quantile(0.99),
      samples: latencies.length,
    },
    circuit: redisCircuit.state,
    bulkheads: Object.fromEntries(
      Object.entries(bulkheads).map(([name, b]) => [
        name,
        { active: b.active, capacity: b.capacity, rejected: b.rejected },
      ]),
    ),
    recent,
  };
}
export function prometheus() {
  const lines = [
    '# HELP rush_http_requests_total Completed non-streaming HTTP requests.',
    '# TYPE rush_http_requests_total counter',
    '# HELP rush_http_request_duration_seconds Request duration in seconds.',
    '# TYPE rush_http_request_duration_seconds histogram',
  ];
  for (const m of series.values()) {
    const labels = `method="${m.method}",route="${m.route}",status="${m.status}"`;
    lines.push(`rush_http_requests_total{${labels}} ${m.count}`);
    buckets.forEach((b, i) =>
      lines.push(`rush_http_request_duration_seconds_bucket{${labels},le="${b}"} ${m.buckets[i]}`),
    );
    lines.push(
      `rush_http_request_duration_seconds_bucket{${labels},le="+Inf"} ${m.count}`,
      `rush_http_request_duration_seconds_sum{${labels}} ${m.sum}`,
      `rush_http_request_duration_seconds_count{${labels}} ${m.count}`,
    );
  }
  lines.push(
    '# TYPE rush_idempotency_replays_total counter',
    `rush_idempotency_replays_total ${metrics.duplicates}`,
    '# TYPE rush_redis_circuit_open gauge',
    `rush_redis_circuit_open ${redisCircuit.state === 'closed' ? 0 : 1}`,
  );
  for (const [name, b] of Object.entries(bulkheads))
    lines.push(
      `rush_inflight_requests{lane="${name}"} ${b.active}`,
      `rush_bulkhead_rejections_total{lane="${name}"} ${b.rejected}`,
    );
  return lines.join('\n') + '\n';
}
export function log(level: string, event: string, fields: Record<string, unknown> = {}) {
  if (process.env.LOG_LEVEL === 'silent') return;
  console.log(
    JSON.stringify({ at: new Date().toISOString(), level, event, instanceId, ...fields }),
  );
}
