const children = [
  Bun.spawn(['bun', '--watch', 'src/server/index.ts'], { stdout: 'inherit', stderr: 'inherit' }),
  Bun.spawn(['bun', '--watch', 'src/server/worker.ts'], { stdout: 'inherit', stderr: 'inherit' }),
  Bun.spawn(['bun', 'run', 'dev'], {
    env: { ...process.env, VITE_API_MODE: 'server' },
    stdout: 'inherit',
    stderr: 'inherit',
  }),
];
let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const c of children) c.kill('SIGTERM');
  await Promise.all(children.map((c) => c.exited));
  process.exit(code);
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
await Promise.race(
  children.map(async (c) => {
    const code = await c.exited;
    if (!stopping) await stop(code || 1);
  }),
);

export {};
