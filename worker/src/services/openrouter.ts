import { ANALYSIS_SCHEMA, OPENROUTER_API_TIMEOUT_MS, SYSTEM_PROMPT } from '../constants';
import {
  GroundingUrl,
  NearbyPlaceData,
  OpenRouterAnnotation,
  OpenRouterMessageContentPart,
  OpenRouterResponse,
  PlaceData,
  Env,
} from '../types';
import { fetchJsonWithTimeout } from '../utils/http';
import { ApiHttpError } from '../utils/response';
import { toNonNegativeInt } from '../utils/validation';

export async function analyzeWithOpenRouter(
  query: string,
  place: PlaceData,
  modelId: string,
  env: Env,
  reviewSampleLimit: number,
): Promise<{ report: Record<string, unknown>; citations: GroundingUrl[] }> {
  const maxTokens = toNonNegativeInt(env.OPENROUTER_MAX_TOKENS, 1400);

  const reviewLines = place.reviews.length
    ? place.reviews
        .slice(0, reviewSampleLimit)
        .map(
          (review, index) =>
            `${index + 1}. ★${review.rating} ${review.text}${review.publishTime ? ` (${review.publishTime})` : ''}`,
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
3. サクラ危険度(sakuraScore)を0-100で出す
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

  const result = await fetchJsonWithTimeout<OpenRouterResponse>(
    'https://openrouter.ai/api/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': env.OPENROUTER_SITE_URL || 'http://localhost:3000',
        'X-Title': buildOpenRouterAppTitle(env),
      },
      body: JSON.stringify({
        model: modelId,
        temperature: 0.2,
        max_tokens: maxTokens,
        reasoning: {
          effort: 'none',
          exclude: true,
        },
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
    },
    {
      timeoutMs: OPENROUTER_API_TIMEOUT_MS,
      onTimeout: () => {
        logOpenRouterError({ kind: 'timeout', modelId, timeoutMs: OPENROUTER_API_TIMEOUT_MS });
        return new ApiHttpError('MODEL_UNAVAILABLE', 503, 'AIモデルの応答がタイムアウトしました。');
      },
      onError: (error) => {
        logOpenRouterError({ kind: 'request_error', modelId, message: getErrorMessage(error) });
        return new ApiHttpError('MODEL_UNAVAILABLE', 503, 'AIモデルが利用できません。');
      },
    },
  );

  if (!result.response.ok) {
    logOpenRouterError({
      kind: 'non_ok_response',
      modelId,
      status: result.response.status,
      statusText: result.response.statusText,
    });
    throw new ApiHttpError('MODEL_UNAVAILABLE', 503, 'AIモデルが利用できません。');
  }

  const payload = result.json;
  if (!payload) {
    logOpenRouterError({ kind: 'empty_payload', modelId });
    throw new ApiHttpError('MODEL_UNAVAILABLE', 503, 'AIモデル応答の解析に失敗しました。');
  }

  const firstChoice = payload.choices?.[0];
  const content = extractMessageContent(firstChoice?.message?.content);

  if (!content) {
    logOpenRouterError({ kind: 'empty_content', modelId });
    throw new ApiHttpError('MODEL_UNAVAILABLE', 503, 'AIモデル応答が空でした。');
  }

  const parsed = parseJsonContent(content);
  if (!parsed || typeof parsed !== 'object') {
    logOpenRouterError({ kind: 'invalid_json', modelId });
    throw new ApiHttpError('MODEL_UNAVAILABLE', 503, 'AIモデル応答の解析に失敗しました。');
  }

  const citations = extractCitations(firstChoice?.message?.annotations || [], place.placeId);
  return {
    report: parsed,
    citations,
  };
}

export async function analyzeNearbyBatchWithOpenRouter(
  origin: { placeName: string; address?: string; location: { lat: number; lng: number }; radiusMeters: number },
  places: NearbyPlaceData[],
  modelId: string,
  env: Env,
): Promise<Record<string, unknown>> {
  const maxTokens = Math.min(toNonNegativeInt(env.OPENROUTER_MAX_TOKENS, 1400), 1200);
  const candidates = places
    .map(
      (place, index) =>
        `${index + 1}. id=${place.placeId} name=${place.name} genre=${place.genre} address=${place.address} Google=${place.googleRating} reviews=${place.userRatingCount} distance=${place.distanceMeters}m`,
    )
    .join('\n');

  const userPrompt = `
起点: ${origin.placeName}${origin.address ? ` (${origin.address})` : ''}
中心座標: ${origin.location.lat}, ${origin.location.lng}
半径: ${origin.radiusMeters}m

候補店舗:
${candidates}

実施タスク:
1. 候補全体を1回の軽量バッチで比較し、各店舗の trustScore(0-100, 高いほど信頼), sakuraScore(0-100, 高いほどサクラ疑い), suspicionLevel(low/medium/high)を返す
2. trustScoreはGoogle評価だけでなく、レビュー数、距離、評価件数に対する評価の自然さを補助的に使う
3. 疑いの高低が混在するよう相対評価し、全店舗が同じ suspicionLevel にならないようにする
4. summaryは30字以内、reasonsは最大3件
5. JSONのみで返す
`.trim();

  const result = await fetchJsonWithTimeout<OpenRouterResponse>(
    'https://openrouter.ai/api/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': env.OPENROUTER_SITE_URL || 'http://localhost:3000',
        'X-Title': buildOpenRouterAppTitle(env),
      },
      body: JSON.stringify({
        model: modelId,
        temperature: 0.1,
        max_tokens: maxTokens,
        reasoning: {
          effort: 'none',
          exclude: true,
        },
        messages: [
          {
            role: 'system',
            content: 'あなたは飲食店候補を低コストに相対評価する分析エンジンです。必ずJSONのみを返してください。',
          },
          { role: 'user', content: userPrompt },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'nearby_rankings',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                rankings: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      placeId: { type: 'string' },
                      trustScore: { type: 'integer', minimum: 0, maximum: 100 },
                      sakuraScore: { type: 'integer', minimum: 0, maximum: 100 },
                      suspicionLevel: { type: 'string', enum: ['low', 'medium', 'high'] },
                      summary: { type: 'string' },
                      reasons: { type: 'array', items: { type: 'string' }, maxItems: 3 },
                    },
                    required: ['placeId', 'trustScore', 'sakuraScore', 'suspicionLevel', 'summary', 'reasons'],
                  },
                },
              },
              required: ['rankings'],
            },
          },
        },
      }),
    },
    {
      timeoutMs: OPENROUTER_API_TIMEOUT_MS,
      onTimeout: () => {
        logOpenRouterError({ kind: 'timeout', modelId, timeoutMs: OPENROUTER_API_TIMEOUT_MS });
        return new ApiHttpError('MODEL_UNAVAILABLE', 503, 'AIモデルの応答がタイムアウトしました。');
      },
      onError: (error) => {
        logOpenRouterError({ kind: 'request_error', modelId, message: getErrorMessage(error) });
        return new ApiHttpError('MODEL_UNAVAILABLE', 503, 'AIモデルが利用できません。');
      },
    },
  );

  if (!result.response.ok || !result.json) {
    logOpenRouterError({
      kind: result.response.ok ? 'empty_payload' : 'non_ok_response',
      modelId,
      status: result.response.status,
      statusText: result.response.statusText,
    });
    throw new ApiHttpError('MODEL_UNAVAILABLE', 503, 'AIモデルが利用できません。');
  }

  const content = extractMessageContent(result.json.choices?.[0]?.message?.content);
  const parsed = content ? parseJsonContent(content) : null;
  if (!parsed || typeof parsed !== 'object') {
    logOpenRouterError({ kind: content ? 'invalid_json' : 'empty_content', modelId });
    throw new ApiHttpError('MODEL_UNAVAILABLE', 503, 'AIモデル応答の解析に失敗しました。');
  }
  return validateNearbyBatchResponse(parsed, modelId);
}

function validateNearbyBatchResponse(value: unknown, modelId: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    logOpenRouterError({ kind: 'invalid_schema', modelId });
    throw new ApiHttpError('MODEL_UNAVAILABLE', 503, 'AIモデル応答の形式が不正です。');
  }

  const rankings = (value as { rankings?: unknown }).rankings;
  if (!Array.isArray(rankings) || !rankings.every(isValidNearbyBatchRanking)) {
    logOpenRouterError({ kind: 'invalid_schema', modelId });
    throw new ApiHttpError('MODEL_UNAVAILABLE', 503, 'AIモデル応答の形式が不正です。');
  }

  return value as Record<string, unknown>;
}

function isValidNearbyBatchRanking(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;

  const ranking = value as Record<string, unknown>;
  const trustScore = ranking.trustScore;
  const sakuraScore = ranking.sakuraScore;
  const suspicionLevel = ranking.suspicionLevel;
  const reasons = ranking.reasons;

  return (
    typeof ranking.placeId === 'string' &&
    ranking.placeId.trim().length > 0 &&
    typeof trustScore === 'number' &&
    Number.isFinite(trustScore) &&
    trustScore >= 0 &&
    trustScore <= 100 &&
    typeof sakuraScore === 'number' &&
    Number.isFinite(sakuraScore) &&
    sakuraScore >= 0 &&
    sakuraScore <= 100 &&
    (suspicionLevel === 'low' || suspicionLevel === 'medium' || suspicionLevel === 'high') &&
    typeof ranking.summary === 'string' &&
    Array.isArray(reasons) &&
    reasons.length <= 3 &&
    reasons.every((reason) => typeof reason === 'string')
  );
}

function buildOpenRouterAppTitle(env: Env): string {
  return toAsciiHeaderValue(env.OPENROUTER_APP_NAME) || 'Bottakuri Checker';
}

function toAsciiHeaderValue(value?: string): string {
  if (!value) return '';
  return value
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function logOpenRouterError(params: {
  kind: string;
  modelId: string;
  timeoutMs?: number;
  status?: number;
  statusText?: string;
  message?: string;
}): void {
  console.warn(
    JSON.stringify({
      level: 'warn',
      event: 'openrouter_error',
      kind: params.kind,
      modelId: params.modelId,
      timeoutMs: params.timeoutMs,
      status: params.status,
      statusText: params.statusText,
      message: params.message,
      timestamp: new Date().toISOString(),
    }),
  );
}

function getErrorMessage(error: unknown): string | undefined {
  return error instanceof Error ? error.message : undefined;
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

export function hasDomainCitation(citations: GroundingUrl[], domain: string): boolean {
  return citations.some((citation) => {
    try {
      const hostname = new URL(citation.uri).hostname.toLowerCase();
      return hostname === domain || hostname.endsWith(`.${domain}`);
    } catch {
      return false;
    }
  });
}
