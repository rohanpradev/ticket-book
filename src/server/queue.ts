import { connectRedis, redis, sql } from './db';
import { DomainError } from './service';
import { redisCircuit } from './telemetry';
export const ADMISSION_CAPACITY = 25;
export const queueKeys = {
  waiting: 'rush:{afterhours}:waiting',
  heartbeats: 'rush:{afterhours}:heartbeats',
  sequence: 'rush:{afterhours}:sequence',
};
// Redis TIME avoids API clock skew. Sequence scores preserve FIFO across same-millisecond joins.
const enqueueScript = `
local t=redis.call('TIME')
local now=tonumber(t[1])*1000+math.floor(tonumber(t[2])/1000)
local stale=redis.call('ZRANGEBYSCORE',KEYS[2],'-inf',now-30000,'LIMIT',0,1000)
for _,id in ipairs(stale) do redis.call('ZREM',KEYS[1],id); redis.call('ZREM',KEYS[2],id) end
if not redis.call('ZSCORE',KEYS[1],ARGV[1]) then
 if redis.call('ZCARD',KEYS[1])>=10000 then return -1 end
 redis.call('ZADD',KEYS[1],redis.call('INCR',KEYS[3]),ARGV[1])
end
redis.call('ZADD',KEYS[2],now,ARGV[1])
return redis.call('ZRANK',KEYS[1],ARGV[1])+1`;
// Validate every promotion candidate, including stale entries beyond the cleanup batch.
// The scan remains bounded, so an abandoned queue cannot monopolize Redis execution.
const promotionScript = `
local t=redis.call('TIME')
local cutoff=tonumber(t[1])*1000+math.floor(tonumber(t[2])/1000)-30000
local eligible={}
for _,id in ipairs(redis.call('ZRANGE',KEYS[1],0,127)) do
 local seen=tonumber(redis.call('ZSCORE',KEYS[2],id)) or 0
 if seen<=cutoff then
  redis.call('ZREM',KEYS[1],id); redis.call('ZREM',KEYS[2],id)
 else
  table.insert(eligible,id)
  if #eligible>=tonumber(ARGV[1]) then break end
 end
end
return eligible`;
async function cache<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await redisCircuit.run(async () => {
      await connectRedis();
      return fn();
    });
  } catch {
    throw new DomainError('Admissions temporarily paused. Please try again shortly.', 503);
  }
}
export async function joinQueue(sessionId: string) {
  const [existing] =
    await sql`SELECT session_id FROM admissions WHERE session_id=${sessionId} AND expires_at>now()`;
  if (existing) return { admitted: true, position: 0 };
  const [flags] = await sql`SELECT redis_down FROM lab_flags WHERE id=true`;
  if (flags?.redis_down)
    throw new DomainError('Admissions paused: Redis outage injected in the lab.', 503);
  const enqueued = await cache(() =>
    redis.eval(
      enqueueScript,
      3,
      queueKeys.waiting,
      queueKeys.heartbeats,
      queueKeys.sequence,
      sessionId,
    ),
  );
  if (Number(enqueued) === -1)
    throw new DomainError('Waiting room is at capacity. Please retry shortly.', 503);
  return sql.begin(async (tx) => {
    // The durable capacity decision is serialized across API replicas and Redis restarts.
    await tx`SELECT pg_advisory_xact_lock(hashtextextended('rush:admission:afterhours',0))`;
    await tx`DELETE FROM admissions WHERE expires_at<=now()`;
    const active = await tx`SELECT session_id FROM admissions`;
    if (active.some((a) => a.session_id === sessionId)) return { admitted: true, position: 0 };
    // Repairs a crash after PG commit and before Redis cleanup. At most 25 entries.
    const { position, promote } = await cache(async () => {
      if (active.length) {
        const sessions = active.map((a) => String(a.session_id));
        await redis.zrem(queueKeys.waiting, ...sessions);
        await redis.zrem(queueKeys.heartbeats, ...sessions);
      }
      const rank = await redis.zrank(queueKeys.waiting, sessionId);
      const free = ADMISSION_CAPACITY - active.length;
      return {
        position: rank === null ? -1 : rank + 1,
        promote:
          free > 0
            ? ((await redis.eval(
                promotionScript,
                2,
                queueKeys.waiting,
                queueKeys.heartbeats,
                free,
              )) as string[])
            : [],
      };
    });
    if (position < 0) throw new DomainError('Waiting-room lease expired. Join again.', 409);
    for (const session of promote)
      await tx`INSERT INTO admissions(session_id,expires_at) VALUES(${session},clock_timestamp()+interval '15 minutes') ON CONFLICT DO NOTHING`;
    // Promotions commit together. The next caller repairs Redis cleanup after a crash.
    return promote.includes(sessionId)
      ? { admitted: true, position: 0 }
      : { admitted: false, position: Math.max(1, position - promote.length) };
  });
}
export async function checkAdmission(sessionId: string) {
  const [a] =
    await sql`SELECT session_id FROM admissions WHERE session_id=${sessionId} AND expires_at>now()`;
  if (!a) throw new DomainError('Join the waiting room before reserving seats.', 403);
}
export async function releaseAdmission(sessionId: string) {
  await sql`DELETE FROM admissions WHERE session_id=${sessionId}`;
  try {
    await redis.zrem(queueKeys.waiting, sessionId);
    await redis.zrem(queueKeys.heartbeats, sessionId);
  } catch {
    /* Stale entries expire by heartbeat. */
  }
}
// Atomic token bucket; requests cannot double the quota at a fixed-window boundary.
const rateScript = `
local t=redis.call('TIME')
local now=tonumber(t[1])*1000+math.floor(tonumber(t[2])/1000)
local prior=redis.call('HMGET',KEYS[1],'tokens','at')
local tokens=math.min(tonumber(ARGV[1]),tonumber(prior[1]) or tonumber(ARGV[1]))
local at=tonumber(prior[2]) or now
tokens=math.min(tonumber(ARGV[1]),tokens+math.max(0,now-at)*tonumber(ARGV[2])/1000)
local allowed=0
if tokens>=1 then tokens=tokens-1; allowed=1 end
redis.call('HSET',KEYS[1],'tokens',tokens,'at',now)
redis.call('PEXPIRE',KEYS[1],120000)
return allowed`;
export async function rateLimit(sessionId: string) {
  const allowed = await cache(() =>
    redis.eval(rateScript, 1, `rush:{afterhours}:rate:${sessionId}`, 120, 2),
  );
  if (Number(allowed) !== 1) throw new DomainError('Too many requests. Please retry shortly.', 429);
}
