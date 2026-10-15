import assert from 'node:assert/strict';
import { expect } from 'bun:test';
/** Bun's rejection matcher typings differ from Promise matchers used by type-aware lint. */
export async function expectRejection(promise: Promise<unknown>, message: string) {
  let failure: unknown;
  try {
    await promise;
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(Error);
  assert(failure instanceof Error);
  expect(failure.message).toContain(message);
}
