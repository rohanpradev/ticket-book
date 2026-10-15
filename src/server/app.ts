import { Hono } from 'hono';
import { getSignedCookie, setSignedCookie } from 'hono/cookie';
import { secureHeaders } from 'hono/secure-headers';
import { bodyLimit } from 'hono/body-limit';

import { serveStatic } from 'hono/bun';

import { z } from 'zod';

import { DomainError } from './service';

import { observe, log, bulkheads } from './telemetry';

import type { AppEnv } from './context';
import { admin, sessionSecret } from './auth';
import { healthRoutes } from './routes/health';
import { snapshotRoutes } from './routes/snapshot';
import { checkoutRoutes } from './routes/checkout';
import { eventsRoutes } from './routes/events';
import { operationsRoutes } from './routes/operations';

const app = new Hono<AppEnv>();
app.use('*', secureHeaders());
app.use('/api/*', async (c, next) => {
  const start = performance.now();
  const requestId = crypto.randomUUID();
  const parent = c.req.header('traceparent')?.match(/^00-([0-9a-f]{32})-([0-9a-f]{16})-0[01]$/);
  const parentTrace = parent?.[1],
    parentSpan = parent?.[2];
  const traceId =
    parentTrace && parentSpan && !/^0+$/.test(parentTrace) && !/^0+$/.test(parentSpan)
      ? parentTrace
      : crypto.randomUUID().replaceAll('-', '');
  c.set('requestId', requestId);
  c.set('traceId', traceId);
  c.header('X-Request-ID', requestId);
  c.header(
    'traceparent',
    `00-${traceId}-${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}-01`,
  );
  c.header('Cache-Control', 'no-store');
  try {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      const origin = c.req.header('origin');
      if (origin && origin !== new URL(c.req.url).origin && origin !== process.env.APP_ORIGIN)
        return c.json({ error: 'Origin not allowed.' }, 403);
      if (!c.req.header('content-type')?.includes('application/json'))
        return c.json({ error: 'JSON content type required.' }, 415);
    }
    await next();
  } finally {
    if (c.req.path !== '/api/events') {
      const sample = {
        requestId,
        traceId,
        route: c.req.routePath || 'unmatched',
        method: ['GET', 'POST', 'HEAD', 'OPTIONS'].includes(c.req.method) ? c.req.method : 'OTHER',
        status: c.res.status,
        durationMs: performance.now() - start,
        at: Date.now(),
      };
      observe(sample);
      log('info', 'http_request', sample);
    }
  }
});
app.use('/api/*', bodyLimit({ maxSize: 16 * 1024 }));
app.use('/api/*', async (c, next) => {
  if (c.req.path === '/api/events' || c.req.path === '/api/health/live') return next();
  const lane =
    c.req.path === '/api/reservations'
      ? bulkheads.reservations
      : c.req.path.includes('/pay') || c.req.path === '/api/webhooks/payment'
        ? bulkheads.payments
        : bulkheads.reads;
  const release = lane.acquire();
  if (!release) {
    c.header('Retry-After', '1');
    return c.json({ error: 'Service is busy. Retry with the same request key.' }, 503);
  }
  try {
    await next();
  } finally {
    release();
  }
});
app.use('/api/*', async (c, next) => {
  let sessionId = await getSignedCookie(c, sessionSecret, 'rush_session');
  if (!sessionId || !z.string().uuid().safeParse(sessionId).success) {
    sessionId = crypto.randomUUID();
    await setSignedCookie(c, 'rush_session', sessionId, sessionSecret, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 86400,
    });
  }
  c.set('sessionId', sessionId);
  await next();
});
app.use('/api/admin/*', async (c, next) => {
  if (!admin(c.req.header('x-admin-token') || ''))
    return c.json({ error: 'An operator token is required.' }, 401);
  await next();
});
app.route('/api', healthRoutes);
app.route('/api', snapshotRoutes);
app.route('/api', checkoutRoutes);
app.route('/api', eventsRoutes);
app.route('/api', operationsRoutes);
app.onError((e, c) => {
  if (e instanceof DomainError) {
    if ([429, 503].includes(e.status)) c.header('Retry-After', '2');
    return c.json({ error: e.message, requestId: c.get('requestId') }, e.status);
  }
  if (e instanceof z.ZodError || e instanceof SyntaxError)
    return c.json({ error: 'Invalid request body.' }, 400);
  const code =
    (e as { code?: string; cause?: { code?: string } }).code ||
    (e as { cause?: { code?: string } }).cause?.code;
  if (
    ['55P03', '57014', '40P01', '40001', 'CONNECTION_CLOSED', 'CONNECT_TIMEOUT'].includes(
      code || '',
    )
  ) {
    c.header('Retry-After', '1');
    return c.json(
      {
        error: 'Database is busy. Retry with the same request key.',
        requestId: c.get('requestId'),
      },
      503,
    );
  }
  log('error', 'request_failed', {
    requestId: c.get('requestId'),
    traceId: c.get('traceId'),
    message: e.message,
  });
  return c.json(
    {
      error: 'Something went wrong. Retry with the same request key.',
      requestId: c.get('requestId'),
    },
    500,
  );
});
app.all('/api/*', (c) => c.json({ error: 'Endpoint not found.' }, 404));
app.use('*', serveStatic({ root: './dist' }));
app.get('*', serveStatic({ path: './dist/index.html' }));
export { app };
