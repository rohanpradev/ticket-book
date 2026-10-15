import { sql } from './db';
import { log } from './telemetry';
const listeners = new Set<() => void>();
let revision = 0;
export function subscribe(listener: () => void) {
  if (listeners.size >= 200) return;
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function eventStatus() {
  return { connections: listeners.size, revision };
}
export async function startEvents() {
  const subscription = await sql.listen(
    'rush_changes',
    () => {
      revision++;
      for (const listener of listeners) listener();
    },
    () => {
      for (const listener of listeners) listener();
    },
  );
  log('info', 'change_listener_ready');
  return () => subscription.unlisten();
}
