import { app } from './app';
import { sql, redis, connectRedis } from './db';
import { startEvents } from './events';

await connectRedis().catch(() => {});
const stopEvents = await startEvents();
const server = Bun.serve({
  port: Number(process.env.PORT || 3001),
  hostname: process.env.HOST || '127.0.0.1',
  fetch: app.fetch,
  idleTimeout: 30,
});
console.log(`Rush API listening on ${server.url}`);
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  await Promise.race([server.stop(), Bun.sleep(1000)]);
  await server.stop(true);
  await stopEvents();
  await sql.end();
  redis.disconnect();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
