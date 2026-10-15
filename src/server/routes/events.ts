import { Hono } from 'hono';

import { streamSSE } from 'hono/streaming';

import { subscribe, eventStatus } from '../events';
import type { AppEnv } from '../context';

export const eventsRoutes = new Hono<AppEnv>();
eventsRoutes.get('/events', (c) => {
  let dirty = true;
  const unsubscribe = subscribe(() => {
    dirty = true;
  });
  if (!unsubscribe) {
    c.header('Retry-After', '5');
    return c.json({ error: 'Live connection capacity reached. Snapshots remain available.' }, 503);
  }
  return streamSSE(c, async (stream) => {
    let aborted = false,
      ticks = 0;
    stream.onAbort(() => {
      aborted = true;
      unsubscribe();
    });
    try {
      while (!aborted) {
        if (dirty) {
          dirty = false;
          await stream.writeSSE({
            event: 'invalidate',
            data: 'refresh',
            id: String(eventStatus().revision),
          });
        } else if (++ticks % 80 === 0) await stream.writeSSE({ event: 'heartbeat', data: 'alive' });
        await stream.sleep(250);
      }
    } finally {
      unsubscribe();
    }
  });
});
