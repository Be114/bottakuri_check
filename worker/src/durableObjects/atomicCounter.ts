interface StoredCounter {
  value: number;
  expiresAt: number;
}

type CounterRequest =
  | { operation: 'increment'; expirationTtl: number }
  | { operation: 'incrementIfBelow'; limit: number; expirationTtl: number }
  | { operation: 'read' };

interface CounterResponse {
  value: number;
  allowed?: boolean;
}

const COUNTER_STORAGE_KEY = 'counter';

export class AtomicCounter {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method Not Allowed' }, 405);
    }

    const command = await readCounterRequest(request);
    if (!command) {
      return jsonResponse({ error: 'Invalid counter command' }, 400);
    }

    if (command.operation === 'read') {
      return jsonResponse({ value: await this.read() });
    }

    if (command.operation === 'increment') {
      return jsonResponse(await this.increment(command.expirationTtl));
    }

    return jsonResponse(await this.incrementIfBelow(command.limit, command.expirationTtl));
  }

  async alarm(): Promise<void> {
    await this.deleteIfExpired(Date.now());
  }

  private async read(): Promise<number> {
    return this.state.storage.transaction(async (txn) => {
      const current = await readActiveCounter(txn, Date.now());
      return current.value;
    });
  }

  private async increment(expirationTtl: number): Promise<CounterResponse> {
    return this.state.storage.transaction(async (txn) => {
      const now = Date.now();
      const current = await readActiveCounter(txn, now);
      const nextValue = current.value + 1;
      await writeCounter(txn, nextValue, now, expirationTtl);
      return { value: nextValue };
    });
  }

  private async incrementIfBelow(limit: number, expirationTtl: number): Promise<CounterResponse> {
    return this.state.storage.transaction(async (txn) => {
      const now = Date.now();
      const current = await readActiveCounter(txn, now);
      if (current.value >= limit) {
        return { value: current.value, allowed: false };
      }

      const nextValue = current.value + 1;
      await writeCounter(txn, nextValue, now, expirationTtl);
      return { value: nextValue, allowed: true };
    });
  }

  private async deleteIfExpired(now: number): Promise<void> {
    await this.state.storage.transaction(async (txn) => {
      const current = await txn.get<StoredCounter>(COUNTER_STORAGE_KEY);
      if (!current || current.expiresAt > now) return;
      await txn.delete(COUNTER_STORAGE_KEY);
    });
  }
}

async function readCounterRequest(request: Request): Promise<CounterRequest | null> {
  const body = (await request.json().catch(() => null)) as Partial<CounterRequest> | null;
  if (!body || typeof body !== 'object') return null;

  if (body.operation === 'read') return { operation: 'read' };

  if (body.operation === 'increment') {
    const expirationTtl = normalizeTtl(body.expirationTtl);
    if (expirationTtl === null) return null;
    return { operation: 'increment', expirationTtl };
  }

  if (body.operation === 'incrementIfBelow') {
    const expirationTtl = normalizeTtl(body.expirationTtl);
    const limit = body.limit;
    if (expirationTtl === null || typeof limit !== 'number' || !Number.isFinite(limit) || limit < 0) return null;
    return {
      operation: 'incrementIfBelow',
      limit: Math.floor(limit),
      expirationTtl,
    };
  }

  return null;
}

async function readActiveCounter(txn: DurableObjectTransaction, now: number): Promise<StoredCounter> {
  const current = await txn.get<StoredCounter>(COUNTER_STORAGE_KEY);
  if (!current || current.expiresAt <= now) {
    if (current) {
      await txn.delete(COUNTER_STORAGE_KEY);
    }
    return { value: 0, expiresAt: now };
  }
  return current;
}

async function writeCounter(
  txn: DurableObjectTransaction,
  value: number,
  now: number,
  expirationTtl: number,
): Promise<void> {
  const expiresAt = now + expirationTtl * 1000;
  await txn.put<StoredCounter>(COUNTER_STORAGE_KEY, { value, expiresAt });
  await txn.setAlarm(expiresAt + 1000);
}

function normalizeTtl(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return Math.floor(value);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
