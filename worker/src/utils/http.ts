export async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  options: {
    timeoutMs: number;
    onTimeout: () => Error;
    onError?: (error: unknown) => Error;
  },
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, options.timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      throw options.onTimeout();
    }
    if (options.onError) {
      throw options.onError(error);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
