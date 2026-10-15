import assert from 'node:assert/strict';
import { expectRejection } from './helpers';
import { describe, expect, test } from 'bun:test';
import { Bulkhead, CircuitBreaker } from '../src/server/resilience';
describe('bounded failure handling', () => {
  test('circuit opens, permits one recovery probe, and closes on success', async () => {
    let now = 0,
      calls = 0;
    const circuit = new CircuitBreaker(2, 100, () => now);
    const fail = async () => {
      calls++;
      throw new Error('offline');
    };
    await expectRejection(circuit.run(fail), 'offline');
    await expectRejection(circuit.run(fail), 'offline');
    await expectRejection(circuit.run(fail), 'circuit is open');
    expect(calls).toBe(2);
    now = 101;
    let release!: (v: string) => void;
    const pending = circuit.run(() => new Promise<string>((r) => (release = r)));
    await expectRejection(
      circuit.run(async () => 'other'),
      'circuit is open',
    );
    release('recovered');
    expect(await pending).toBe('recovered');
    expect(circuit.state).toBe('closed');
  });
  test('a stale successful operation cannot close a newer open circuit', async () => {
    const circuit = new CircuitBreaker(1, 100, () => 0);
    let finish!: (value: string) => void;
    const old = circuit.run(() => new Promise<string>((resolve) => (finish = resolve)));
    await expectRejection(
      circuit.run(async () => {
        throw new Error('offline');
      }),
      'offline',
    );
    finish('old success');
    await old;
    expect(circuit.state).toBe('open');
  });
  test('bulkhead rejects overflow and releases permits exactly once', () => {
    const lane = new Bulkhead(1),
      release = lane.acquire();
    assert(release);
    expect(lane.acquire()).toBeUndefined();
    expect(lane.rejected).toBe(1);
    release();
    release();
    expect(lane.active).toBe(0);
    expect(lane.acquire()).toBeDefined();
  });
});
