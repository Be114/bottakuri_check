interface Env {
  APP_KV: KVNamespace;
  OPENROUTER_API_KEY: string;
  GOOGLE_PLACES_API_KEY: string;
  OPENROUTER_SITE_URL?: string;
  OPENROUTER_APP_NAME?: string;
  ALLOWED_ORIGINS?: string;
  DAILY_BUDGET_USD?: string;
  WORST_CASE_COST_USD?: string;
  CACHE_TTL_SECONDS?: string;
  PER_MINUTE_LIMIT?: string;
  PER_DAY_NEW_ANALYSIS_LIMIT?: string;
  OPENROUTER_MAX_TOKENS?: string;
  REVIEW_SAMPLE_LIMIT?: string;
  DAY_ROLLOVER_TIMEZONE?: string;
}

type ErrorCode =
  | 'INVALID_QUERY'
  | 'RATE_LIMIT'
  | 'BUDGET_EXCEEDED'
  | 'MODEL_UNAVAILABLE'
  | 'UPSTREAM_ERROR';

type BudgetState = 'ok' | 'capped';

interface AnalysisRisk {
  category: string;
  riskLevel: 'low' | 'medium' | 'high';
  description: string;
}

interface ReviewDistribution {
  star: number;
  percentage: number;
}

interface GroundingUrl {
  title: string;
  uri: string;
}

interface AnalysisReport {
  placeName: string;
  address: string;
  sakuraScore: number;
  estimatedRealRating: number;
  googleRating: number;
  tabelogRating?: number;
  verdict: '安全' | '注意' | '危険';
  risks: AnalysisRisk[];
  suspiciousKeywordsFound: string[];
  summary: string;
  reviewDistribution: ReviewDistribution[];
  groundingUrls: GroundingUrl[];
  meta: {
    cached: boolean;
    model: string;
    generatedAt: string;
    budgetState: BudgetState;
  };
}

interface AnalyzeRequest {
  query?: unknown;
  location?: {
    lat?: unknown;
    lng?: unknown;
  };
}

interface PlaceReview {
  rating: number;
  text: string;
  authorName?: string;
  publishTime?: string;
}

interface PlaceData {
  placeId: string;
  name: string;
  address: string;
  googleRating: number;
  userRatingCount: number;
  reviews: PlaceReview[];
  location?: {
    lat: number;
    lng: number;
  };
}

interface OpenRouterAnnotation {
  type?: string;
  url_citation?: {
    url?: string;
    title?: string;
    content?: string;
  };
}

interface OpenRouterMessageContentPart {
  type?: string;
  text?: string;
}

interface OpenRouterResponse {
  choices?: Array<{
    message?: {
      content?: string | OpenRouterMessageContentPart[];
      annotations?: OpenRouterAnnotation[];
    };
  }>;
  error?: {
    message?: string;
  };
}

class ApiHttpError extends Error {
  code: ErrorCode;
  status: number;

  constructor(code: ErrorCode, status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const MODEL_ID = 'google/gemini-3-flash-preview';
const ONE_DAY_SECONDS = 86400;
const ONE_WEEK_SECONDS = 604800;
const DEFAULT_DAY_ROLLOVER_TIMEZONE = 'Asia/Tokyo';
const DEFAULT_REVIEW_SAMPLE_LIMIT = 8;
const MIN_REVIEW_SAMPLE_LIMIT = 3;
const MAX_REVIEW_SAMPLE_LIMIT = 12;

const ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    placeName: { type: 'string' },
    address: { type: 'string' },
    sakuraScore: { type: 'integer', minimum: 0, maximum: 100 },
    estimatedRealRating: { type: 'number' },
    googleRating: { type: 'number' },
    tabelogRating: { type: ['number', 'null'] },
    verdict: { type: 'string', enum: ['安全', '注意', '危険'] },
    risks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          category: { type: 'string' },
          riskLevel: { type: 'string', enum: ['low', 'medium', 'high'] },
          description: { type: 'string' },
        },
        required: ['category', 'riskLevel', 'description'],
      },
    },
    suspiciousKeywordsFound: {
      type: 'array',
      items: { type: 'string' },
    },
    summary: { type: 'string' },
    reviewDistribution: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          star: { type: 'integer', minimum: 1, maximum: 5 },
          percentage: { type: 'integer', minimum: 0, maximum: 100 },
        },
        required: ['star', 'percentage'],
      },
    },
  },
  required: ['placeName', 'address', 'sakuraScore', 'verdict', 'risks', 'summary', 'reviewDistribution'],
} as const;

const SYSTEM_PROMPT = `
あなたは「Googleぼったくりチェッカー」の分析エンジンです。
必ずJSONのみで返答してください。誇張や断定を避け、根拠ベースで評価してください。
判定基準:
1. Google評価と外部サイト評価の乖離
2. レビュー文体の不自然さ
3. 警戒キーワードの有無
4. 評価分布の偏り

食べログ評価は圧縮スケールであるため、Googleと単純比較しないでください。
- 3.0未満はかなり低評価（Googleの1〜2台相当）
- 3.0〜3.2は低〜並
- 3.3〜3.5は良店
- 3.6以上は有名店クラス（上位層）

出力ルール:
- tabelogRating は「見つかった食べログの生値」を返す（不明なら null）
- estimatedRealRating は「外部サイト補正後のGoogle換算実力値(1.0〜5.0)」を返す
- tabelogRating は tabelog.com を参照確認できた場合のみ返し、確認できない場合は null にする
`.trim();

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const allowedOrigin = resolveAllowedOrigin(origin, env.ALLOWED_ORIGINS);

    if (url.pathname === '/api/health') {
      if (request.method !== 'GET') {
        return buildErrorResponse('UPSTREAM_ERROR', 405, 'Method Not Allowed', allowedOrigin);
      }
      return handleHealth(env, allowedOrigin);
    }

    if (url.pathname !== '/api/analyze') {
      return buildErrorResponse('UPSTREAM_ERROR', 404, 'Not Found', allowedOrigin);
    }

    if (request.method === 'OPTIONS') {
      return buildPreflightResponse(allowedOrigin);
    }

    if (request.method !== 'POST') {
      return buildErrorResponse('UPSTREAM_ERROR', 405, 'Method Not Allowed', allowedOrigin);
    }

    if (!allowedOrigin) {
      return buildErrorResponse('UPSTREAM_ERROR', 403, '許可されていないOriginです。', null);
    }

    try {
      const result = await handleAnalyze(request, env);
      return buildJsonResponse(result, 200, allowedOrigin);
    } catch (error) {
      if (error instanceof ApiHttpError) {
        return buildErrorResponse(error.code, error.status, error.message, allowedOrigin);
      }
      return buildErrorResponse('UPSTREAM_ERROR', 500, '予期せぬエラーが発生しました。', allowedOrigin);
    }
  },
};

async function handleAnalyze(request: Request, env: Env): Promise<AnalysisReport> {
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

  const perMinuteLimit = toPositiveInt(env.PER_MINUTE_LIMIT, 5);
  const minuteRateKey = `rate:minute:${ipHash}:${minuteBucket}`;
  const minuteAllowed = await allowWithinLimit(env, minuteRateKey, perMinuteLimit, 120);
  if (!minuteAllowed) {
    await incrementMetric(env, metricKey('rate_limited', dayKey));
    throw new ApiHttpError('RATE_LIMIT', 429, 'アクセスが集中しています。少し時間をおいて再度お試しください。');
  }

  const cacheTtl = toPositiveInt(env.CACHE_TTL_SECONDS, ONE_DAY_SECONDS);
  const cacheKey = await buildCacheKey(query, location);
  const cached = await env.APP_KV.get(cacheKey, 'json');
  if (isAnalysisReport(cached)) {
    const cachedResult: AnalysisReport = {
      ...cached,
      meta: {
        ...cached.meta,
        cached: true,
        budgetState: 'ok',
      },
    };
    await incrementMetric(env, metricKey('cache_hits', dayKey));
    return cachedResult;
  }

  const perDayNewAnalysisLimit = toPositiveInt(env.PER_DAY_NEW_ANALYSIS_LIMIT, 20);
  const dayRateKey = `rate:day:${ipHash}:${dayKey}`;
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
    openRouterResult.citations
  );

  await env.APP_KV.put(cacheKey, JSON.stringify(normalized), { expirationTtl: cacheTtl });
  await incrementMetric(env, metricKey('new_analysis', dayKey));

  return normalized;
}

async function handleHealth(env: Env, allowedOrigin: string | null): Promise<Response> {
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

function buildPreflightResponse(allowedOrigin: string | null): Response {
  if (!allowedOrigin) {
    return new Response(null, { status: 403 });
  }
  return new Response(null, {
    status: 204,
    headers: buildCorsHeaders(allowedOrigin),
  });
}

function buildErrorResponse(code: ErrorCode, status: number, message: string, allowedOrigin: string | null): Response {
  return buildJsonResponse({ error: { code, message } }, status, allowedOrigin);
}

function buildJsonResponse(body: unknown, status: number, allowedOrigin: string | null): Response {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });

  if (allowedOrigin) {
    const corsHeaders = buildCorsHeaders(allowedOrigin);
    corsHeaders.forEach((value, key) => {
      headers.set(key, value);
    });
  }

  return new Response(JSON.stringify(body), { status, headers });
}

function buildCorsHeaders(origin: string): Headers {
  return new Headers({
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  });
}

function resolveAllowedOrigin(origin: string | null, allowedOriginsRaw: string | undefined): string | null {
  if (!origin) return null;
  const allowedOrigins = (allowedOriginsRaw || '').split(',').map((item) => item.trim()).filter(Boolean);
  if (allowedOrigins.includes('*')) return origin;
  if (allowedOrigins.includes(origin)) return origin;
  return null;
}

function sanitizeQuery(rawQuery: unknown): string {
  if (typeof rawQuery !== 'string') return '';
  return rawQuery.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
}

function sanitizeLocation(
  rawLocation: AnalyzeRequest['location']
): { lat: number; lng: number } | undefined {
  if (!rawLocation || typeof rawLocation !== 'object') return undefined;
  const lat = toFiniteNumber(rawLocation.lat);
  const lng = toFiniteNumber(rawLocation.lng);
  if (lat === null || lng === null) return undefined;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return undefined;
  return { lat, lng };
}

function readClientIp(request: Request): string {
  const cfIp = request.headers.get('CF-Connecting-IP');
  if (cfIp) return cfIp;

  const forwarded = request.headers.get('X-Forwarded-For');
  if (forwarded) return forwarded.split(',')[0]?.trim() || 'unknown';

  return 'unknown';
}

async function hashIp(ip: string): Promise<string> {
  return hashString(ip);
}

async function buildCacheKey(
  query: string,
  location?: { lat: number; lng: number }
): Promise<string> {
  const roundedLocation = location
    ? `${location.lat.toFixed(2)},${location.lng.toFixed(2)}`
    : 'none';
  return `cache:v1:${await hashString(`${query}|${roundedLocation}`)}`;
}

async function hashString(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function allowWithinLimit(
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

async function reserveBudgetSlot(
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

function computeGlobalDailyCap(dailyBudgetRaw: string | undefined, worstCaseRaw: string | undefined): number {
  const dailyBudget = Number(dailyBudgetRaw ?? '5');
  const worstCase = Number(worstCaseRaw ?? '0.25');
  if (!Number.isFinite(dailyBudget) || dailyBudget <= 0) return 1;
  if (!Number.isFinite(worstCase) || worstCase <= 0) return 1;
  return Math.max(1, Math.floor(dailyBudget / worstCase));
}

async function incrementMetric(env: Env, key: string): Promise<void> {
  const currentRaw = await env.APP_KV.get(key);
  const currentCount = toPositiveInt(currentRaw, 0);
  await env.APP_KV.put(key, String(currentCount + 1), { expirationTtl: ONE_WEEK_SECONDS });
}

function metricKey(metric: 'requests' | 'cache_hits' | 'new_analysis' | 'rate_limited' | 'budget_exceeded', day: string): string {
  return `metric:${day}:${metric}`;
}

async function readMetrics(env: Env, day: string): Promise<{
  requests: number;
  cacheHits: number;
  newAnalysisCount: number;
  rateLimitedCount: number;
  budgetExceededCount: number;
}> {
  const [requestsRaw, cacheHitsRaw, newAnalysisRaw, rateLimitedRaw, budgetExceededRaw] =
    await Promise.all([
      env.APP_KV.get(metricKey('requests', day)),
      env.APP_KV.get(metricKey('cache_hits', day)),
      env.APP_KV.get(metricKey('new_analysis', day)),
      env.APP_KV.get(metricKey('rate_limited', day)),
      env.APP_KV.get(metricKey('budget_exceeded', day)),
    ]);

  return {
    requests: toPositiveInt(requestsRaw, 0),
    cacheHits: toPositiveInt(cacheHitsRaw, 0),
    newAnalysisCount: toPositiveInt(newAnalysisRaw, 0),
    rateLimitedCount: toPositiveInt(rateLimitedRaw, 0),
    budgetExceededCount: toPositiveInt(budgetExceededRaw, 0),
  };
}

async function fetchPlaceData(
  query: string,
  location: { lat: number; lng: number } | undefined,
  env: Env,
  reviewSampleLimit: number
): Promise<PlaceData> {
  const searchBody: Record<string, unknown> = {
    textQuery: query,
    languageCode: 'ja',
    maxResultCount: 1,
  };

  if (location) {
    searchBody.locationBias = {
      circle: {
        center: {
          latitude: location.lat,
          longitude: location.lng,
        },
        radius: 5000,
      },
    };
  }

  const searchResponse = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': env.GOOGLE_PLACES_API_KEY,
      'X-Goog-FieldMask':
        'places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.location',
    },
    body: JSON.stringify(searchBody),
  });

  if (!searchResponse.ok) {
    throw new ApiHttpError('UPSTREAM_ERROR', 502, 'Google Places API検索に失敗しました。');
  }

  const searchJson = (await searchResponse.json()) as {
    places?: Array<{
      id?: string;
      displayName?: { text?: string };
      formattedAddress?: string;
      rating?: number;
      userRatingCount?: number;
      location?: { latitude?: number; longitude?: number };
    }>;
  };

  const candidate = searchJson.places?.[0];
  const placeId = candidate?.id;
  if (!placeId) {
    throw new ApiHttpError('UPSTREAM_ERROR', 404, '対象の店舗情報が見つかりませんでした。');
  }

  const detailsUrl = new URL(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`);
  detailsUrl.searchParams.set('languageCode', 'ja');

  const detailsResponse = await fetch(detailsUrl.toString(), {
    headers: {
      'X-Goog-Api-Key': env.GOOGLE_PLACES_API_KEY,
      'X-Goog-FieldMask':
        'id,displayName,formattedAddress,rating,userRatingCount,reviews,location',
    },
  });

  if (!detailsResponse.ok) {
    throw new ApiHttpError('UPSTREAM_ERROR', 502, 'Google Places API詳細取得に失敗しました。');
  }

  const detailsJson = (await detailsResponse.json()) as {
    id?: string;
    displayName?: { text?: string };
    formattedAddress?: string;
    rating?: number;
    userRatingCount?: number;
    location?: { latitude?: number; longitude?: number };
    reviews?: Array<{
      rating?: number;
      text?: { text?: string };
      publishTime?: string;
      authorAttribution?: { displayName?: string };
    }>;
  };

  const reviews = (detailsJson.reviews || [])
    .slice(0, reviewSampleLimit)
    .map((review): PlaceReview => ({
      rating: clampNumber(toFiniteNumber(review.rating) ?? 0, 0, 5),
      text: normalizeReviewText(review.text?.text),
      authorName: review.authorAttribution?.displayName,
      publishTime: review.publishTime,
    }))
    .filter((review) => review.text.length > 0);

  return {
    placeId,
    name: detailsJson.displayName?.text || candidate.displayName?.text || query,
    address: detailsJson.formattedAddress || candidate.formattedAddress || '住所不明',
    googleRating: clampNumber(
      toFiniteNumber(detailsJson.rating) ?? toFiniteNumber(candidate.rating) ?? 0,
      0,
      5
    ),
    userRatingCount: Math.max(
      0,
      Math.round(toFiniteNumber(detailsJson.userRatingCount) ?? toFiniteNumber(candidate.userRatingCount) ?? 0)
    ),
    reviews,
    location: normalizePlaceLocation(detailsJson.location, candidate.location),
  };
}

function normalizePlaceLocation(
  primary?: { latitude?: number; longitude?: number },
  fallback?: { latitude?: number; longitude?: number }
): { lat: number; lng: number } | undefined {
  const lat = toFiniteNumber(primary?.latitude) ?? toFiniteNumber(fallback?.latitude);
  const lng = toFiniteNumber(primary?.longitude) ?? toFiniteNumber(fallback?.longitude);
  if (lat === null || lng === null) return undefined;
  return { lat, lng };
}

function normalizeReviewText(text?: string): string {
  if (!text) return '';
  return text.replace(/\s+/g, ' ').trim().slice(0, 240);
}

async function analyzeWithOpenRouter(
  query: string,
  place: PlaceData,
  modelId: string,
  env: Env,
  reviewSampleLimit: number
): Promise<{ report: Record<string, unknown>; citations: GroundingUrl[] }> {
  const maxTokens = toPositiveInt(env.OPENROUTER_MAX_TOKENS, 1400);

  const reviewLines = place.reviews.length
    ? place.reviews
        .slice(0, reviewSampleLimit)
        .map(
          (review, index) =>
            `${index + 1}. ★${review.rating} ${review.text}${review.publishTime ? ` (${review.publishTime})` : ''}`
        )
        .join('\n')
    : 'レビュー本文は取得できませんでした。';

  const userPrompt = `
調査クエリ: ${query}
店舗名: ${place.name}
住所: ${place.address}
Google評価: ${place.googleRating} (${place.userRatingCount}件)
Google Maps URL: https://www.google.com/maps/place/?q=place_id:${place.placeId}

直近レビュー要約(最大${reviewSampleLimit}件):
${reviewLines}

実施タスク:
1. Web情報(食べログ/Retty等)も参照し、Google評価との乖離を評価する
2. サクラ疑いキーワードや不自然な文体を抽出する
3. ぼったくり危険度(sakuraScore)を0-100で出す
4. reviewDistributionは1-5星の割合を整数で返す
5. summaryは簡潔に返す
6. 食べログ値は圧縮スケールとして補正し、estimatedRealRating はGoogle換算後の値を返す
7. tabelog.com を確認できない場合、tabelogRating は null を返す

補正の参考アンカー(実測例):
- サイゼリヤ 新宿西口: Google 3.6 / 食べログ 3.07
- 松屋 新宿大ガード店: Google 3.4 / 食べログ 3.05
- すしざんまい 本店: Google 4.2 / 食べログ 3.45
- 銀座 久兵衛 本店: Google 4.4 / 食べログ 3.71
`.trim();

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      'HTTP-Referer': env.OPENROUTER_SITE_URL || 'http://localhost:3000',
      'X-Title': env.OPENROUTER_APP_NAME || 'Googleぼったくりチェッカー',
    },
    body: JSON.stringify({
      model: modelId,
      temperature: 0.2,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'analysis_report',
          strict: true,
          schema: ANALYSIS_SCHEMA,
        },
      },
      plugins: [
        {
          id: 'web',
          engine: 'exa',
          max_results: 2,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new ApiHttpError('MODEL_UNAVAILABLE', 503, 'AIモデルが利用できません。');
  }

  const payload = (await response.json()) as OpenRouterResponse;
  const firstChoice = payload.choices?.[0];
  const content = extractMessageContent(firstChoice?.message?.content);

  if (!content) {
    throw new ApiHttpError('MODEL_UNAVAILABLE', 503, 'AIモデル応答が空でした。');
  }

  const parsed = parseJsonContent(content);
  if (!parsed || typeof parsed !== 'object') {
    throw new ApiHttpError('MODEL_UNAVAILABLE', 503, 'AIモデル応答の解析に失敗しました。');
  }

  const citations = extractCitations(firstChoice?.message?.annotations || [], place.placeId);
  return {
    report: parsed,
    citations,
  };
}

function extractMessageContent(content: string | OpenRouterMessageContentPart[] | undefined): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text?.trim() || '')
    .join('\n')
    .trim();
}

function parseJsonContent(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    const candidate = trimmed.slice(start, end + 1);
    try {
      return JSON.parse(candidate) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

function extractCitations(annotations: OpenRouterAnnotation[], placeId: string): GroundingUrl[] {
  const map = new Map<string, GroundingUrl>();
  const mapsUrl = `https://www.google.com/maps/place/?q=place_id:${placeId}`;
  map.set(mapsUrl, { title: 'Google Maps', uri: mapsUrl });

  for (const annotation of annotations) {
    if (annotation.type !== 'url_citation') continue;
    const citation = annotation.url_citation;
    const uri = citation?.url;
    if (!uri) continue;
    if (map.has(uri)) continue;
    map.set(uri, {
      title: citation?.title || new URL(uri).hostname,
      uri,
    });
  }

  return Array.from(map.values()).slice(0, 10);
}

function hasDomainCitation(citations: GroundingUrl[], domain: string): boolean {
  return citations.some((citation) => {
    try {
      const hostname = new URL(citation.uri).hostname.toLowerCase();
      return hostname === domain || hostname.endsWith(`.${domain}`);
    } catch {
      return false;
    }
  });
}

function normalizeAnalysis(
  report: Record<string, unknown>,
  place: PlaceData,
  model: string,
  budgetState: BudgetState,
  cached: boolean,
  citations: GroundingUrl[]
): AnalysisReport {
  const rawSakuraScore = clampNumber(
    Math.round(toFiniteNumber(report.sakuraScore) ?? inferScoreFromText(String(report.summary || ''))),
    0,
    100
  );

  const rawVerdict = typeof report.verdict === 'string' ? report.verdict : '';
  const hasTabelogCitation = hasDomainCitation(citations, 'tabelog.com');
  const tabelogRating = hasTabelogCitation ? normalizeTabelogRating(toFiniteNumber(report.tabelogRating)) : null;
  const modelEstimated = toFiniteNumber(report.estimatedRealRating);
  const tabelogComparable = tabelogRating === null ? null : mapTabelogToGoogleEquivalent(tabelogRating);

  const estimatedRealRating = clampNumber(
    tabelogComparable !== null
      ? modelEstimated !== null
        ? modelEstimated * 0.3 + tabelogComparable * 0.7
        : tabelogComparable
      : modelEstimated !== null
        ? modelEstimated
        : clampNumber(place.googleRating - rawSakuraScore / 100, 1, 5),
    1,
    5
  );

  const sakuraScore = adjustRiskScoreByDiscrepancy(rawSakuraScore, place.googleRating, estimatedRealRating, place.name);
  const verdict: '安全' | '注意' | '危険' =
    rawVerdict === '安全' || rawVerdict === '注意' || rawVerdict === '危険'
      ? deriveVerdict(Math.max(sakuraScore, verdictToMinScore(rawVerdict)))
      : deriveVerdict(sakuraScore);

  const risks = normalizeRisks(report.risks);
  const suspiciousKeywordsFound = normalizeKeywords(report.suspiciousKeywordsFound);
  const summary = normalizeSummary(report.summary, risks, verdict);
  const reviewDistribution = normalizeDistribution(report.reviewDistribution, sakuraScore);

  return {
    placeName: typeof report.placeName === 'string' && report.placeName.trim() ? report.placeName.trim() : place.name,
    address: typeof report.address === 'string' && report.address.trim() ? report.address.trim() : place.address,
    sakuraScore,
    estimatedRealRating: roundTo(estimatedRealRating, 2),
    googleRating: place.googleRating,
    tabelogRating: tabelogRating === null ? undefined : roundTo(clampNumber(tabelogRating, 1, 5), 2),
    verdict,
    risks,
    suspiciousKeywordsFound,
    summary,
    reviewDistribution,
    groundingUrls: citations,
    meta: {
      cached,
      model,
      generatedAt: new Date().toISOString(),
      budgetState,
    },
  };
}

function normalizeRisks(raw: unknown): AnalysisRisk[] {
  if (!Array.isArray(raw)) {
    return [
      {
        category: '総合評価',
        riskLevel: 'medium',
        description: '十分なリスク情報を取得できなかったため、追加確認を推奨します。',
      },
    ];
  }

  const risks: AnalysisRisk[] = raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, unknown>;
      const category = typeof record.category === 'string' && record.category.trim() ? record.category.trim() : null;
      const riskLevel =
        record.riskLevel === 'low' || record.riskLevel === 'medium' || record.riskLevel === 'high'
          ? record.riskLevel
          : 'medium';
      const description =
        typeof record.description === 'string' && record.description.trim()
          ? record.description.trim()
          : '詳細情報が不足しています。';
      if (!category) return null;
      return { category, riskLevel, description };
    })
    .filter((risk): risk is AnalysisRisk => risk !== null)
    .slice(0, 8);

  return risks.length > 0
    ? risks
    : [
        {
          category: '総合評価',
          riskLevel: 'medium',
          description: '十分なリスク情報を取得できなかったため、追加確認を推奨します。',
        },
      ];
}

function normalizeKeywords(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const unique = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const keyword = item.trim();
    if (!keyword) continue;
    unique.add(keyword);
    if (unique.size >= 15) break;
  }
  return Array.from(unique);
}

function normalizeSummary(raw: unknown, risks: AnalysisRisk[], verdict: '安全' | '注意' | '危険'): string {
  if (typeof raw === 'string' && raw.trim()) {
    return raw.trim();
  }
  const highestRisk = risks.find((risk) => risk.riskLevel === 'high') || risks[0];
  return `判定: ${verdict}。主な判断理由: ${highestRisk?.description || '情報不足のため追加確認が必要です。'}`;
}

function normalizeDistribution(raw: unknown, score: number): ReviewDistribution[] {
  if (!Array.isArray(raw)) {
    return estimateDistribution(score);
  }

  const byStar = new Map<number, number>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    const star = Math.round(toFiniteNumber(entry.star) ?? 0);
    const percentage = Math.round(toFiniteNumber(entry.percentage) ?? 0);
    if (star < 1 || star > 5 || percentage < 0) continue;
    byStar.set(star, percentage);
  }

  if (byStar.size === 0) {
    return estimateDistribution(score);
  }

  const rawItems: ReviewDistribution[] = [1, 2, 3, 4, 5].map((star) => ({
    star,
    percentage: Math.max(0, byStar.get(star) || 0),
  }));

  const total = rawItems.reduce((sum, item) => sum + item.percentage, 0);
  if (total <= 0) {
    return estimateDistribution(score);
  }

  const normalized = rawItems.map((item) => ({
    star: item.star,
    percentage: Math.round((item.percentage / total) * 100),
  }));

  const adjustedTotal = normalized.reduce((sum, item) => sum + item.percentage, 0);
  const diff = 100 - adjustedTotal;
  if (diff !== 0) {
    const target = normalized.find((item) => item.star === 5) || normalized[normalized.length - 1];
    target.percentage = Math.max(0, target.percentage + diff);
  }

  return normalized;
}

function estimateDistribution(score: number): ReviewDistribution[] {
  if (score >= 70) {
    return [
      { star: 1, percentage: 24 },
      { star: 2, percentage: 12 },
      { star: 3, percentage: 12 },
      { star: 4, percentage: 18 },
      { star: 5, percentage: 34 },
    ];
  }
  if (score >= 40) {
    return [
      { star: 1, percentage: 12 },
      { star: 2, percentage: 14 },
      { star: 3, percentage: 24 },
      { star: 4, percentage: 28 },
      { star: 5, percentage: 22 },
    ];
  }
  return [
    { star: 1, percentage: 5 },
    { star: 2, percentage: 8 },
    { star: 3, percentage: 22 },
    { star: 4, percentage: 35 },
    { star: 5, percentage: 30 },
  ];
}

function normalizeTabelogRating(value: number | null): number | null {
  if (value === null) return null;
  if (value < 2.0 || value > 4.5) return null;
  return clampNumber(value, 2.0, 4.2);
}

function mapTabelogToGoogleEquivalent(tabelogRating: number): number {
  const t = clampNumber(tabelogRating, 2.0, 4.2);

  if (t <= 2.8) return lerp(t, 2.0, 2.8, 1.2, 1.9);
  if (t <= 3.0) return lerp(t, 2.8, 3.0, 1.9, 2.5);
  if (t <= 3.2) return lerp(t, 3.0, 3.2, 2.5, 3.4);
  if (t <= 3.4) return lerp(t, 3.2, 3.4, 3.4, 3.9);
  if (t <= 3.6) return lerp(t, 3.4, 3.6, 3.9, 4.3);
  if (t <= 3.8) return lerp(t, 3.6, 3.8, 4.3, 4.6);
  return lerp(t, 3.8, 4.2, 4.6, 4.9);
}

function adjustRiskScoreByDiscrepancy(
  baseScore: number,
  googleRating: number,
  comparableRating: number,
  placeName: string
): number {
  const discrepancy = googleRating - comparableRating;
  if (discrepancy <= 0.4) return baseScore;

  let penalty = discrepancy <= 0.8
    ? (discrepancy - 0.4) * 35
    : 14 + (discrepancy - 0.8) * 50;

  if (looksLikeChainStore(placeName)) {
    penalty *= 0.6;
  }

  return clampNumber(Math.round(baseScore + penalty), 0, 100);
}

function looksLikeChainStore(placeName: string): boolean {
  const chainKeywords = [
    'サイゼリヤ',
    '松屋',
    'すき家',
    'マクドナルド',
    'スターバックス',
    '鳥貴族',
    '吉野家',
    'ガスト',
    'くら寿司',
    'スシロー',
    'はま寿司',
    '一蘭',
  ];

  return chainKeywords.some((keyword) => placeName.includes(keyword));
}

function verdictToMinScore(verdict: '安全' | '注意' | '危険'): number {
  if (verdict === '危険') return 70;
  if (verdict === '注意') return 40;
  return 0;
}

function deriveVerdict(score: number): '安全' | '注意' | '危険' {
  if (score >= 70) return '危険';
  if (score >= 40) return '注意';
  return '安全';
}

function lerp(value: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  if (inMax <= inMin) return outMin;
  const ratio = clampNumber((value - inMin) / (inMax - inMin), 0, 1);
  return outMin + (outMax - outMin) * ratio;
}

function roundTo(value: number, digits: number): number {
  const scale = Math.pow(10, digits);
  return Math.round(value * scale) / scale;
}

function inferScoreFromText(summary: string): number {
  const normalized = summary.toLowerCase();
  if (normalized.includes('ぼったくり') || normalized.includes('詐欺')) return 75;
  if (normalized.includes('注意') || normalized.includes('不自然')) return 50;
  return 30;
}

function isAnalysisReport(value: unknown): value is AnalysisReport {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.placeName === 'string' &&
    typeof record.address === 'string' &&
    typeof record.sakuraScore === 'number' &&
    Array.isArray(record.risks) &&
    Array.isArray(record.reviewDistribution) &&
    Array.isArray(record.groundingUrls) &&
    typeof record.meta === 'object' &&
    record.meta !== null
  );
}

function toPositiveInt(rawValue: string | null | undefined, fallback: number): number {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}

function toBoundedInt(rawValue: string | null | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return fallback;
  return clampNumber(Math.floor(parsed), min, max);
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function resolveReviewSampleLimit(rawValue: string | undefined): number {
  return toBoundedInt(rawValue, DEFAULT_REVIEW_SAMPLE_LIMIT, MIN_REVIEW_SAMPLE_LIMIT, MAX_REVIEW_SAMPLE_LIMIT);
}

function resolveDayRolloverTimezone(rawValue: string | undefined): string {
  const normalized = rawValue?.trim();
  return normalized || DEFAULT_DAY_ROLLOVER_TIMEZONE;
}

function formatDayInTimeZone(date: Date, timeZone: string): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = formatter.formatToParts(date);
    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    const day = parts.find((part) => part.type === 'day')?.value;
    if (!year || !month || !day) {
      return formatUtcDay(date);
    }
    return `${year}-${month}-${day}`;
  } catch {
    return formatUtcDay(date);
  }
}

function formatUtcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatUtcMinute(date: Date): string {
  return date.toISOString().slice(0, 16);
}
