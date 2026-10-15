import assert from 'node:assert/strict';
import { cpus, totalmem, platform, arch } from 'node:os';
import { z } from 'zod';
import { makeSeats } from '../src/shared/model';
const url = new URL(
  process.env.BENCHMARK_DATABASE_URL || 'postgres://rush:rush_local@127.0.0.1:54329/rush_benchmark',
);
if (url.pathname !== '/rush_benchmark')
  throw new Error('Benchmark only runs against rush_benchmark.');
process.env.DATABASE_URL = url.toString();
process.env.REDIS_URL = process.env.BENCHMARK_REDIS_URL || 'redis://127.0.0.1:63799/2';
if (new URL(process.env.REDIS_URL).pathname !== '/2')
  throw new Error('Benchmark requires isolated Redis database 2.');
process.env.LOG_LEVEL = 'silent';
const { sql, db, redis, connectRedis } = await import('../src/server/db');
const { seats } = await import('../src/server/schema');
const { drainOutbox } = await import('../src/server/worker');
const secret = 'benchmark-only-secret-at-least-32-characters';
const env = {
  ...process.env,
  SESSION_SECRET: secret,
  ADMIN_TOKEN: secret,
  PAYMENT_WEBHOOK_SECRET: secret,
  LAB_ENABLED: 'true',
};
const processes: ReturnType<typeof Bun.spawn>[] = [];
type Result = {
  name: string;
  requests: number;
  concurrency: number;
  durationMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  statuses: Record<string, number>;
  passed: boolean;
};
const results: Result[] = [];
const orderPayload = z.object({ id: z.string().uuid(), status: z.string() });
const percentile = (samples: number[], q: number) => {
  const value = samples[Math.ceil(samples.length * q) - 1];
  assert(value !== undefined, 'A benchmark phase must produce latency samples.');
  return +value.toFixed(2);
};
try {
  const migration = Bun.spawn(['bun', 'src/server/migrate.ts'], {
    env,
    stdout: 'ignore',
    stderr: 'inherit',
  });
  if ((await migration.exited) !== 0) throw new Error('Migration failed.');
  await connectRedis();
  await redis.flushdb();
  await sql`TRUNCATE payment_events,outbox,deliveries,audits,seats,orders,admissions,worker_heartbeats CASCADE`;
  await sql`UPDATE lab_flags SET worker_paused=false,redis_down=false`;
  await db.insert(seats).values(makeSeats().map(({ expiresAt, bookingId, ...s }) => s));
  for (const port of [3201, 3202]) {
    processes.push(
      Bun.spawn(['bun', 'src/server/index.ts'], {
        env: { ...env, PORT: String(port) },
        stdout: 'ignore',
        stderr: 'inherit',
      }),
    );
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try {
        if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) {
          ready = true;
          break;
        }
      } catch {}
      await Bun.sleep(100);
    }
    if (!ready) throw new Error('Benchmark API failed to start.');
  }
  async function client() {
    const r = await fetch('http://127.0.0.1:3201/api/health');
    const cookie = r.headers.get('set-cookie')?.split(';')[0];
    assert(cookie, 'The API must issue a session cookie.');
    return cookie;
  }
  async function call(cookie: string, path: string, body: unknown, i = 0) {
    return fetch(`http://127.0.0.1:${3201 + (i % 2)}/api${path}`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }
  async function phase(
    name: string,
    tasks: (() => Promise<Response>)[],
    assert: (responses: Response[], bodies: unknown[]) => boolean,
  ) {
    const times: number[] = [],
      statuses: Record<string, number> = {};
    const start = performance.now();
    const responses = await Promise.all(
      tasks.map(async (task) => {
        const at = performance.now();
        const r = await task();
        const body = await r.json();
        times.push(performance.now() - at);
        statuses[r.status] = (statuses[r.status] || 0) + 1;
        return { r, body };
      }),
    );
    const duration = performance.now() - start;
    times.sort((a, b) => a - b);
    const passed = assert(
      responses.map((x) => x.r),
      responses.map((x) => x.body),
    );
    results.push({
      name,
      requests: tasks.length,
      concurrency: tasks.length,
      durationMs: +duration.toFixed(2),
      p50Ms: percentile(times, 0.5),
      p95Ms: percentile(times, 0.95),
      p99Ms: percentile(times, 0.99),
      statuses,
      passed,
    });
  }
  const clients = await Promise.all(Array.from({ length: 25 }, () => client()));
  function clientAt(index: number) {
    const cookie = clients[index];
    assert(cookie, 'Expected a benchmark client for each request.');
    return cookie;
  }
  for (const cookie of clients) {
    const r = await call(cookie, '/queue', {});
    if (!(await r.json()).admitted) throw new Error('Expected admission.');
  }
  await phase(
    'Last-seat contention',
    Array.from(
      { length: 100 },
      (_, i) => () =>
        call(clientAt(i % 25), '/reservations', { seatIds: ['A1'], key: crypto.randomUUID() }, i),
    ),
    (r) =>
      r.filter((x) => x.status === 201).length === 1 &&
      r.every((x) => [201, 409, 503].includes(x.status)),
  );
  const key = crypto.randomUUID(),
    original = await (await call(clientAt(0), '/reservations', { seatIds: ['B1'], key })).json();
  await phase(
    'Idempotent replay across replicas',
    Array.from(
      { length: 40 },
      (_, i) => () => call(clientAt(0), '/reservations', { seatIds: ['B1'], key }, i),
    ),
    (r, b) =>
      r.every((x) => x.status === 200) && b.every((x) => orderPayload.parse(x).id === original.id),
  );
  const orders: { id: string }[] = [];
  for (let i = 0; i < 12; i++)
    orders.push(
      await (
        await call(clientAt(i), '/reservations', {
          seatIds: [i < 10 ? `C${i + 1}` : `D${i - 9}`],
          key: crypto.randomUUID(),
        })
      ).json(),
    );
  await phase(
    'Duplicate checkout',
    Array.from({ length: 24 }, (_, i) => () => {
      const order = orders[i % 12];
      assert(order, 'Expected a reserved order before checkout.');
      return call(clientAt(i % 12), `/orders/${order.id}/pay`, {}, i);
    }),
    (r, b) =>
      r.every((x) => x.status === 200) &&
      b.every((x) => orderPayload.parse(x).status === 'confirmed') &&
      new Set(b.map((x) => orderPayload.parse(x).id)).size === 12,
  );
  let delivered = 0;
  for (let i = 0; i < 10; i++) {
    const count = await drainOutbox();
    delivered += count;
    if (!count) break;
  }
  const snapshotPayload = z.object({ consistent: z.boolean(), orders: z.array(orderPayload) });
  const snapshot = snapshotPayload.parse(
    await (
      await fetch('http://127.0.0.1:3201/api/snapshot', { headers: { 'x-admin-token': secret } })
    ).json(),
  );
  const passed = results.every((r) => r.passed) && snapshot.consistent && delivered === 12;
  const report = {
    generatedAt: new Date().toISOString(),
    scope:
      'Local HTTP benchmark: two Bun API processes, PostgreSQL and Redis; direct round-robin requests, no TLS or proxy. Isolated fixture, not a production capacity claim.',
    environment: {
      bun: Bun.version,
      os: platform(),
      arch: arch(),
      cpu: cpus()[0]?.model,
      logicalCpus: cpus().length,
      memoryGiB: +(totalmem() / 2 ** 30).toFixed(1),
      apiReplicas: 2,
      database: 'PostgreSQL 18',
      redis: 'Redis 8',
    },
    results,
    invariants: {
      consistent: snapshot.consistent,
      confirmedOrders: new Set(
        snapshot.orders.filter((o) => o.status === 'confirmed').map((o) => o.id),
      ).size,
      deliveredEvents: delivered,
    },
    passed,
  };
  await Bun.write('docs/benchmarks/latest.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  if (!passed) process.exitCode = 1;
} finally {
  for (const p of processes) p.kill('SIGTERM');
  await Promise.all(processes.map((p) => p.exited));
  redis.disconnect();
  await sql.end();
}
