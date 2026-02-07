import { MODEL_ID, ONE_DAY_SECONDS } from '../constants';
import { computeGlobalDailyCap, readMetrics } from '../services/kvStore';
import { Env } from '../types';
import { buildJsonResponse } from '../utils/response';
import { formatDayInTimeZone, resolveDayRolloverTimezone } from '../utils/time';
import { resolveReviewSampleLimit, toPositiveInt } from '../utils/validation';

export async function handleHealth(env: Env, allowedOrigin: string | null): Promise<Response> {
  const dayRolloverTimezone = resolveDayRolloverTimezone(env.DAY_ROLLOVER_TIMEZONE);
  const day = formatDayInTimeZone(new Date(), dayRolloverTimezone);
  const metrics = await readMetrics(env, day);
  const cacheHitRate = metrics.requests > 0 ? Number((metrics.cacheHits / metrics.requests).toFixed(4)) : 0;

  return buildJsonResponse(
    {
      status: 'ok',
      model: MODEL_ID,
      dailyCap: computeGlobalDailyCap(env.DAILY_BUDGET_USD, env.WORST_CASE_COST_USD),
      cacheTtlSeconds: toPositiveInt(env.CACHE_TTL_SECONDS, ONE_DAY_SECONDS),
      limits: {
        perMinute: toPositiveInt(env.PER_MINUTE_LIMIT, 5),
        perDayNewAnalysis: toPositiveInt(env.PER_DAY_NEW_ANALYSIS_LIMIT, 20),
        reviewSampleLimit: resolveReviewSampleLimit(env.REVIEW_SAMPLE_LIMIT),
      },
      dayRolloverTimezone,
      metrics: {
        ...metrics,
        cacheHitRate,
      },
    },
    200,
    allowedOrigin
  );
}
