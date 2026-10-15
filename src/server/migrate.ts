import { readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { sql } from './db';
const directory = new URL('./migrations/', import.meta.url);
try {
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended('rush:migrations',0))`;
    await tx`CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())`;
    for (const name of (await readdir(directory)).filter((n) => n.endsWith('.sql')).sort()) {
      const source = await Bun.file(new URL(name, directory)).text();
      const checksum = createHash('sha256').update(source).digest('hex');
      const [prior] = await tx`SELECT checksum FROM schema_migrations WHERE name=${name}`;
      if (prior) {
        if (prior.checksum !== checksum) throw new Error(`Applied migration changed: ${name}`);
        continue;
      }
      await tx.unsafe(source);
      await tx`INSERT INTO schema_migrations(name,checksum) VALUES(${name},${checksum})`;
      console.log(`Applied ${name}`);
    }
  });
  console.log('Database migrations verified.');
} finally {
  await sql.end();
}
