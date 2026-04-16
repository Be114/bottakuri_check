import { ONE_WEEK_SECONDS } from '../constants';
import { Env } from '../types';
import { toNonNegativeInt } from '../utils/validation';

export type MetricName =
  | 'requests'
  | 'cache_hits'
  | 'new_analysis'
  | 'rate_limited'
  | 'budget_exceeded'
  | 'error_count';

export async function allowWithinLimit(env: Env, key: string, limit: number, expirationTtl: number): Promise<boolean> {
  const result = await counterCommand<{ allowed: boolean; value: number }>(env, key, {
    operation: 'incrementIfBelow',
    limit,
    expirationTtl,
  });
  return result.allowed;
}

export async function reserveBudgetSlot(
  env: Env,
  key: string,
  dailyCap: number,
  expirationTtl: number,
): Promise<boolean> {
  return allowWithinLimit(env, key, dailyCap, expirationTtl);
}

export function computeGlobalDailyCap(dailyBudgetRaw: string | undefined, worstCaseRaw: string | undefined): number {
  const dailyBudget = Number(dailyBudgetRaw ?? '5');
  const worstCase = Number(worstCaseRaw ?? '0.25');
  if (!Number.isFinite(dailyBudget) || dailyBudget <= 0) return 1;
  if (!Number.isFinite(worstCase) || worstCase <= 0) return 1;
  return Math.max(1, Math.floor(dailyBudget / worstCase));
}

export async function incrementMetric(env: Env, key: string): Promise<void> {
  await counterCommand<{ value: number }>(env, key, {
    operation: 'increment',
    expirationTtl: ONE_WEEK_SECONDS,
  });
}

export function metricKey(metric: MetricName, day: string): string {
  return `metric:${day}:${metric}`;
}

export async function readMetrics(
  env: Env,
  day: string,
): Promise<{
  requests: number;
  cacheHits: number;
  newAnalysisCount: number;
  rateLimitedCount: number;
  budgetExceededCount: number;
  errorCount: number;
}> {
  const [requestsRaw, cacheHitsRaw, newAnalysisRaw, rateLimitedRaw, budgetExceededRaw, errorCountRaw] =
    await Promise.all([
      readCounter(env, metricKey('requests', day)),
      readCounter(env, metricKey('cache_hits', day)),
      readCounter(env, metricKey('new_analysis', day)),
      readCounter(env, metricKey('rate_limited', day)),
      readCounter(env, metricKey('budget_exceeded', day)),
      readCounter(env, metricKey('error_count', day)),
    ]);

  return {
    requests: requestsRaw,
    cacheHits: cacheHitsRaw,
    newAnalysisCount: newAnalysisRaw,
    rateLimitedCount: rateLimitedRaw,
    budgetExceededCount: budgetExceededRaw,
    errorCount: errorCountRaw,
  };
}

async function readCounter(env: Env, key: string): Promise<number> {
  const result = await counterCommand<{ value: number }>(env, key, { operation: 'read' });
  return toNonNegativeInt(String(result.value), 0);
}

async function counterCommand<T>(env: Env, key: string, command: Record<string, unknown>): Promise<T> {
  const id = env.COUNTERS.idFromName(key);
  const stub = env.COUNTERS.get(id);
  const response = await stub.fetch('https://counter.internal/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });

  if (!response.ok) {
    throw new Error(`Counter command failed: ${response.status}`);
  }

  return (await response.json()) as T;
}
