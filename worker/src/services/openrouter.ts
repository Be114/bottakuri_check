import { ANALYSIS_SCHEMA, OPENROUTER_API_TIMEOUT_MS, SYSTEM_PROMPT } from '../constants';
import {
  GroundingUrl,
  OpenRouterAnnotation,
  OpenRouterMessageContentPart,
  OpenRouterResponse,
  PlaceData,
  Env,
} from '../types';
import { ApiHttpError } from '../utils/response';
import { toPositiveInt } from '../utils/validation';

export async function analyzeWithOpenRouter(
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

  const response = await fetchWithTimeout(
    'https://openrouter.ai/api/v1/chat/completions',
    {
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
    },
    OPENROUTER_API_TIMEOUT_MS
  );

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

async function fetchWithTimeout(input: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      throw new ApiHttpError('MODEL_UNAVAILABLE', 503, 'AIモデルの応答がタイムアウトしました。');
    }
    throw new ApiHttpError('MODEL_UNAVAILABLE', 503, 'AIモデルが利用できません。');
  } finally {
    clearTimeout(timeoutId);
  }
}
