import type { z } from 'zod';

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
type Fetcher = (input: string, init: RequestInit) => Promise<Response>;
const invalidResponse = 'Rush returned an invalid response. Check the API connection and retry.';

/** Validate every success payload before it enters application state. */
export function createRequest(
  getToken: () => string,
  fetcher: Fetcher = (input, init) => fetch(input, init),
) {
  return async function request<T>(path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
    let response: Response;
    try {
      const token = getToken();
      response = await fetcher('/api' + path, {
        signal: AbortSignal.timeout(12000),
        method: body === undefined ? 'GET' : 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'X-Admin-Token': token } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      const timedOut =
        error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name);
      throw new HttpError(
        timedOut
          ? 'Rush took too long to respond. Retry with the same request key.'
          : 'Cannot reach Rush. Start the API and retry your connection.',
        0,
      );
    }
    const result: unknown = await response.json().catch(() => {
      throw new HttpError(invalidResponse, response.status);
    });
    if (!response.ok) {
      const message =
        result &&
        typeof result === 'object' &&
        'error' in result &&
        typeof result.error === 'string'
          ? result.error
          : 'Request failed. Please try again.';
      throw new HttpError(message, response.status);
    }
    const parsed = schema.safeParse(result);
    if (!parsed.success) throw new HttpError(invalidResponse, response.status);
    return parsed.data;
  };
}
