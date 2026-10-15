import { createRequest } from '../src/web/http';
import { snapshotSchema, orderSchema, admissionSchema } from '../src/shared/model';
import { telemetrySchema, outboxSchema } from '../src/shared/observability';
import assert from 'node:assert/strict';
import { expectRejection } from './helpers';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { makeSeats } from '../src/shared/model';
const testUrl =
  process.env.TEST_DATABASE_URL || 'postgres://rush:rush_local@127.0.0.1:54329/rush_test';
if (new URL(testUrl).pathname !== '/rush_test')
  throw new Error('Integration tests only run against the rush_test database.');
process.env.LOG_LEVEL = 'silent';
process.env.DATABASE_URL = testUrl;
process.env.REDIS_URL = process.env.TEST_REDIS_URL || 'redis://127.0.0.1:63799/1';
if (new URL(process.env.REDIS_URL).pathname !== '/1')
  throw new Error('Integration tests require isolated Redis database 1.');
const { sql, db, redis, connectRedis } = await import('../src/server/db');
const { seats } = await import('../src/server/schema');
const { reserve, payment, expireReservations } = await import('../src/server/service');
const { drainOutbox, sandboxSink } = await import('../src/server/worker');
const { joinQueue, queueKeys, releaseAdmission, rateLimit } = await import('../src/server/queue');
const secret = 'integration-only-secret-at-least-32-characters';
const env = {
  ...process.env,
  DATABASE_URL: testUrl,
  SESSION_SECRET: secret,
  ADMIN_TOKEN: secret,
  PAYMENT_WEBHOOK_SECRET: secret,
  LAB_ENABLED: 'true',
};
const servers: ReturnType<typeof Bun.spawn>[] = [];
async function client(port = 3101) {
  const url = `http://127.0.0.1:${port}`;
  const health = await fetch(url + '/api/health');
  const cookie = health.headers.get('set-cookie')?.split(';')[0];
  assert(cookie, 'The API must issue a session cookie.');
  return {
    cookie,
    call: async (path: string, body?: unknown, headers: Record<string, string> = {}) =>
      fetch(url + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { cookie, 'content-type': 'application/json', ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
  };
}
async function ready(port: number) {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return;
    } catch {}
    await Bun.sleep(100);
  }
  throw new Error('Test API did not start.');
}
beforeAll(async () => {
  const migrate = Bun.spawn(['bun', 'src/server/migrate.ts'], {
    env,
    stdout: 'ignore',
    stderr: 'inherit',
  });
  expect(await migrate.exited).toBe(0);
  await connectRedis();
  for (const port of [3101, 3102]) {
    servers.push(
      Bun.spawn(['bun', 'src/server/index.ts'], {
        env: { ...env, PORT: String(port) },
        stdout: 'ignore',
        stderr: 'inherit',
      }),
    );
    await ready(port);
  }
}, 20000);
beforeEach(async () => {
  await sql`TRUNCATE payment_events,outbox,deliveries,audits,seats,orders,admissions CASCADE`;
  await sql`UPDATE lab_flags SET worker_paused=false,redis_down=false WHERE id=true`;
  await db.insert(seats).values(makeSeats().map(({ expiresAt, bookingId, ...s }) => s));
  await redis.flushdb();
});
afterAll(async () => {
  for (const s of servers) s.kill();
  await Promise.all(servers.map((s) => s.exited));
  redis.disconnect();
  await sql.end();
});
describe('PostgreSQL + Redis integration', () => {
  test('real API responses satisfy shared browser contracts through the order lifecycle', async () => {
    const visitor = await client();
    const request = createRequest(
      () => secret,
      (path, init) => {
        const headers = new Headers(init.headers);
        headers.set('cookie', visitor.cookie);
        return fetch('http://127.0.0.1:3101' + path, { ...init, headers });
      },
    );
    const empty = await request('/snapshot', snapshotSchema);
    expect(empty.seats).toHaveLength(100);
    expect(empty.seats.every((seat) => !('bookingId' in seat) && !('expiresAt' in seat))).toBe(
      true,
    );
    expect((await request('/queue', admissionSchema, {})).admitted).toBe(true);
    const held = await request('/reservations', orderSchema, {
      seatIds: ['J10'],
      key: crypto.randomUUID(),
    });
    expect(held.status).toBe('held');
    const publicResponse = await visitor.call('/api/snapshot');
    expect(publicResponse.status).toBe(200);
    const publicSnapshot = snapshotSchema.parse(await publicResponse.json());
    expect(publicSnapshot.orders.map((order) => order.id)).toEqual([held.id]);
    expect(publicSnapshot.seats.find((seat) => seat.id === 'J10')?.bookingId).toBe(held.id);
    expect((await request(`/orders/${held.id}/pay`, orderSchema, {})).status).toBe('confirmed');
    expect((await request('/admin/outbox', outboxSchema)).jobs).toHaveLength(1);
    expect((await request('/admin/observability', telemetrySchema)).admission.capacity).toBe(25);
    await drainOutbox();
    const delivered = await request('/admin/outbox', outboxSchema);
    expect(delivered.jobs.every((job) => job.processed_at !== null)).toBe(true);
    expect((await request('/snapshot', snapshotSchema)).consistent).toBe(true);
  });
  test('100 concurrent buyers produce exactly one owner', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 100 }, () => reserve(crypto.randomUUID(), ['A1'], crypto.randomUUID())),
    );
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const [seat] = await sql`SELECT * FROM seats WHERE id='A1'`;
    assert(seat);
    expect(seat.status).toBe('held');
    const [count] = await sql`SELECT count(*)::int AS n FROM orders`;
    assert(count);
    expect(count.n).toBe(1);
  }, 10000);
  test('two API processes contend safely for the same seat', async () => {
    const first = await client(3101),
      second = await client(3102);
    expect((await first.call('/api/queue', {})).status).toBe(200);
    expect((await second.call('/api/queue', {})).status).toBe(200);
    const [a, b] = await Promise.all([
      first.call('/api/reservations', { seatIds: ['B1'], key: crypto.randomUUID() }),
      second.call('/api/reservations', { seatIds: ['B1'], key: crypto.randomUUID() }),
    ]);
    expect([a.status, b.status].sort((a, b) => a - b)).toEqual([201, 409]);
  });
  test('concurrent retries reuse one order and reject key reuse with changed input', async () => {
    const session = crypto.randomUUID(),
      key = crypto.randomUUID();
    const results = await Promise.all(
      Array.from({ length: 20 }, () => reserve(session, ['B2'], key)),
    );
    expect(new Set(results.map((o) => o.id)).size).toBe(1);
    await expectRejection(reserve(session, ['B3'], key), 'different selection');
  });
  test('overlapping groups cannot partially reserve or deadlock', async () => {
    const results = await Promise.allSettled([
      reserve('a', ['C1', 'C2'], crypto.randomUUID()),
      reserve('b', ['C2', 'C1'], crypto.randomUUID()),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const held = await sql`SELECT booking_id FROM seats WHERE id IN ('C1','C2')`;
    expect(new Set(held.map((s) => s.booking_id)).size).toBe(1);
  });
  test('duplicate payment events and separate success events emit one confirmation', async () => {
    const o = await reserve('buyer', ['D1'], crypto.randomUUID());
    await Promise.all(Array.from({ length: 12 }, (_, i) => payment(o.id, `event-${i % 4}`)));
    const [order] = await sql`SELECT status FROM orders WHERE id=${o.id}`;
    assert(order);
    const [events] = await sql`SELECT count(*)::int AS n FROM outbox WHERE order_id=${o.id}`;
    assert(events);
    expect(order.status).toBe('confirmed');
    expect(events.n).toBe(1);
  });
  test('late payment refunds without reclaiming a seat sold to another buyer', async () => {
    const old = await reserve('a', ['E1'], crypto.randomUUID());
    await sql`UPDATE orders SET expires_at=now()-interval '1 second' WHERE id=${old.id}`;
    await expireReservations();
    const current = await reserve('b', ['E1'], crypto.randomUUID());
    await payment(current.id, 'new-success');
    const late = await payment(old.id, 'late-success');
    expect(late.status).toBe('refund_pending');
    await drainOutbox();
    const [seat] = await sql`SELECT * FROM seats WHERE id='E1'`;
    assert(seat);
    expect(seat.booking_id).toBe(current.id);
    expect(seat.status).toBe('sold');
    const [refund] = await sql`SELECT status FROM orders WHERE id=${old.id}`;
    assert(refund);
    expect(refund.status).toBe('refunded');
  });
  test('worker resumes durable backlog and deduplicates its delivery sink', async () => {
    await sql`UPDATE lab_flags SET worker_paused=true`;
    const o = await reserve('a', ['F1'], crypto.randomUUID());
    await payment(o.id, 'success');
    expect(await drainOutbox()).toBe(0);
    await sql`UPDATE lab_flags SET worker_paused=false`;
    const counts = await Promise.all([drainOutbox(), drainOutbox()]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(1);
    await sql`UPDATE outbox SET processed_at=NULL`;
    await drainOutbox();
    const [d] = await sql`SELECT count(*)::int AS n FROM deliveries`;
    assert(d);
    expect(d.n).toBe(1);
  });
  test('atomic Redis admission admits only the configured capacity', async () => {
    const entries = await Promise.all(
      Array.from({ length: 40 }, () => joinQueue(crypto.randomUUID())),
    );
    expect(entries.filter((e) => e.admitted).length).toBe(25);
    expect(await redis.zcard(queueKeys.waiting)).toBe(15);
  });
  test('injected Redis outage pauses new admissions without losing reservations', async () => {
    const o = await reserve('a', ['G1'], crypto.randomUUID());
    await sql`UPDATE lab_flags SET redis_down=true`;
    await expectRejection(joinQueue('new-visitor'), 'Admissions paused');
    const paid = await payment(o.id, 'success');
    expect(paid.status).toBe('confirmed');
  });
  test('API validates input, requires admission, and protects operator routes', async () => {
    const c = await client();
    expect((await c.call('/api/admin/control', { action: 'worker' })).status).toBe(401);
    expect((await c.call('/api/reservations', { seatIds: ['A1'], key: 'invalid' })).status).toBe(
      400,
    );
    expect(
      (await c.call('/api/reservations', { seatIds: ['A1'], key: crypto.randomUUID() })).status,
    ).toBe(403);
    await c.call('/api/queue', {});
    expect(
      (await c.call('/api/reservations', { seatIds: ['A1', 'A1'], key: crypto.randomUUID() }))
        .status,
    ).toBe(400);
    expect((await c.call('/api/queue', {}, { origin: 'https://untrusted.example' })).status).toBe(
      403,
    );
  });
  test('one visitor cannot pay for or inspect another visitor’s order', async () => {
    const a = await client(),
      b = await client();
    expect((await a.call('/api/queue', {})).status).toBe(200);
    const order = await (
      await a.call('/api/reservations', { seatIds: ['H1'], key: crypto.randomUUID() })
    ).json();
    expect((await b.call(`/api/orders/${order.id}/pay`, {})).status).toBe(404);
    const snapshot = await (await b.call('/api/snapshot')).json();
    expect(order.id).toBeDefined();
    expect(snapshot.orders).toHaveLength(0);
    expect(snapshot.seats.find((s: { id: string }) => s.id === 'H1').bookingId).toBeUndefined();
  });
  test('webhook verifies signatures and rejects stale replay timestamps', async () => {
    const o = await reserve('a', ['I1'], crypto.randomUUID());
    const payload = { orderId: o.id, eventId: 'signed-event' },
      body = JSON.stringify(payload),
      timestamp = String(Math.floor(Date.now() / 1000));
    const c = await client();
    expect((await c.call('/api/webhooks/payment', payload)).status).toBe(401);
    const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
    expect(
      (
        await c.call('/api/webhooks/payment', payload, {
          'x-payment-timestamp': timestamp,
          'x-payment-signature': signature,
        })
      ).status,
    ).toBe(200);
    const stale = String(Number(timestamp) - 1000);
    const oldSignature = createHmac('sha256', secret).update(`${stale}.${body}`).digest('hex');
    expect(
      (
        await c.call('/api/webhooks/payment', payload, {
          'x-payment-timestamp': stale,
          'x-payment-signature': oldSignature,
        })
      ).status,
    ).toBe(401);
  });
  test('process death rolls back unacknowledged delivery and a new worker recovers', async () => {
    const o = await reserve('crash-buyer', ['J1'], crypto.randomUUID());
    await payment(o.id, 'crash-payment');
    const crashed = Bun.spawn(['bun', 'tests/fixtures/crash-worker.ts'], {
      env,
      stdout: 'ignore',
      stderr: 'inherit',
    });
    expect(await crashed.exited).toBe(73);
    const [before] = await sql`SELECT count(*)::int AS n FROM deliveries`;
    assert(before);
    expect(before.n).toBe(0);
    expect(await drainOutbox()).toBe(0); // Another worker cannot steal a live claim.
    await sql`UPDATE outbox SET lease_until=now()-interval '1 second'`;
    expect(await drainOutbox()).toBe(1);
    const [after] = await sql`SELECT count(*)::int AS n FROM deliveries`;
    assert(after);
    expect(after.n).toBe(1);
  });
  test('delivery errors back off, stop after five attempts, and support operator replay', async () => {
    const o = await reserve('retry-buyer', ['J2'], crypto.randomUUID());
    await payment(o.id, 'retry-payment');
    const fail = async () => {
      throw new Error('Injected provider failure');
    };
    for (let i = 0; i < 5; i++) {
      await sql`UPDATE outbox SET available_at=now() WHERE order_id=${o.id}`;
      expect(await drainOutbox(fail)).toBe(0);
    }
    const [failed] = await sql`SELECT * FROM outbox WHERE order_id=${o.id}`;
    assert(failed);
    expect(failed.failed).toBe(true);
    expect(failed.attempts).toBe(5);
    expect(failed.last_error).toBe('Injected provider failure');
    const operator = await client();
    const replay = await operator.call('/api/admin/outbox/retry', {}, { 'x-admin-token': secret });
    expect(replay.status).toBe(200);
    expect(await drainOutbox()).toBe(1);
    const snapshot = await (
      await operator.call('/api/snapshot', undefined, { 'x-admin-token': secret })
    ).json();
    expect(snapshot.consistent).toBe(true);
    expect(snapshot.failedDeliveries).toBe(0);
  });

  test('durable admission capacity survives complete Redis data loss', async () => {
    await Promise.all(Array.from({ length: 25 }, () => joinQueue(crypto.randomUUID())));
    await redis.flushdb();
    const newcomers = await Promise.all(
      Array.from({ length: 40 }, () => joinQueue(crypto.randomUUID())),
    );
    expect(newcomers.filter((x) => x.admitted)).toHaveLength(0);
    const [count] = await sql`SELECT count(*)::int AS n FROM admissions WHERE expires_at>now()`;
    assert(count);
    expect(count.n).toBe(25);
  });
  test('FIFO heartbeat cleanup allows progress past an abandoned waiter', async () => {
    const active = Array.from({ length: 25 }, () => crypto.randomUUID());
    for (const id of active) await joinQueue(id);
    const abandoned = crypto.randomUUID(),
      live = crypto.randomUUID();
    expect((await joinQueue(abandoned)).position).toBe(1);
    expect((await joinQueue(live)).position).toBe(2);
    const rank = await redis.zscore(queueKeys.waiting, live);
    await joinQueue(live);
    expect(await redis.zscore(queueKeys.waiting, live)).toBe(rank);
    await redis.zadd(queueKeys.heartbeats, 0, abandoned);
    const first = active[0];
    assert(first);
    await releaseAdmission(first);
    expect((await joinQueue(live)).admitted).toBe(true);
  });
  test('committed reservation replays after admission expiry and Redis outage', async () => {
    const c = await client();
    await c.call('/api/queue', {});
    const input = { seatIds: ['A4'], key: crypto.randomUUID() };
    const original = await (await c.call('/api/reservations', input)).json();
    await sql`DELETE FROM admissions`;
    await sql`UPDATE lab_flags SET redis_down=true`;
    const replay = await c.call('/api/reservations', input);
    expect(replay.status).toBe(200);
    expect((await replay.json()).id).toBe(original.id);
    expect((await c.call('/api/reservations', { ...input, seatIds: ['A5'] })).status).toBe(409);
    expect((await c.call('/api/reservations', { ...input, key: crypto.randomUUID() })).status).toBe(
      403,
    );
  });
  test('rate limiter consumes an atomic bounded token bucket', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 130 }, () => rateLimit('bucket-client')),
    );
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(120);
    expect(results.filter((x) => x.status === 'rejected')).toHaveLength(10);
  });
  test('delivery committed before crash is deduplicated after lease recovery', async () => {
    const o = await reserve('lost-ack', ['A6'], crypto.randomUUID());
    await payment(o.id, 'lost-ack-payment');
    const crashed = Bun.spawn(['bun', 'tests/fixtures/crash-after-delivery.ts'], {
      env,
      stdout: 'ignore',
      stderr: 'inherit',
    });
    expect(await crashed.exited).toBe(74);
    const [prior] = await sql`SELECT count(*)::int AS n FROM deliveries`;
    assert(prior);
    expect(prior.n).toBe(1);
    expect(await drainOutbox()).toBe(0);
    await sql`UPDATE outbox SET lease_until=now()-interval '1 second'`;
    expect(await drainOutbox()).toBe(1);
    const [after] = await sql`SELECT count(*)::int AS n FROM deliveries`;
    assert(after);
    expect(after.n).toBe(1);
  });
  test('stale worker acknowledgement cannot overwrite a newer claim', async () => {
    const o = await reserve('fenced', ['A7'], crypto.randomUUID());
    await payment(o.id, 'fenced-payment');
    const completed = await drainOutbox(async (job) => {
      await sql`UPDATE outbox SET claim_token='new-owner',lease_until=now()+interval '30 seconds' WHERE id=${job.id}`;
    });
    expect(completed).toBe(0);
    const [job] = await sql`SELECT processed_at,claim_token FROM outbox WHERE order_id=${o.id}`;
    assert(job);
    expect(job.processed_at).toBeNull();
    expect(job.claim_token).toBe('new-owner');
  });
  test('database lock timeout bounds contention and the pool recovers', async () => {
    let release!: () => void, locked!: () => void;
    const lockReady = new Promise<void>((r) => (locked = r)),
      gate = new Promise<void>((r) => (release = r));
    const holder = sql.begin(async (tx) => {
      await tx`SELECT id FROM seats WHERE id='A8' FOR UPDATE`;
      locked();
      await gate;
    });
    await lockReady;
    try {
      const c = await client();
      await c.call('/api/queue', {});
      const started = performance.now();
      const response = await c.call('/api/reservations', {
        seatIds: ['A8'],
        key: crypto.randomUUID(),
      });
      expect(response.status).toBe(503);
      expect(response.headers.get('retry-after')).toBe('1');
      expect(performance.now() - started).toBeLessThan(4000);
    } finally {
      release();
      await holder;
    }
    expect((await reserve('recovered', ['A8'], crypto.randomUUID())).id).toBeDefined();
  }, 6000);
  test('metrics use route templates and propagate trace context into durable jobs', async () => {
    const c = await client(),
      trace = '1234567890abcdef1234567890abcdef';
    await c.call('/api/queue', {});
    const o = await (
      await c.call('/api/reservations', { seatIds: ['A9'], key: crypto.randomUUID() })
    ).json();
    const paid = await c.call(
      `/api/orders/${o.id}/pay`,
      {},
      { traceparent: `00-${trace}-1234567890abcdef-01` },
    );
    expect(paid.headers.get('traceparent')).toContain(trace);
    const [job] = await sql`SELECT trace_id FROM outbox WHERE order_id=${o.id}`;
    assert(job);
    expect(job.trace_id).toBe(trace);
    const metrics = await (
      await c.call('/api/admin/metrics', undefined, { 'x-admin-token': secret })
    ).text();
    expect(metrics).toContain('route="/api/orders/:id/pay"');
    expect(metrics).not.toContain(o.id);
    expect(metrics).toContain('rush_http_request_duration_seconds_bucket');
    expect((await c.call('/api/admin/observability')).status).toBe(401);
  });
  test('database notifications invalidate live clients on another API replica', async () => {
    const response = await fetch('http://127.0.0.1:3102/api/events');
    assert(response.body, 'SSE must expose a readable body.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    try {
      const first = decoder.decode((await reader.read()).value);
      expect(first).toContain('event: invalidate');
      await reserve('push', ['A10'], crypto.randomUUID());
      const result = await Promise.race([
        reader.read(),
        Bun.sleep(2500).then(() => {
          throw new Error('No cross-process invalidation');
        }),
      ]);
      expect(decoder.decode(result.value)).toContain('event: invalidate');
    } finally {
      await reader.cancel();
    }
  }, 4000);
  test('HTTP delivery adapter reuses event keys and completes refund state', async () => {
    const effects = new Map<string, number>();
    const provider = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: async (request) => {
        const key = request.headers.get('idempotency-key');
        if (!key) return new Response('missing key', { status: 400 });
        const body = await request.json();
        expect(body.eventId).toBe(key);
        effects.set(key, 1);
        return Response.json({ ok: true });
      },
    });
    const oldUrl = process.env.DELIVERY_URL;
    process.env.DELIVERY_URL = String(provider.url);
    try {
      const order = await reserve('http-provider', ['B6'], crypto.randomUUID());
      await sql`UPDATE orders SET expires_at=now()-interval '1 second' WHERE id=${order.id}`;
      await payment(order.id, 'http-refund');
      expect(await drainOutbox()).toBe(1);
      await sql`UPDATE outbox SET processed_at=NULL,attempts=0 WHERE order_id=${order.id}`;
      expect(await drainOutbox()).toBe(1);
      expect(effects.size).toBe(1);
      const [refund] = await sql`SELECT status FROM orders WHERE id=${order.id}`;
      assert(refund);
      expect(refund.status).toBe('refunded');
    } finally {
      if (oldUrl) process.env.DELIVERY_URL = oldUrl;
      else delete process.env.DELIVERY_URL;
      await provider.stop(true);
    }
  });
  test('a slow sink holds no queue transaction and another worker makes progress', async () => {
    const first = await reserve('slow', ['B7'], crypto.randomUUID());
    await payment(first.id, 'slow-payment');
    let entered!: () => void, release!: () => void;
    const ready = new Promise<void>((r) => (entered = r)),
      gate = new Promise<void>((r) => (release = r));
    const slow = drainOutbox(async (job) => {
      entered();
      await gate;
      await sandboxSink(job);
    });
    await ready;
    try {
      const second = await reserve('fast', ['B8'], crypto.randomUUID());
      await payment(second.id, 'fast-payment');
      expect(await drainOutbox()).toBe(1);
      const [delivered] =
        await sql`SELECT count(*)::int AS n FROM deliveries WHERE order_id=${second.id}`;
      assert(delivered);
      expect(delivered.n).toBe(1);
    } finally {
      release();
      expect(await slow).toBe(1);
    }
  });
  test('migration checksums detect drift and repeated migration is safe', async () => {
    const [original] = await sql`SELECT name,checksum FROM schema_migrations ORDER BY name LIMIT 1`;
    assert(original);
    try {
      await sql`UPDATE schema_migrations SET checksum='fixture-drift' WHERE name=${original.name}`;
      const rejected = Bun.spawn(['bun', 'src/server/migrate.ts'], {
        env,
        stdout: 'ignore',
        stderr: 'ignore',
      });
      expect(await rejected.exited).toBe(1);
    } finally {
      await sql`UPDATE schema_migrations SET checksum=${original.checksum} WHERE name=${original.name}`;
    }
    const repeated = Bun.spawn(['bun', 'src/server/migrate.ts'], {
      env,
      stdout: 'ignore',
      stderr: 'inherit',
    });
    expect(await repeated.exited).toBe(0);
  });
  test('queue overflow cleanup never promotes an abandoned waiter', async () => {
    for (let i = 0; i < 24; i++) await joinQueue(crypto.randomUUID());
    await redis.del(queueKeys.waiting, queueKeys.heartbeats, queueKeys.sequence);
    const scores: string[] = [],
      heartbeats: string[] = [];
    for (let i = 1; i <= 1001; i++) {
      scores.push(String(i), `abandoned-${i}`);
      heartbeats.push('0', `abandoned-${i}`);
    }
    await redis.zadd(queueKeys.waiting, ...scores);
    await redis.zadd(queueKeys.heartbeats, ...heartbeats);
    await redis.set(queueKeys.sequence, '1001');
    const current = await joinQueue(crypto.randomUUID());
    expect(current.admitted).toBe(true);
    const [stale] =
      await sql`SELECT count(*)::int AS n FROM admissions WHERE session_id LIKE 'abandoned-%'`;
    assert(stale);
    expect(stale.n).toBe(0);
    const [active] = await sql`SELECT count(*)::int AS n FROM admissions WHERE expires_at>now()`;
    assert(active);
    expect(active.n).toBe(25);
  });
});
