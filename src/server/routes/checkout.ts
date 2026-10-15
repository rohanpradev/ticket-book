import { Hono } from 'hono';

import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { createHmac } from 'node:crypto';
import { sql } from '../db';
import { DomainError, reserve, payment, normalizeOrder, replayReservation } from '../service';
import { joinQueue, checkAdmission, releaseAdmission, rateLimit } from '../queue';
import { metrics } from '../telemetry';

import type { AppEnv } from '../context';
import { equal } from '../auth';

export const checkoutRoutes = new Hono<AppEnv>();
const orderInput = z.object({
  seatIds: z
    .array(z.string().regex(/^[A-J](10|[1-9])$/))
    .min(1)
    .max(4)
    .refine((a) => new Set(a).size === a.length),
  key: z.string().uuid(),
});
checkoutRoutes.post('/queue', async (c) => {
  await rateLimit(c.get('sessionId'));
  return c.json(await joinQueue(c.get('sessionId')));
});
checkoutRoutes.post('/reservations', zValidator('json', orderInput), async (c) => {
  const body = c.req.valid('json');
  const prior = await replayReservation(c.get('sessionId'), body.seatIds, body.key);
  if (prior) {
    metrics.duplicates++;
    return c.json(normalizeOrder(prior), 200);
  }
  await checkAdmission(c.get('sessionId'));
  await rateLimit(c.get('sessionId'));
  const o = await reserve(c.get('sessionId'), body.seatIds, body.key);
  if (o.replayed) metrics.duplicates++;
  return c.json(normalizeOrder(o), o.replayed ? 200 : 201);
});
checkoutRoutes.post('/orders/:id/pay', async (c) => {
  const [o] = await sql`SELECT session_id,status FROM orders WHERE id=${c.req.param('id')}`;
  if (!o || o.session_id !== c.get('sessionId')) throw new DomainError('Order not found.', 404);
  if (o.status === 'confirmed') metrics.duplicates++;
  const result = await payment(c.req.param('id'), `sandbox:${c.req.param('id')}`, c.get('traceId'));
  await releaseAdmission(c.get('sessionId'));
  return c.json(normalizeOrder(result));
});
checkoutRoutes.post('/webhooks/payment', async (c) => {
  const secret = process.env.PAYMENT_WEBHOOK_SECRET;
  if (!secret) return c.json({ error: 'Webhook not configured.' }, 503);
  const timestamp = c.req.header('x-payment-timestamp') || '';
  const signature = c.req.header('x-payment-signature') || '';
  const raw = await c.req.text();
  if (
    !/^\d+$/.test(timestamp) ||
    Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 ||
    !equal(signature, createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex'))
  )
    return c.json({ error: 'Invalid webhook signature.' }, 401);
  const body = z
    .object({ orderId: z.string().uuid(), eventId: z.string().min(1).max(200) })
    .parse(JSON.parse(raw));
  return c.json(normalizeOrder(await payment(body.orderId, body.eventId, c.get('traceId'))));
});
