import { ONE_WEEK_SECONDS } from '../constants';
import { Env } from '../types';
import { toPositiveInt } from '../utils/validation';

export type MetricName = 'requests' | 'cache_hits' | 'new_analysis' | 'rate_limited' | 'budget_exceeded' | 'error_count';

export async function allowWithinLimit(
  env: Env,
  key: string,
  limit: number,
  expirationTtl: number
): Promise<boolean> {
  const currentRaw = await env.APP_KV.get(key);
  const currentCount = toPositiveInt(currentRaw, 0);
  if (currentCount >= limit) return false;
  await env.APP_KV.put(key, String(currentCount + 1), { expirationTtl });
  return true;
}

export async function reserveBudgetSlot(
  env: Env,
  key: string,
  dailyCap: number,
  expirationTtl: number
): Promise<boolean> {
  const currentRaw = await env.APP_KV.get(key);
  const currentCount = toPositiveInt(currentRaw, 0);
  if (currentCount >= dailyCap) return false;
  await env.APP_KV.put(key, String(currentCount + 1), { expirationTtl });
  return true;
}

export function computeGlobalDailyCap(dailyBudgetRaw: string | undefined, worstCaseRaw: string | undefined): number {
  const dailyBudget = Number(dailyBudgetRaw ?? '5');
  const worstCase = Number(worstCaseRaw ?? '0.25');
  if (!Number.isFinite(dailyBudget) || dailyBudget <= 0) return 1;
  if (!Number.isFinite(worstCase) || worstCase <= 0) return 1;
  return Math.max(1, Math.floor(dailyBudget / worstCase));
}

export async function incrementMetric(env: Env, key: string): Promise<void> {
  const currentRaw = await env.APP_KV.get(key);
  const currentCount = toPositiveInt(currentRaw, 0);
  await env.APP_KV.put(key, String(currentCount + 1), { expirationTtl: ONE_WEEK_SECONDS });
}

export function metricKey(metric: MetricName, day: string): string {
  return `metric:${day}:${metric}`;
}

export async function readMetrics(env: Env, day: string): Promise<{
  requests: number;
  cacheHits: number;
  newAnalysisCount: number;
  rateLimitedCount: number;
  budgetExceededCount: number;
  errorCount: number;
}> {
  const [requestsRaw, cacheHitsRaw, newAnalysisRaw, rateLimitedRaw, budgetExceededRaw, errorCountRaw] =
    await Promise.all([
      env.APP_KV.get(metricKey('requests', day)),
      env.APP_KV.get(metricKey('cache_hits', day)),
      env.APP_KV.get(metricKey('new_analysis', day)),
      env.APP_KV.get(metricKey('rate_limited', day)),
      env.APP_KV.get(metricKey('budget_exceeded', day)),
      env.APP_KV.get(metricKey('error_count', day)),
    ]);

  return {
    requests: toPositiveInt(requestsRaw, 0),
    cacheHits: toPositiveInt(cacheHitsRaw, 0),
    newAnalysisCount: toPositiveInt(newAnalysisRaw, 0),
    rateLimitedCount: toPositiveInt(rateLimitedRaw, 0),
    budgetExceededCount: toPositiveInt(budgetExceededRaw, 0),
    errorCount: toPositiveInt(errorCountRaw, 0),
  };
}
