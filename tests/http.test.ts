import assert from 'node:assert/strict';
import { describe, expect, test } from 'bun:test';
import { admissionSchema, okSchema, orderSchema } from '../src/shared/model';
import { createRequest, HttpError } from '../src/web/http';

async function failure(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    assert(error instanceof HttpError);
    return error;
  }
  throw new Error('Expected an HTTP failure.');
}
describe('browser HTTP boundary', () => {
  test('validates successful responses and omits credentials and body when absent', async () => {
    const request = createRequest(
      () => '',
      async (url, init) => {
        expect(url).toBe('/api/queue');
        expect(init.method).toBe('GET');
        expect(init.credentials).toBe('same-origin');
        expect(init.signal).toBeInstanceOf(AbortSignal);
        expect(init.headers).not.toHaveProperty('X-Admin-Token');
        expect(init).not.toHaveProperty('body');
        return Response.json({ admitted: true, position: 0, futureField: 'compatible' });
      },
    );
    expect(await request('/queue', admissionSchema)).toEqual({ admitted: true, position: 0 });
  });
  test('sends the supplied request key unchanged with the current operator token', async () => {
    const key = crypto.randomUUID();
    const request = createRequest(
      () => 'operator',
      async (_url, init) => {
        expect(init.method).toBe('POST');
        expect(init.headers).toHaveProperty('X-Admin-Token', 'operator');
        assert(typeof init.body === 'string');
        expect(JSON.parse(init.body)).toEqual({ seatIds: ['A1'], key });
        return Response.json({ ok: true });
      },
    );
    await request('/reservations', okSchema, { seatIds: ['A1'], key });
    await request('/reservations', okSchema, { seatIds: ['A1'], key });
  });
  test('rejects a 200 response whose payload violates the contract', async () => {
    const request = createRequest(
      () => '',
      async () => Response.json({ id: 'incomplete' }),
    );
    const error = await failure(request('/reservations', orderSchema));
    expect(error.status).toBe(200);
    expect(error.message).toContain('invalid response');
  });
  test('handles malformed JSON without leaking parser details', async () => {
    const request = createRequest(
      () => '',
      async () => new Response('<html>upstream unavailable</html>', { status: 502 }),
    );
    const error = await failure(request('/snapshot', okSchema));
    expect(error.status).toBe(502);
    expect(error.message).toContain('invalid response');
    expect(error.message).not.toContain('<html>');
  });
  test('preserves application rejection status and a safe fallback for other error shapes', async () => {
    const conflict = createRequest(
      () => '',
      async () => Response.json({ error: 'Seat already reserved.' }, { status: 409 }),
    );
    const error = await failure(conflict('/reservations', orderSchema, {}));
    expect(error.status).toBe(409);
    expect(error.message).toBe('Seat already reserved.');
    const invalid = createRequest(
      () => '',
      async () => Response.json({ error: { secret: 'internal' } }, { status: 503 }),
    );
    expect((await failure(invalid('/snapshot', okSchema))).message).toBe(
      'Request failed. Please try again.',
    );
  });
  test('distinguishes deadlines from connection failures', async () => {
    const timeout = createRequest(
      () => '',
      async () => {
        throw new DOMException('deadline', 'TimeoutError');
      },
    );
    const network = createRequest(
      () => '',
      async () => {
        throw new TypeError('fetch failed');
      },
    );
    expect((await failure(timeout('/snapshot', okSchema))).message).toContain('same request key');
    const error = await failure(network('/snapshot', okSchema));
    expect(error.status).toBe(0);
    expect(error.message).toContain('Cannot reach Rush');
  });
});
