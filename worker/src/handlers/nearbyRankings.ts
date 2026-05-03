import { MAX_REVIEW_SAMPLE_LIMIT, MODEL_ID, ONE_DAY_SECONDS } from '../constants';
import { normalizeAnalysis, isAnalysisReport } from '../domain/normalization';
import { computeLowInformationRisk, deriveVerdict } from '../domain/scoring';
import {
  allowWithinLimit,
  computeGlobalDailyCap,
  incrementMetric,
  metricKey,
  reserveBudgetSlot,
} from '../services/kvStore';
import { analyzeWithOpenRouter } from '../services/openrouter';
import {
  buildNearbyGenreFilter,
  fetchNearbyRestaurants,
  fetchPlaceData,
  fetchPlaceDetailsById,
} from '../services/places';
import {
  AnalysisReport,
  Env,
  NearbyPlaceData,
  NearbyRanking,
  NearbyRankingsRequest,
  NearbyRankingsResponse,
  SuspicionLevel,
} from '../types';
import {
  buildCacheKey,
  buildNearbyCacheKey,
  buildNearbyPlaceAnalysisCacheKey,
  hashIp,
  readClientIp,
} from '../utils/hash';
import { ApiHttpError } from '../utils/response';
import { formatDayInTimeZone, formatUtcMinute, resolveDayRolloverTimezone } from '../utils/time';
import {
  clampNumber,
  resolveReviewSampleLimit,
  sanitizeQuery,
  sanitizeRequiredLocation,
  toFiniteNumber,
  toIntegerInRange,
  toNonNegativeInt,
} from '../utils/validation';

const DEFAULT_RADIUS_METERS = 800;
const MIN_RADIUS_METERS = 100;
const MAX_RADIUS_METERS = 3000;
const MAX_NEARBY_RESULTS = 10;

type BatchAnalysisByPlaceId = Map<
  string,
  {
    trustScore: number;
    sakuraScore: number;
    suspicionLevel: SuspicionLevel;
    summary: string;
    reasons: string[];
    estimatedRealRating: number;
    verdict: '安全' | '注意' | '危険';
    analysisReport?: AnalysisReport;
  }
>;

type RankingBeforeRank = Omit<NearbyRanking, 'rank'>;

export async function handleNearbyRankings(request: Request, env: Env): Promise<NearbyRankingsResponse> {
  const payload = (await request.json().catch(() => ({}))) as NearbyRankingsRequest;
  const providedOriginPlaceName = sanitizeQuery(payload.originPlaceName);
  if (providedOriginPlaceName && (providedOriginPlaceName.length < 2 || providedOriginPlaceName.length > 80)) {
    throw new ApiHttpError('INVALID_QUERY', 400, '起点名は2〜80文字で入力してください。');
  }
  const originPlaceName = providedOriginPlaceName || '現在位置';

  const originAddress = sanitizeOptionalText(payload.originAddress, 120);
  const originGenre = sanitizeOptionalText(payload.originGenre, 80);
  const originCategories = sanitizeStringArray(payload.originCategories, 20, 80);
  const location = sanitizeRequiredLocation(payload.location);
  if (!location) {
    throw new ApiHttpError('INVALID_QUERY', 400, '有効な緯度・経度を指定してください。');
  }

  const radiusMeters = sanitizeRadiusMeters(payload.radiusMeters);
  const now = new Date();
  const dayRolloverTimezone = resolveDayRolloverTimezone(env.DAY_ROLLOVER_TIMEZONE);
  const dayKey = formatDayInTimeZone(now, dayRolloverTimezone);
  const minuteBucket = formatUtcMinute(now);
  const ipHash = await hashIp(readClientIp(request));

  await incrementMetric(env, metricKey('requests', dayKey));

  const perMinuteLimit = toNonNegativeInt(
    env.NEARBY_RANKINGS_PER_MINUTE_LIMIT,
    toNonNegativeInt(env.PER_MINUTE_LIMIT, 10),
  );
  const minuteRateKey = `rate:minute:nearby:${ipHash}:${minuteBucket}`;
  const minuteAllowed = await allowWithinLimit(env, minuteRateKey, perMinuteLimit, 120);
  if (!minuteAllowed) {
    await incrementMetric(env, metricKey('rate_limited', dayKey));
    throw new ApiHttpError('RATE_LIMIT', 429, 'アクセスが集中しています。少し時間をおいて再度お試しください。');
  }

  const warnings: string[] = [];
  const originGenreContext = await resolveOriginGenreContext(
    {
      originPlaceName,
      originAddress,
      originGenre,
      originCategories,
      location,
      shouldResolveOriginPlace: Boolean(providedOriginPlaceName),
    },
    env,
    warnings,
  );
  const genreFilter = buildNearbyGenreFilter(
    originGenreContext.originGenre,
    originGenreContext.originCategories,
    originPlaceName,
  );
  const cacheTtl = toNonNegativeInt(env.CACHE_TTL_SECONDS, ONE_DAY_SECONDS);
  const cacheKey = await buildNearbyCacheKey(location, radiusMeters, genreFilter.includedPrimaryTypes.join(','));
  const cached = await env.APP_KV.get(cacheKey, 'json');
  if (isNearbyRankingsResponse(cached)) {
    const rankings = ensureRankingAnalysisReports(cached.rankings);
    const topPins = ensureRankingAnalysisReports(cached.topPins);
    await incrementMetric(env, metricKey('cache_hits', dayKey));
    return {
      ...cached,
      rankings,
      topPins,
      mapEmbedUrl: cached.mapEmbedUrl || buildNearbyMapEmbedUrl(location),
      origin: {
        ...cached.origin,
        placeName: originPlaceName,
        ...(originAddress ? { address: originAddress } : {}),
        ...(originGenreContext.originGenre ? { genre: originGenreContext.originGenre } : {}),
        ...(originGenreContext.originCategories.length > 0 ? { categories: originGenreContext.originCategories } : {}),
      },
      meta: {
        ...cached.meta,
        cached: true,
        model: MODEL_ID,
        budgetState: 'ok',
      },
    };
  }

  const perDayNewAnalysisLimit = toNonNegativeInt(env.NEARBY_RANKINGS_PER_DAY_LIMIT, 100);
  const dayRateKey = `rate:day:nearby:${ipHash}:${dayKey}`;
  const dayAllowed = await allowWithinLimit(env, dayRateKey, perDayNewAnalysisLimit, ONE_DAY_SECONDS * 2);
  if (!dayAllowed) {
    await incrementMetric(env, metricKey('rate_limited', dayKey));
    throw new ApiHttpError('RATE_LIMIT', 429, '本日の新規分析回数上限に達しました。');
  }

  if (env.NEARBY_RANKINGS_DISABLE_BUDGET_LIMIT !== 'true') {
    const computedCap = computeGlobalDailyCap(env.DAILY_BUDGET_USD, env.WORST_CASE_COST_USD);
    const dailyCap = toNonNegativeInt(env.NEARBY_RANKINGS_DAILY_CAP, Math.max(computedCap * 5, computedCap));
    const budgetKey = `budget:nearby:${dayKey}`;
    const hasBudget = await reserveBudgetSlot(env, budgetKey, dailyCap, ONE_DAY_SECONDS * 2);
    if (!hasBudget) {
      await incrementMetric(env, metricKey('budget_exceeded', dayKey));
      throw new ApiHttpError('BUDGET_EXCEEDED', 429, '本日の周辺ランキング分析上限に達しました。');
    }
  }

  const nearbySearch = await fetchNearbyRestaurantsWithExpansion(location, radiusMeters, env, genreFilter, warnings);
  const places = nearbySearch.places;
  if (places.length === 0) {
    warnings.push(`${genreFilter.label}の周辺候補が見つかりませんでした。`);
  }

  let analysisByPlaceId: BatchAnalysisByPlaceId | null = null;
  const model = MODEL_ID;
  if (places.length > 0) {
    analysisByPlaceId = await analyzeNearbyPlacesIndividually(places, model, env, warnings);
  }

  const rankings = rankPlaces(places, analysisByPlaceId, nearbySearch.radiusMeters);
  const topPins = rankings.slice(0, 3);
  const mapImageUrl = buildNearbyMapImageUrl(location, topPins);
  const mapEmbedUrl = buildNearbyMapEmbedUrl(location);

  const response: NearbyRankingsResponse = {
    origin: {
      placeName: originPlaceName,
      ...(originAddress ? { address: originAddress } : {}),
      location,
      radiusMeters: nearbySearch.radiusMeters,
      ...(originGenreContext.originGenre ? { genre: originGenreContext.originGenre } : {}),
      ...(originGenreContext.originCategories.length > 0 ? { categories: originGenreContext.originCategories } : {}),
    },
    rankings,
    topPins,
    ...(mapImageUrl ? { mapImageUrl } : {}),
    mapEmbedUrl,
    meta: {
      cached: false,
      model,
      generatedAt: new Date().toISOString(),
      budgetState: 'ok',
      candidatesCount: places.length,
      analyzedCount: Array.from(analysisByPlaceId?.values() || []).filter((analysis) => analysis.analysisReport).length,
      warnings,
      genreFilter: genreFilter.includedPrimaryTypes,
    },
  };

  await env.APP_KV.put(cacheKey, JSON.stringify(response), { expirationTtl: cacheTtl });
  await incrementMetric(env, metricKey('new_analysis', dayKey));

  return response;
}

async function resolveOriginGenreContext(
  input: {
    originPlaceName: string;
    originAddress?: string;
    originGenre?: string;
    originCategories: string[];
    location: { lat: number; lng: number };
    shouldResolveOriginPlace: boolean;
  },
  env: Env,
  warnings: string[],
): Promise<{ originGenre?: string; originCategories: string[] }> {
  const initialFilter = buildNearbyGenreFilter(input.originGenre, input.originCategories, input.originPlaceName);
  if (!initialFilter.isFallback) {
    return {
      originGenre: input.originGenre || initialFilter.label,
      originCategories: input.originCategories,
    };
  }

  if (!input.shouldResolveOriginPlace) {
    return {
      originGenre: input.originGenre,
      originCategories: input.originCategories,
    };
  }

  try {
    const query = [input.originPlaceName, input.originAddress].filter(Boolean).join(' ');
    const originPlace = await fetchPlaceData(query, input.location, env, 1);
    const resolvedCategories = mergeStrings(input.originCategories, originPlace.categories);
    const resolvedGenre = input.originGenre || originPlace.genre;
    const resolvedFilter = buildNearbyGenreFilter(resolvedGenre, resolvedCategories, input.originPlaceName);
    if (!resolvedFilter.isFallback) {
      return {
        originGenre: resolvedGenre || resolvedFilter.label,
        originCategories: resolvedCategories,
      };
    }
  } catch {
    warnings.push('起点店舗のジャンル詳細を取得できなかったため、入力情報からジャンルを推定しました。');
  }

  return {
    originGenre: input.originGenre,
    originCategories: input.originCategories,
  };
}

async function fetchNearbyRestaurantsWithExpansion(
  location: { lat: number; lng: number },
  radiusMeters: number,
  env: Env,
  genreFilter: ReturnType<typeof buildNearbyGenreFilter>,
  warnings: string[],
): Promise<{ places: NearbyPlaceData[]; radiusMeters: number }> {
  const radii = buildSearchRadii(radiusMeters);
  const byPlaceId = new Map<string, NearbyPlaceData>();
  let usedRadius = radiusMeters;

  for (const radius of radii) {
    usedRadius = radius;
    const places = await fetchNearbyRestaurants(location, radius, env, MAX_NEARBY_RESULTS, genreFilter);
    for (const place of places) {
      byPlaceId.set(place.placeId, place);
      if (byPlaceId.size >= MAX_NEARBY_RESULTS) break;
    }
    if (byPlaceId.size >= MAX_NEARBY_RESULTS) break;
  }

  const places = Array.from(byPlaceId.values())
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, MAX_NEARBY_RESULTS);

  if (places.length > 0 && places.length < MAX_NEARBY_RESULTS) {
    warnings.push(
      `${genreFilter.label}の候補が${places.length}件のみ見つかりました。ジャンルを広げず半径${usedRadius}mまで拡大しました。`,
    );
  }
  if (usedRadius > radiusMeters && places.length >= MAX_NEARBY_RESULTS) {
    warnings.push(`${genreFilter.label}の候補を10件集めるため、半径を${usedRadius}mまで拡大しました。`);
  }

  return { places, radiusMeters: usedRadius };
}

function buildSearchRadii(radiusMeters: number): number[] {
  const candidates = [radiusMeters, 1200, 1800, 2400, MAX_RADIUS_METERS].map((radius) =>
    Math.round(clampNumber(radius, MIN_RADIUS_METERS, MAX_RADIUS_METERS)),
  );
  return Array.from(new Set(candidates.filter((radius) => radius >= radiusMeters)));
}

async function analyzeNearbyPlacesIndividually(
  places: NearbyPlaceData[],
  model: string,
  env: Env,
  warnings: string[],
): Promise<BatchAnalysisByPlaceId> {
  const analysisMap: BatchAnalysisByPlaceId = new Map();
  const concurrency = toIntegerInRange(env.NEARBY_ANALYSIS_CONCURRENCY, 3, 1, 5);
  const reviewSampleLimit = toIntegerInRange(
    env.NEARBY_ANALYSIS_REVIEW_SAMPLE_LIMIT,
    resolveReviewSampleLimit(env.REVIEW_SAMPLE_LIMIT),
    1,
    MAX_REVIEW_SAMPLE_LIMIT,
  );

  const results = await mapWithConcurrency(places, concurrency, async (place) => {
    try {
      const cacheKey = await buildNearbyPlaceAnalysisCacheKey(place.placeId);
      const cached = await env.APP_KV.get(cacheKey, 'json');
      if (isAnalysisReport(cached)) {
        return [
          place.placeId,
          buildAnalysisFromReport({
            ...cached,
            meta: { ...cached.meta, cached: true, model: MODEL_ID, budgetState: 'ok' },
          }),
        ] as const;
      }

      const placeDetails = await fetchPlaceDetailsById(place.placeId, place, env, reviewSampleLimit);
      const openRouterResult = await analyzeWithOpenRouter(
        `${placeDetails.name} ${placeDetails.address}`,
        placeDetails,
        model,
        env,
        reviewSampleLimit,
      );
      const analysisReport = normalizeAnalysis(
        openRouterResult.report,
        placeDetails,
        model,
        'ok',
        false,
        openRouterResult.citations,
        env.CHAIN_STORE_KEYWORDS,
      );

      await env.APP_KV.put(cacheKey, JSON.stringify(analysisReport), {
        expirationTtl: toNonNegativeInt(env.CACHE_TTL_SECONDS, ONE_DAY_SECONDS),
      });
      await env.APP_KV.put(await buildCacheKey(place.name, place.location), JSON.stringify(analysisReport), {
        expirationTtl: toNonNegativeInt(env.CACHE_TTL_SECONDS, ONE_DAY_SECONDS),
      });

      return [place.placeId, buildAnalysisFromReport(analysisReport)] as const;
    } catch {
      warnings.push(`${place.name}のAI分析に失敗したため、簡易評価で補完しました。`);
      return null;
    }
  });

  for (const result of results) {
    if (!result) continue;
    analysisMap.set(result[0], result[1]);
  }

  return analysisMap;
}

function buildAnalysisFromReport(
  analysisReport: AnalysisReport,
): BatchAnalysisByPlaceId extends Map<string, infer T> ? T : never {
  const sakuraScore = Math.round(clampNumber(analysisReport.sakuraScore, 0, 100));
  const ratingAdjustment = (analysisReport.estimatedRealRating - 3) * 6;
  const trustScore = Math.round(clampNumber(100 - sakuraScore + ratingAdjustment, 0, 100));
  return {
    trustScore,
    sakuraScore,
    suspicionLevel: deriveSuspicionLevel(sakuraScore),
    summary: analysisReport.summary,
    reasons: analysisReport.risks.map((risk) => risk.description).slice(0, 3),
    estimatedRealRating: analysisReport.estimatedRealRating,
    verdict: analysisReport.verdict,
    analysisReport,
  };
}

function rankPlaces(
  places: NearbyPlaceData[],
  batchAnalysis: BatchAnalysisByPlaceId | null,
  radiusMeters: number,
): NearbyRanking[] {
  return places
    .map((place, index) => {
      const fallback = buildHeuristicAnalysis(place, radiusMeters, index, places.length);
      const analysis = batchAnalysis?.get(place.placeId) || fallback;
      const analysisReport = analysis.analysisReport || buildHeuristicAnalysisReport(place, analysis);
      return {
        placeId: place.placeId,
        name: place.name,
        genre: place.genre,
        placeName: place.name,
        address: place.address,
        location: place.location,
        distanceMeters: place.distanceMeters,
        googleRating: place.googleRating,
        userRatingCount: place.userRatingCount,
        ...(place.priceLevel ? { priceLevel: place.priceLevel } : {}),
        ...(place.priceRange ? { priceRange: place.priceRange } : {}),
        estimatedRealRating: analysis.estimatedRealRating,
        trustScore: analysis.trustScore,
        sakuraScore: analysis.sakuraScore,
        suspicionLevel: analysis.suspicionLevel,
        verdict: analysis.verdict,
        summary: analysis.summary,
        reasons: analysis.reasons,
        categories: place.categories,
        mapUrl: buildGoogleMapsUrl(place.placeId, place.location),
        analysisReport,
      };
    })
    .sort((a, b) => computeRankScore(b, radiusMeters) - computeRankScore(a, radiusMeters))
    .map((ranking, index) => ({ ...ranking, rank: index + 1 }));
}

function computeRankScore(ranking: RankingBeforeRank, radiusMeters: number): number {
  const distanceBonus = (1 - clampNumber(ranking.distanceMeters / radiusMeters, 0, 1)) * 12;
  const ratingBonus = clampNumber(ranking.googleRating / 5, 0, 1) * 8;
  const reviewBonus = Math.min(Math.log10(ranking.userRatingCount + 1), 3) * 3;
  return ranking.trustScore * 0.78 + distanceBonus + ratingBonus + reviewBonus;
}

function ensureRankingAnalysisReports(rankings: NearbyRanking[]): NearbyRanking[] {
  return rankings.map((ranking) => ({
    ...ranking,
    analysisReport:
      (ranking as NearbyRanking & { analysisReport?: AnalysisReport }).analysisReport ||
      buildHeuristicAnalysisReport(ranking, ranking),
  }));
}

function buildHeuristicAnalysisReport(
  place: Pick<
    NearbyPlaceData,
    'placeId' | 'name' | 'genre' | 'categories' | 'address' | 'googleRating' | 'userRatingCount'
  > & {
    primaryType?: string;
    types?: string[];
    location?: { lat: number; lng: number };
  },
  analysis: Pick<
    BatchAnalysisByPlaceId extends Map<string, infer T> ? T : never,
    'sakuraScore' | 'estimatedRealRating' | 'verdict' | 'suspicionLevel' | 'summary' | 'reasons'
  >,
): AnalysisReport {
  const riskLevel = analysis.suspicionLevel;
  const lowInformationRisk = computeLowInformationRisk(place.userRatingCount || 0, 0);
  return {
    placeName: place.name,
    address: place.address,
    location: place.location,
    genre: place.genre,
    category: place.categories[0],
    categories: place.categories,
    metadata: {
      genre: place.genre,
      categories: place.categories,
      ...(place.primaryType ? { primaryType: place.primaryType } : {}),
      types: place.types || [],
      placeId: place.placeId,
      source: 'nearby_heuristic',
    },
    sakuraScore: analysis.sakuraScore,
    estimatedRealRating: analysis.estimatedRealRating,
    estimatedRealRatingSource: 'fallback',
    googleRating: place.googleRating,
    verdict: analysis.verdict,
    confidence: 'low',
    confidenceReasons: ['AI分析に失敗したため、Google評価・レビュー件数・距離のみで簡易評価しています。'],
    componentScores: {
      reviewTextRisk: 0,
      ratingGapRisk: 0,
      starPatternRisk: 0,
      externalComplaintRisk: 0,
      fakePraiseRisk: 0,
      lowInformationRisk,
    },
    scoringDebug: {
      deterministicScore: analysis.sakuraScore,
      scoreBeforeException: analysis.sakuraScore,
      finalScore: analysis.sakuraScore,
      appliedFloors: [],
      appliedCaps: ['nearby_heuristic_no_text_or_external_evidence'],
      appliedMultipliers: [],
    },
    exceptionPolicy: {
      applied: false,
      kind: 'none',
      reason: 'AI分析失敗時の簡易評価のため例外補正は未適用',
      originalScore: analysis.sakuraScore,
      adjustedScore: analysis.sakuraScore,
    },
    risks: analysis.reasons.map((reason) => ({
      category: '簡易評価',
      riskLevel,
      description: reason,
    })),
    suspiciousKeywordsFound: [],
    summary: analysis.summary,
    reviewDistribution: [],
    reviewDistributionSource: 'unavailable',
    evidence: [
      {
        category: 'low_information',
        severity: lowInformationRisk,
        source: 'deterministic_rule',
        description: 'AI分析に失敗したため、レビュー本文や外部評判の根拠は未確認です。',
      },
    ],
    groundingUrls: [{ title: 'Google Maps', uri: buildGoogleMapsUrl(place.placeId, place.location) }],
    meta: {
      cached: false,
      model: MODEL_ID,
      generatedAt: new Date().toISOString(),
      budgetState: 'ok',
      scoringVersion: 2,
    },
  };
}

function buildHeuristicAnalysis(
  place: NearbyPlaceData,
  radiusMeters: number,
  index: number,
  totalCount: number,
): BatchAnalysisByPlaceId extends Map<string, infer T> ? T : never {
  const ratingComponent = clampNumber((place.googleRating / 5) * 45, 0, 45);
  const reviewComponent = clampNumber(Math.log10(place.userRatingCount + 1) * 14, 0, 32);
  const distanceComponent = (1 - clampNumber(place.distanceMeters / radiusMeters, 0, 1)) * 18;
  const baselineTrust = Math.round(clampNumber(35 + ratingComponent + reviewComponent + distanceComponent, 15, 92));
  const relativePenalty = totalCount > 1 ? Math.round((index / (totalCount - 1)) * 12) : 0;
  const trustScore = clampNumber(baselineTrust - relativePenalty, 0, 100);
  const rawSakuraScore = 100 - trustScore + (place.userRatingCount < 20 && place.googleRating >= 4.5 ? 8 : 0);
  const sakuraScore = clampNumber(rawSakuraScore, 0, 45);
  const suspicionLevel = deriveSuspicionLevel(sakuraScore);
  return {
    trustScore,
    sakuraScore,
    suspicionLevel,
    estimatedRealRating: roundTo(clampNumber(place.googleRating - sakuraScore / 120, 1, 5), 2),
    verdict: deriveVerdict(sakuraScore),
    summary: suspicionLevel === 'low' ? '信頼度高め' : '追加確認推奨',
    reasons: [
      `Google評価 ${place.googleRating.toFixed(1)} / ${place.userRatingCount}件`,
      `起点から約${place.distanceMeters}m`,
    ],
  };
}

function sanitizeRadiusMeters(rawValue: unknown): number {
  const value = toFiniteNumber(rawValue);
  if (value === null) return DEFAULT_RADIUS_METERS;
  return Math.round(clampNumber(value, MIN_RADIUS_METERS, MAX_RADIUS_METERS));
}

function sanitizeOptionalText(rawValue: unknown, maxLength: number): string | undefined {
  if (typeof rawValue !== 'string') return undefined;
  const value = rawValue.replace(/\s+/g, ' ').trim().slice(0, maxLength);
  return value || undefined;
}

function sanitizeStringArray(rawValue: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(rawValue)) return [];
  const unique = new Set<string>();
  for (const item of rawValue) {
    const value = sanitizeOptionalText(item, maxLength);
    if (!value) continue;
    unique.add(value);
    if (unique.size >= maxItems) break;
  }
  return Array.from(unique);
}

function mergeStrings(primary: string[], secondary: string[]): string[] {
  return Array.from(new Set([...primary, ...secondary].filter(Boolean))).slice(0, 20);
}

function deriveSuspicionLevel(sakuraScore: number): SuspicionLevel {
  if (sakuraScore >= 70) return 'high';
  if (sakuraScore >= 40) return 'medium';
  return 'low';
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(items[index], index);
      }
    }),
  );

  return results;
}

function buildGoogleMapsUrl(placeId: string, location?: { lat: number; lng: number }): string {
  const url = new URL('https://www.google.com/maps/search/');
  url.searchParams.set('api', '1');
  if (location) {
    url.searchParams.set('query', `${location.lat},${location.lng}`);
  } else {
    url.searchParams.set('query', `place_id:${placeId}`);
  }
  url.searchParams.set('query_place_id', placeId);
  return url.toString();
}

function buildNearbyMapImageUrl(origin: { lat: number; lng: number }, topPins: NearbyRanking[]): string | undefined {
  if (topPins.length === 0) return undefined;
  const params = new URLSearchParams({
    originLat: roundTo(origin.lat, 6).toString(),
    originLng: roundTo(origin.lng, 6).toString(),
    pins: topPins
      .slice(0, 3)
      .map((pin) => `${pin.rank},${roundTo(pin.location.lat, 6)},${roundTo(pin.location.lng, 6)}`)
      .join('|'),
  });
  return `/api/nearby-map?${params.toString()}`;
}

function buildNearbyMapEmbedUrl(origin: { lat: number; lng: number }): string {
  const url = new URL('https://www.google.com/maps');
  url.searchParams.set('q', `${roundTo(origin.lat, 6)},${roundTo(origin.lng, 6)}`);
  url.searchParams.set('z', '15');
  url.searchParams.set('output', 'embed');
  return url.toString();
}

function roundTo(value: number, digits: number): number {
  const scale = Math.pow(10, digits);
  return Math.round(value * scale) / scale;
}

function isNearbyRankingsResponse(value: unknown): value is NearbyRankingsResponse {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.origin === 'object' &&
    record.origin !== null &&
    Array.isArray(record.rankings) &&
    Array.isArray(record.topPins) &&
    typeof record.meta === 'object' &&
    record.meta !== null
  );
}
