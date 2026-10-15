import { drainOutbox, sandboxSink } from '../../src/server/worker';
// Delivery has committed, but the queue acknowledgement is deliberately lost.
await drainOutbox(sandboxSink, async () => {
  process.exit(74);
});
throw new Error('Expected a pending event for the crash fixture.');
