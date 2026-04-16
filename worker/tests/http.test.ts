import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchJsonWithTimeout, fetchWithTimeout } from '../src/utils/http';

describe('HTTP timeout utilities', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('keeps timeout protection active while consuming the response body', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: true,
            json: () =>
              new Promise((resolve) => {
                setTimeout(() => resolve({ status: 'late' }), 1000);
              }),
          }) as unknown as Response,
      ),
    );

    const result = fetchJsonWithTimeout<{ status: string }>(
      'https://example.com/slow-json',
      {},
      {
        timeoutMs: 50,
        onTimeout: () => new Error('request timed out'),
      },
    );
    const expectation = expect(result).rejects.toThrow('request timed out');

    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(50);

    await expectation;
  });

  it('propagates caller initiated aborts instead of waiting for the timeout', async () => {
    const callerController = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            const signal = init?.signal;
            if (signal?.aborted) {
              reject(new DOMException('Aborted', 'AbortError'));
              return;
            }
            signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
          }),
      ),
    );

    const result = fetchWithTimeout(
      'https://example.com/cancelled',
      { signal: callerController.signal },
      {
        timeoutMs: 10000,
        onTimeout: () => new Error('request timed out'),
        onError: () => new Error('request failed'),
        consume: async (response) => response,
      },
    );

    callerController.abort();

    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  });
});
