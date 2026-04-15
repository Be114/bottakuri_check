import { Env } from '../../src/types';

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

export function createMockEnv(overrides: Partial<Env> = {}): { env: Env; kv: MemoryKV } {
  const kv = new MemoryKV();

  const env: Env = {
    APP_KV: kv as unknown as KVNamespace,
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

  return { env, kv };
}
