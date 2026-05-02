import { MODEL_ID, ONE_DAY_SECONDS } from '../constants';
import { normalizeAnalysis, isAnalysisReport } from '../domain/normalization';
import { analyzeWithOpenRouter } from '../services/openrouter';
import { fetchPlaceData } from '../services/places';
import {
  allowWithinLimit,
  computeGlobalDailyCap,
  incrementMetric,
  metricKey,
  reserveBudgetSlot,
} from '../services/kvStore';
import { AnalysisReport, AnalyzeRequest, Env } from '../types';
import { buildCacheKey, hashIp, readClientIp } from '../utils/hash';
import { ApiHttpError } from '../utils/response';
import { formatDayInTimeZone, formatUtcMinute, resolveDayRolloverTimezone } from '../utils/time';
import { resolveReviewSampleLimit, sanitizeLocation, sanitizeQuery, toNonNegativeInt } from '../utils/validation';

export async function handleAnalyze(request: Request, env: Env): Promise<AnalysisReport> {
  const payload = (await request.json().catch(() => ({}))) as AnalyzeRequest;

  const query = sanitizeQuery(payload.query);
  if (query.length < 2 || query.length > 80) {
    throw new ApiHttpError('INVALID_QUERY', 400, '店名や場所は2〜80文字で入力してください。');
  }

  const location = sanitizeLocation(payload.location);
  const now = new Date();
  const dayRolloverTimezone = resolveDayRolloverTimezone(env.DAY_ROLLOVER_TIMEZONE);
  const dayKey = formatDayInTimeZone(now, dayRolloverTimezone);
  const minuteBucket = formatUtcMinute(now);
  const reviewSampleLimit = resolveReviewSampleLimit(env.REVIEW_SAMPLE_LIMIT);
  const ipHash = await hashIp(readClientIp(request));

  await incrementMetric(env, metricKey('requests', dayKey));

  const cacheTtl = toNonNegativeInt(env.CACHE_TTL_SECONDS, ONE_DAY_SECONDS);
  const cacheKey = await buildCacheKey(query, location);
  const cached = await env.APP_KV.get(cacheKey, 'json');
  if (isAnalysisReport(cached)) {
    let cachedResult: AnalysisReport = {
      ...cached,
      meta: {
        ...cached.meta,
        cached: true,
        model: MODEL_ID,
        budgetState: 'ok',
      },
    };
    if (!cachedResult.genre && (!cachedResult.categories || cachedResult.categories.length === 0)) {
      const enrichedResult = await enrichCachedAnalysisWithPlaceGenre(
        cachedResult,
        query,
        location,
        env,
        reviewSampleLimit,
      );
      if (enrichedResult.genre || (enrichedResult.categories && enrichedResult.categories.length > 0)) {
        cachedResult = enrichedResult;
        await env.APP_KV.put(cacheKey, JSON.stringify(cachedResult), { expirationTtl: cacheTtl });
      }
    }
    await incrementMetric(env, metricKey('cache_hits', dayKey));
    return cachedResult;
  }

  const perMinuteLimit = toNonNegativeInt(env.PER_MINUTE_LIMIT, 5);
  const minuteRateKey = `rate:minute:analyze:${ipHash}:${minuteBucket}`;
  const minuteAllowed = await allowWithinLimit(env, minuteRateKey, perMinuteLimit, 120);
  if (!minuteAllowed) {
    await incrementMetric(env, metricKey('rate_limited', dayKey));
    throw new ApiHttpError('RATE_LIMIT', 429, 'アクセスが集中しています。少し時間をおいて再度お試しください。');
  }

  const perDayNewAnalysisLimit = toNonNegativeInt(env.PER_DAY_NEW_ANALYSIS_LIMIT, 20);
  const dayRateKey = `rate:day:analyze:${ipHash}:${dayKey}`;
  const dayAllowed = await allowWithinLimit(env, dayRateKey, perDayNewAnalysisLimit, ONE_DAY_SECONDS * 2);
  if (!dayAllowed) {
    await incrementMetric(env, metricKey('rate_limited', dayKey));
    throw new ApiHttpError('RATE_LIMIT', 429, '本日の新規分析回数上限に達しました。');
  }

  const dailyCap = computeGlobalDailyCap(env.DAILY_BUDGET_USD, env.WORST_CASE_COST_USD);
  const budgetKey = `budget:new:${dayKey}`;
  const hasBudget = await reserveBudgetSlot(env, budgetKey, dailyCap, ONE_DAY_SECONDS * 2);
  if (!hasBudget) {
    await incrementMetric(env, metricKey('budget_exceeded', dayKey));
    throw new ApiHttpError('BUDGET_EXCEEDED', 429, '本日の新規分析上限に達しました。');
  }

  const placeData = await fetchPlaceData(query, location, env, reviewSampleLimit);
  const modelId = MODEL_ID;
  const openRouterResult = await analyzeWithOpenRouter(query, placeData, modelId, env, reviewSampleLimit);

  const normalized = normalizeAnalysis(
    openRouterResult.report,
    placeData,
    modelId,
    'ok',
    false,
    openRouterResult.citations,
    env.CHAIN_STORE_KEYWORDS,
  );

  await env.APP_KV.put(cacheKey, JSON.stringify(normalized), { expirationTtl: cacheTtl });
  await incrementMetric(env, metricKey('new_analysis', dayKey));

  return normalized;
}

async function enrichCachedAnalysisWithPlaceGenre(
  report: AnalysisReport,
  query: string,
  location: { lat: number; lng: number } | undefined,
  env: Env,
  reviewSampleLimit: number,
): Promise<AnalysisReport> {
  try {
    const place = await fetchPlaceData(query, location, env, reviewSampleLimit);
    return {
      ...report,
      ...(place.genre ? { genre: place.genre } : {}),
      ...(place.categories.length > 0 ? { category: place.categories[0], categories: place.categories } : {}),
      metadata: {
        ...(report.metadata || {}),
        ...(place.genre ? { genre: place.genre } : {}),
        ...(place.categories.length > 0 ? { category: place.categories[0], categories: place.categories } : {}),
        ...(place.primaryType ? { primaryType: place.primaryType } : {}),
        types: place.types,
        placeId: place.placeId,
      },
    };
  } catch {
    return report;
  }
}
