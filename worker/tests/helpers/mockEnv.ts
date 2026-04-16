import { Env } from '../../src/types';
import { AtomicCounter } from '../../src/durableObjects/atomicCounter';

export class MemoryKV {
  private readonly store = new Map<string, string>();

  constructor(seed?: Record<string, string>) {
    if (seed) {
      for (const [key, value] of Object.entries(seed)) {
        this.store.set(key, value);
      }
    }
  }

  seed(key: string, value: string): void {
    this.store.set(key, value);
  }

  async get(key: string, type?: 'text' | 'json'): Promise<string | unknown | null> {
    const value = this.store.get(key);
    if (value === undefined) return null;

    if (type === 'json') {
      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    }

    return value;
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
}

class MemoryDurableObjectId implements DurableObjectId {
  constructor(readonly name: string) {}

  toString(): string {
    return this.name;
  }

  equals(other: DurableObjectId): boolean {
    return other.toString() === this.name;
  }
}

class MemoryDurableObjectStorage {
  private readonly store = new Map<string, unknown>();
  private transactionQueue: Promise<void> = Promise.resolve();
  private alarmTime: number | null = null;

  async get<T = unknown>(key: string): Promise<T | undefined> {
    return this.store.get(key) as T | undefined;
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<boolean> {
    return this.store.delete(key);
  }

  async transaction<T>(closure: (txn: DurableObjectTransaction) => Promise<T>): Promise<T> {
    let release = () => {};
    const previous = this.transactionQueue;
    this.transactionQueue = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;

    const txn = {
      get: this.get.bind(this),
      put: this.put.bind(this),
      delete: this.delete.bind(this),
      setAlarm: async (scheduledTime: number | Date) => {
        this.alarmTime = scheduledTime instanceof Date ? scheduledTime.getTime() : scheduledTime;
      },
      getAlarm: async () => this.alarmTime,
      deleteAlarm: async () => {
        this.alarmTime = null;
      },
      rollback: () => {
        throw new Error('rollback is not implemented in MemoryDurableObjectStorage');
      },
    } as unknown as DurableObjectTransaction;

    try {
      return await closure(txn);
    } finally {
      release();
    }
  }
}

class MemoryDurableObjectState implements DurableObjectState {
  readonly props = {};

  constructor(
    readonly id: DurableObjectId,
    readonly storage: DurableObjectStorage,
  ) {}

  waitUntil(): void {}

  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T> {
    return callback();
  }

  acceptWebSocket(): void {}

  getWebSockets(): WebSocket[] {
    return [];
  }

  setWebSocketAutoResponse(): void {}

  getWebSocketAutoResponse(): WebSocketRequestResponsePair | null {
    return null;
  }

  getWebSocketAutoResponseTimestamp(): Date | null {
    return null;
  }

  setHibernatableWebSocketEventTimeout(): void {}

  getHibernatableWebSocketEventTimeout(): number | null {
    return null;
  }

  getTags(): string[] {
    return [];
  }

  abort(reason?: string): void {
    throw new Error(reason || 'Memory durable object aborted');
  }
}

export class MemoryCounterNamespace {
  private readonly counters = new Map<string, AtomicCounter>();

  idFromName(name: string): DurableObjectId {
    return new MemoryDurableObjectId(name);
  }

  get(id: DurableObjectId): DurableObjectStub {
    const name = id.toString();
    let counter = this.counters.get(name);
    if (!counter) {
      const state = new MemoryDurableObjectState(
        id,
        new MemoryDurableObjectStorage() as unknown as DurableObjectStorage,
      );
      counter = new AtomicCounter(state);
      this.counters.set(name, counter);
    }

    return {
      id,
      name,
      fetch: (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        return counter.fetch(request);
      },
    } as DurableObjectStub;
  }

  async seed(key: string, value: number, expirationTtl = 86400): Promise<void> {
    const stub = this.get(this.idFromName(key));
    await stub.fetch('https://counter.internal/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operation: 'increment', expirationTtl }),
    });

    for (let index = 1; index < value; index += 1) {
      await stub.fetch('https://counter.internal/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation: 'increment', expirationTtl }),
      });
    }
  }
}

export function createMockEnv(overrides: Partial<Env> = {}): {
  env: Env;
  kv: MemoryKV;
  counters: MemoryCounterNamespace;
} {
  const kv = new MemoryKV();
  const counters = new MemoryCounterNamespace();

  const env: Env = {
    APP_KV: kv as unknown as KVNamespace,
    COUNTERS: counters as unknown as DurableObjectNamespace,
    OPENROUTER_API_KEY: 'test-openrouter-key',
    GOOGLE_PLACES_API_KEY: 'test-google-places-key',
    ALLOWED_ORIGINS: 'http://localhost:3000',
    DAILY_BUDGET_USD: '5',
    WORST_CASE_COST_USD: '0.25',
    CACHE_TTL_SECONDS: '86400',
    PER_MINUTE_LIMIT: '5',
    PER_DAY_NEW_ANALYSIS_LIMIT: '20',
    OPENROUTER_MAX_TOKENS: '1400',
    REVIEW_SAMPLE_LIMIT: '8',
    DAY_ROLLOVER_TIMEZONE: 'Asia/Tokyo',
    OPENROUTER_SITE_URL: 'http://localhost:3000',
    OPENROUTER_APP_NAME: '飲食店サクラチェッカー',
    ...overrides,
  };

  return { env, kv, counters };
}
