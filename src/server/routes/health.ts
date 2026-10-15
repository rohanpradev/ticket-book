import { Hono } from 'hono';

import { sql, redis, connectRedis } from '../db';

import type { AppEnv } from '../context';

export const healthRoutes = new Hono<AppEnv>();
healthRoutes.get('/health/live', (c) => c.json({ status: 'alive' }));
healthRoutes.get('/health/ready', async (c) => {
  await sql`SELECT 1`;
  return c.json({ status: 'ready', database: 'ready' });
});
healthRoutes.get('/health', async (c) => {
  await sql`SELECT 1`;
  let cache = 'unavailable';
  try {
    await connectRedis();
    cache = (await redis.ping()) === 'PONG' ? 'ready' : 'unavailable';
  } catch {}
  return c.json({
    database: 'ready',
    redis: cache,
    paymentProvider: 'sandbox',
    admissionPolicy: 'fail-closed',
    inventoryAuthority: 'PostgreSQL',
  });
});
