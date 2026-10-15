import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import Redis from 'ioredis';
import * as schema from './schema';
export const sql = postgres(
  process.env.DATABASE_URL || 'postgres://rush:rush_local@127.0.0.1:54329/rush',
  {
    max: 20,
    connect_timeout: 3,
    idle_timeout: 20,
    connection: {
      application_name: process.env.INSTANCE_ID || 'rush',
      statement_timeout: 5000,
      lock_timeout: 1500,
      idle_in_transaction_session_timeout: 10000,
    },
  },
);
export const db = drizzle(sql, { schema });
export const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:63799', {
  maxRetriesPerRequest: 1,
  connectTimeout: 600,
  commandTimeout: 600,
  lazyConnect: true,
  enableOfflineQueue: false,
});
redis.on('error', () => {});
export async function connectRedis() {
  if (redis.status === 'wait') await redis.connect();
}
