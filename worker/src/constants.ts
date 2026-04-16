export const MODEL_ID = 'google/gemini-3-flash-preview';
export const ONE_DAY_SECONDS = 86400;
export const ONE_WEEK_SECONDS = 604800;
export const DEFAULT_DAY_ROLLOVER_TIMEZONE = 'Asia/Tokyo';
export const DEFAULT_REVIEW_SAMPLE_LIMIT = 8;
export const MIN_REVIEW_SAMPLE_LIMIT = 3;
export const MAX_REVIEW_SAMPLE_LIMIT = 12;
export const PLACES_API_TIMEOUT_MS = 10000;
export const OPENROUTER_API_TIMEOUT_MS = 20000;

export const ANALYSIS_SCHEMA = {
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

export const SYSTEM_PROMPT = `
あなたは「飲食店サクラチェッカー」の分析エンジンです。
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
