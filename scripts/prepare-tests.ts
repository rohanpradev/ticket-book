import postgres from 'postgres';
const url = new URL(process.env.DATABASE_URL || 'postgres://rush:rush_local@127.0.0.1:54329/rush');
url.pathname = '/postgres';
const admin = postgres(url.toString(), { max: 1 });
try {
  for (const name of ['rush_test', 'rush_benchmark']) {
    const [exists] = await admin`SELECT 1 FROM pg_database WHERE datname=${name}`;
    if (!exists) await admin.unsafe(`CREATE DATABASE ${name}`); // Constant names only.
  }
  console.log('Isolated test databases ready.');
} finally {
  await admin.end();
}
