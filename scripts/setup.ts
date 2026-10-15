import { existsSync } from 'node:fs';
if (!existsSync('.env')) {
  const token = () =>
    crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
  await Bun.write(
    '.env',
    `DATABASE_URL=postgres://rush:rush_local@127.0.0.1:54329/rush\nREDIS_URL=redis://127.0.0.1:63799\nPORT=3001\nSESSION_SECRET=${token()}\nADMIN_TOKEN=${token()}\nPAYMENT_WEBHOOK_SECRET=${token()}\nLAB_ENABLED=true\nVITE_API_MODE=server\nAPP_ORIGIN=http://127.0.0.1:5173\n`,
  );
  console.log('Created .env with unique local secrets. Existing data is preserved.');
} else console.log('Existing .env preserved.');
console.log(
  'Next: docker compose up -d --wait && bun run db:migrate && bun run db:seed && bun run dev:full',
);
