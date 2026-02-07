import { AnalysisMeta, AnalysisReport, ApiError, ApiErrorCode } from '../types';

interface AnalyzeRequest {
  query: string;
  location?: { lat: number; lng: number };
}

interface AnalyzeErrorResponse {
  error?: {
    code?: ApiErrorCode;
    message?: string;
  };
}

const DEFAULT_PRODUCTION_API_BASE = 'https://bottakuri-check-api.steep-wood-db4a.workers.dev/api';
const defaultApiBase =
  typeof window !== 'undefined' && window.location.hostname.endsWith('.pages.dev')
    ? DEFAULT_PRODUCTION_API_BASE
    : '/api';
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || defaultApiBase).replace(/\/$/, '');

const DEFAULT_META: AnalysisMeta = {
  cached: false,
  model: 'google/gemini-3-flash-preview',
  generatedAt: new Date(0).toISOString(),
  budgetState: 'ok',
};

const DEFAULT_ERROR_MESSAGE = '分析中にエラーが発生しました。もう一度お試しください。';

function toApiError(code: ApiErrorCode, message: string, status?: number): ApiError {
  return { code, message, status };
}

function normalizeReport(payload: Partial<AnalysisReport>): AnalysisReport {
  return {
    placeName: payload.placeName || '不明な店舗',
    address: payload.address || '住所情報なし',
    sakuraScore: Number(payload.sakuraScore ?? 0),
    estimatedRealRating: Number(payload.estimatedRealRating ?? 0),
    googleRating: Number(payload.googleRating ?? 0),
    tabelogRating: payload.tabelogRating,
    verdict: payload.verdict || '注意',
    risks: Array.isArray(payload.risks) ? payload.risks : [],
    suspiciousKeywordsFound: Array.isArray(payload.suspiciousKeywordsFound)
      ? payload.suspiciousKeywordsFound
      : [],
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
