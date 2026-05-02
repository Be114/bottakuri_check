import {
  AnalysisMeta,
  AnalysisMetadata,
  AnalysisReport,
  ApiError,
  ApiErrorCode,
  LocationCoordinates,
  NearbyPlace,
  NearbyRankingReport,
  NearbyRankingRequest,
} from '../types';

interface AnalyzeRequest {
  query: string;
  location?: LocationCoordinates;
}

interface AnalyzeErrorResponse {
  error?: {
    code?: ApiErrorCode;
    message?: string;
  };
}

const DEFAULT_PRODUCTION_API_BASE = 'https://bottakuri-check-api.steep-wood-db4a.workers.dev/api';

function resolveDefaultApiBase(): string {
  if (typeof window === 'undefined') return '/api';

  const { hostname } = window.location;
  const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  return isLocalhost ? '/api' : DEFAULT_PRODUCTION_API_BASE;
}

const defaultApiBase = resolveDefaultApiBase();
export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || defaultApiBase).replace(/\/$/, '');

const DEFAULT_META: AnalysisMeta = {
  cached: false,
  model: 'google/gemini-3.1-flash-lite-preview',
  generatedAt: new Date(0).toISOString(),
  budgetState: 'ok',
};

const DEFAULT_ERROR_MESSAGE = '分析中にエラーが発生しました。もう一度お試しください。';
const DEFAULT_NEARBY_ERROR_MESSAGE = '周辺の優良店を取得できませんでした。もう一度お試しください。';

function toApiError(code: ApiErrorCode, message: string, status?: number): ApiError {
  return { code, message, status };
}

function normalizeLocation(value: unknown): LocationCoordinates | undefined {
  if (!value || typeof value !== 'object') return undefined;

  const maybeLocation = value as { lat?: unknown; lng?: unknown; latitude?: unknown; longitude?: unknown };
  const lat = Number(maybeLocation.lat ?? maybeLocation.latitude);
  const lng = Number(maybeLocation.lng ?? maybeLocation.longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  return { lat, lng };
}

function normalizeOptionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const items = value.map((item) => normalizeOptionalText(item)).filter((item): item is string => Boolean(item));
  return items.length > 0 ? Array.from(new Set(items)) : undefined;
}

function normalizePriceLevel(value: unknown): number | undefined {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;

  if (typeof value === 'string') {
    const normalizedValue = value.trim().toLowerCase();
    if (!normalizedValue) return undefined;
    if (normalizedValue.includes('free')) return 0;
    if (normalizedValue.includes('inexpensive')) return 1;
    if (normalizedValue.includes('moderate')) return 2;
    if (normalizedValue.includes('very_expensive') || normalizedValue.includes('very-expensive')) return 4;
    if (normalizedValue.includes('expensive')) return 3;
  }

  const parsedValue = Number(value);
  if (!Number.isFinite(parsedValue)) return undefined;
  return Math.max(0, Math.min(4, Math.round(parsedValue)));
}

function formatMoney(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;

  const money = value as { currencyCode?: unknown; units?: unknown; nanos?: unknown };
  const units = Number(money.units ?? 0);
  const nanos = Number(money.nanos ?? 0);
  const amount = units + nanos / 1_000_000_000;
  if (!Number.isFinite(amount) || amount <= 0) return undefined;

  const currencyCode = typeof money.currencyCode === 'string' ? money.currencyCode.toUpperCase() : '';
  if (!currencyCode || currencyCode === 'JPY') {
    return `¥${Math.round(amount).toLocaleString('ja-JP')}`;
  }

  return `${amount.toLocaleString('ja-JP')} ${currencyCode}`;
}

function normalizePriceRangeLabel(value: unknown): string | undefined {
  const textValue = normalizeOptionalText(value);
  if (textValue) return textValue;
  if (!value || typeof value !== 'object') return undefined;

  const range = value as { startPrice?: unknown; endPrice?: unknown };
  const start = formatMoney(range.startPrice);
  const end = formatMoney(range.endPrice);
  if (start && end) return `${start}〜${end}`;
  return start || end;
}

function normalizeSuspicionLevel(value: unknown, sakuraScore: number): NearbyPlace['suspicionLevel'] {
  if (typeof value === 'string') {
    const normalizedValue = value.trim().toLowerCase();
    if (normalizedValue === 'very_high' || normalizedValue === 'very-high' || normalizedValue.includes('非常に高')) {
      return 'very_high';
    }
    if (normalizedValue === 'high' || normalizedValue === '高' || normalizedValue.includes('高')) return 'high';
    if (
      normalizedValue === 'medium' ||
      normalizedValue === 'middle' ||
      normalizedValue === '中' ||
      normalizedValue.includes('中')
    ) {
      return 'medium';
    }
    if (normalizedValue === 'low' || normalizedValue === '低' || normalizedValue.includes('低')) return 'low';
  }

  if (sakuraScore >= 85) return 'very_high';
  if (sakuraScore >= 70) return 'high';
  if (sakuraScore >= 40) return 'medium';
  return 'low';
}

function normalizeMetadata(value: unknown): AnalysisMetadata | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;

  const metadata = value as Record<string, unknown>;
  return {
    ...metadata,
    category: normalizeOptionalText(metadata.category),
    categories: normalizeStringList(metadata.categories),
    genre: normalizeOptionalText(metadata.genre),
  };
}

function normalizeReport(payload: Partial<AnalysisReport>): AnalysisReport {
  return {
    placeName: payload.placeName || '不明な店舗',
    address: payload.address || '住所情報なし',
    location: normalizeLocation(payload.location ?? payload),
    category: normalizeOptionalText(payload.category),
    categories: normalizeStringList(payload.categories),
    genre: normalizeOptionalText(payload.genre),
    metadata: normalizeMetadata(payload.metadata),
    sakuraScore: Number(payload.sakuraScore ?? 0),
    estimatedRealRating: Number(payload.estimatedRealRating ?? 0),
    googleRating: Number(payload.googleRating ?? 0),
    tabelogRating: payload.tabelogRating,
    verdict: payload.verdict || '注意',
    risks: Array.isArray(payload.risks) ? payload.risks : [],
    suspiciousKeywordsFound: Array.isArray(payload.suspiciousKeywordsFound) ? payload.suspiciousKeywordsFound : [],
    summary: payload.summary || '分析結果の要約を取得できませんでした。',
    reviewDistribution: Array.isArray(payload.reviewDistribution) ? payload.reviewDistribution : [],
    groundingUrls: Array.isArray(payload.groundingUrls) ? payload.groundingUrls : [],
    meta: payload.meta
      ? {
          cached: Boolean(payload.meta.cached),
          model: payload.meta.model || DEFAULT_META.model,
          generatedAt: payload.meta.generatedAt || new Date().toISOString(),
          budgetState: payload.meta.budgetState === 'capped' ? 'capped' : 'ok',
        }
      : { ...DEFAULT_META, generatedAt: new Date().toISOString() },
  };
}

type NearbyPlacePayload = Omit<Partial<NearbyPlace>, 'priceLevel' | 'priceRange'> & {
  placeId?: string;
  name?: string;
  userRatingCount?: number;
  priceLevel?: unknown;
  price_level?: unknown;
  priceRange?: unknown;
  price_range?: unknown;
};

function normalizeNearbyPlace(payload: NearbyPlacePayload, index: number): NearbyPlace {
  const placeName = payload.placeName || payload.name || `候補店舗 ${index + 1}`;
  const trustScore = Number(payload.trustScore ?? Math.max(0, 100 - Number(payload.sakuraScore ?? 0)));
  const sakuraScore = Number(payload.sakuraScore ?? Math.max(0, 100 - trustScore));
  const suspicionLevel = normalizeSuspicionLevel(payload.suspicionLevel, sakuraScore);

  return {
    id: payload.id || payload.placeId || `${placeName}-${index}`,
    placeId: payload.placeId || payload.id || `${placeName}-${index}`,
    rank: Number(payload.rank ?? index + 1),
    name: payload.name || placeName,
    genre: payload.genre || payload.categories?.[0] || '飲食店',
    placeName,
    address: payload.address || '住所情報なし',
    location: normalizeLocation(payload.location ?? payload),
    mapUrl: payload.mapUrl,
    googleRating: Number(payload.googleRating ?? 0),
    estimatedRealRating: Number(payload.estimatedRealRating ?? payload.googleRating ?? 0),
    priceLevel: normalizePriceLevel(payload.priceLevel ?? payload.price_level),
    priceRange: normalizePriceRangeLabel(payload.priceRange ?? payload.price_range),
    userRatingCount:
      typeof payload.userRatingCount === 'number'
        ? payload.userRatingCount
        : typeof payload.reviewCount === 'number'
          ? payload.reviewCount
          : undefined,
    trustScore,
    sakuraScore,
    suspicionLevel,
    verdict: payload.verdict || '安全',
    reviewCount:
      typeof payload.reviewCount === 'number'
        ? payload.reviewCount
        : typeof payload.userRatingCount === 'number'
          ? payload.userRatingCount
          : undefined,
    distanceMeters: typeof payload.distanceMeters === 'number' ? payload.distanceMeters : undefined,
    categories: Array.isArray(payload.categories) ? payload.categories : [],
    summary: payload.summary || '周辺候補として抽出されました。',
    reasons: Array.isArray(payload.reasons) ? payload.reasons : [],
    analysisReport: payload.analysisReport ? normalizeReport(payload.analysisReport) : undefined,
  };
}

function normalizeNearbyReport(
  payload:
    | Partial<NearbyRankingReport>
    | {
        results?: Partial<NearbyPlace>[];
        ranking?: Partial<NearbyPlace>[];
        rankings?: Partial<NearbyPlace>[];
        topPins?: Partial<NearbyPlace>[];
      },
  request: NearbyRankingRequest,
): NearbyRankingReport {
  const candidates =
    (Array.isArray((payload as Partial<NearbyRankingReport>).places) &&
      (payload as Partial<NearbyRankingReport>).places) ||
    (Array.isArray((payload as { rankings?: Partial<NearbyPlace>[] }).rankings) &&
      (payload as { rankings?: Partial<NearbyPlace>[] }).rankings) ||
    (Array.isArray((payload as { results?: Partial<NearbyPlace>[] }).results) &&
      (payload as { results?: Partial<NearbyPlace>[] }).results) ||
    (Array.isArray((payload as { ranking?: Partial<NearbyPlace>[] }).ranking) &&
      (payload as { ranking?: Partial<NearbyPlace>[] }).ranking) ||
    (Array.isArray((payload as { topPins?: Partial<NearbyPlace>[] }).topPins) &&
      (payload as { topPins?: Partial<NearbyPlace>[] }).topPins) ||
    [];

  const origin = (payload as Partial<NearbyRankingReport>).origin;
  const meta = (payload as Partial<NearbyRankingReport>).meta;

  return {
    mapImageUrl: normalizeOptionalText((payload as Partial<NearbyRankingReport>).mapImageUrl),
    mapEmbedUrl: normalizeOptionalText((payload as Partial<NearbyRankingReport>).mapEmbedUrl),
    origin: {
      location: normalizeLocation(origin?.location) || request.location,
      type: origin?.type || request.originType,
      placeName: origin?.placeName || request.originPlaceName,
      address: origin?.address || request.originAddress,
      genre: origin?.genre || request.originGenre,
      categories: Array.isArray(origin?.categories) ? origin.categories : request.originCategories,
      radiusMeters: origin?.radiusMeters,
    },
    places: candidates
      .map(normalizeNearbyPlace)
      .sort((a, b) => a.rank - b.rank)
      .slice(0, 10),
    meta: {
      generatedAt: meta?.generatedAt || new Date().toISOString(),
      originType: meta?.originType || request.originType,
      originPlaceName: meta?.originPlaceName || request.originPlaceName,
      originAddress: meta?.originAddress || request.originAddress,
      originGenre: meta?.originGenre || request.originGenre,
      originCategories: Array.isArray(meta?.originCategories) ? meta.originCategories : request.originCategories,
      cached: meta?.cached,
      model: meta?.model,
      budgetState: meta?.budgetState,
      candidatesCount: meta?.candidatesCount,
      analyzedCount: meta?.analyzedCount,
      warnings: Array.isArray(meta?.warnings) ? meta.warnings : [],
    },
  };
}

export async function analyzePlace(request: AnalyzeRequest): Promise<AnalysisReport> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
  } catch {
    throw toApiError('UPSTREAM_ERROR', DEFAULT_ERROR_MESSAGE);
  }

  let payload: Partial<AnalysisReport> | AnalyzeErrorResponse | null = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const code = (payload as AnalyzeErrorResponse | null)?.error?.code || 'UPSTREAM_ERROR';
    const message = (payload as AnalyzeErrorResponse | null)?.error?.message || DEFAULT_ERROR_MESSAGE;
    throw toApiError(code, message, response.status);
  }

  return normalizeReport((payload || {}) as Partial<AnalysisReport>);
}

export async function fetchNearbyRanking(request: NearbyRankingRequest): Promise<NearbyRankingReport> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/nearby-rankings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
  } catch {
    throw toApiError('UPSTREAM_ERROR', DEFAULT_NEARBY_ERROR_MESSAGE);
  }

  let payload: Partial<NearbyRankingReport> | AnalyzeErrorResponse | null = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const code = (payload as AnalyzeErrorResponse | null)?.error?.code || 'UPSTREAM_ERROR';
    const message = (payload as AnalyzeErrorResponse | null)?.error?.message || DEFAULT_NEARBY_ERROR_MESSAGE;
    throw toApiError(code, message, response.status);
  }

  return normalizeNearbyReport((payload || {}) as Partial<NearbyRankingReport>, request);
}
