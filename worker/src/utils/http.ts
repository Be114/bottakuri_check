interface TimeoutOptions {
  timeoutMs: number;
  onTimeout: () => Error;
  onError?: (error: unknown) => Error;
}

export async function fetchJsonWithTimeout<T>(
  input: string,
  init: RequestInit,
  options: TimeoutOptions,
): Promise<{ response: Response; json: T | null }> {
  return fetchWithTimeout(input, init, {
    ...options,
    consume: async (response) => ({
      response,
      json: response.ok ? ((await response.json()) as T) : null,
    }),
  });
}

export async function fetchWithTimeout<T>(
  input: string,
  init: RequestInit,
  options: TimeoutOptions & {
    consume: (response: Response) => Promise<T>;
  },
): Promise<T> {
  const timeoutController = new AbortController();
  let timedOut = false;
  let timeoutError: Error | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      timeoutError = options.onTimeout();
      timeoutController.abort(timeoutError);
      reject(timeoutError);
    }, options.timeoutMs);
  });
  const combinedSignal = createCombinedSignal(init.signal, timeoutController.signal);
  const operation = async () => {
    const response = await fetch(input, {
      ...init,
      signal: combinedSignal.signal,
    });
    return await options.consume(response);
  };

  try {
    return await Promise.race([operation(), timeoutPromise]);
  } catch (error) {
    if (timedOut) {
      throw timeoutError || options.onTimeout();
    }
    if (isCallerAbort(error, init.signal)) {
      throw error;
    }
    if (options.onError) {
      throw options.onError(error);
    }
    throw error;
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
    combinedSignal.cleanup();
  }
}

function createCombinedSignal(
  callerSignal: AbortSignal | null | undefined,
  timeoutSignal: AbortSignal,
): { signal: AbortSignal; cleanup: () => void } {
  if (!callerSignal) {
    return { signal: timeoutSignal, cleanup: () => {} };
  }
  if (callerSignal.aborted) {
    return { signal: callerSignal, cleanup: () => {} };
  }
  if (timeoutSignal.aborted) {
    return { signal: timeoutSignal, cleanup: () => {} };
  }

  const controller = new AbortController();
  const abortFromCaller = () => {
    controller.abort(callerSignal.reason);
  };
  const abortFromTimeout = () => {
    controller.abort(timeoutSignal.reason);
  };

  callerSignal.addEventListener('abort', abortFromCaller, { once: true });
  timeoutSignal.addEventListener('abort', abortFromTimeout, { once: true });

  return {
    signal: controller.signal,
    cleanup: () => {
      callerSignal.removeEventListener('abort', abortFromCaller);
      timeoutSignal.removeEventListener('abort', abortFromTimeout);
    },
  };
}

function isCallerAbort(error: unknown, callerSignal: AbortSignal | null | undefined): boolean {
  return Boolean(callerSignal?.aborted && error instanceof Error && error.name === 'AbortError');
}
