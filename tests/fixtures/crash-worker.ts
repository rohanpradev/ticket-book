import { drainOutbox } from '../../src/server/worker';
import { sql } from '../../src/server/db';
// Terminate inside the local delivery transaction: its effects must roll back.
await drainOutbox(async (job) => {
  await sql.begin(async (tx) => {
    await tx`INSERT INTO deliveries(id,order_id,kind) VALUES(${job.id},${job.order_id},${job.kind})`;
    process.exit(73);
  });
});
throw new Error('Expected a pending event for the crash fixture.');
