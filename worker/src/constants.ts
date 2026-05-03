export const MODEL_ID = 'google/gemini-3.1-flash-lite-preview';
export const ONE_DAY_SECONDS = 86400;
export const ONE_WEEK_SECONDS = 604800;
export const DEFAULT_DAY_ROLLOVER_TIMEZONE = 'Asia/Tokyo';
export const DEFAULT_REVIEW_SAMPLE_LIMIT = 12;
export const MIN_REVIEW_SAMPLE_LIMIT = 3;
export const MAX_REVIEW_SAMPLE_LIMIT = 20;
export const DEFAULT_OPENROUTER_MAX_TOKENS = 3200;
export const DEFAULT_OPENROUTER_WEB_MAX_RESULTS = 3;
export const MAX_OPENROUTER_WEB_MAX_RESULTS = 3;
export const PLACES_API_TIMEOUT_MS = 10000;
export const OPENROUTER_API_TIMEOUT_MS = 30000;

export const ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    placeName: { type: 'string' },
    address: { type: 'string' },
    // Keep for backward compatibility. The app computes the final score deterministically.
    sakuraScore: { type: 'integer', minimum: 0, maximum: 100 },
    estimatedRealRating: { type: 'number' },
    googleRating: { type: 'number' },
    tabelogRating: { type: ['number', 'null'] },
    verdict: { type: 'string', enum: ['安全', '注意', '危険'] },
    componentSignals: {
      type: 'object',
      additionalProperties: false,
      properties: {
        reviewTextRisk: { type: 'integer', minimum: 0, maximum: 100 },
        fakePraiseRisk: { type: 'integer', minimum: 0, maximum: 100 },
        externalComplaintRisk: { type: 'integer', minimum: 0, maximum: 100 },
        priceOpacityRisk: { type: 'integer', minimum: 0, maximum: 100 },
        catchSalesRisk: { type: 'integer', minimum: 0, maximum: 100 },
        billingTroubleRisk: { type: 'integer', minimum: 0, maximum: 100 },
        starPatternRiskObservation: { type: 'integer', minimum: 0, maximum: 100 },
        criticalComplaintCount: { type: 'integer', minimum: 0, maximum: 50 },
        explicitBillingComplaintCount: { type: 'integer', minimum: 0, maximum: 50 },
        recentLowStarBillingComplaintCount: { type: 'integer', minimum: 0, maximum: 50 },
      },
      required: [
        'reviewTextRisk',
        'fakePraiseRisk',
        'externalComplaintRisk',
        'priceOpacityRisk',
        'catchSalesRisk',
        'billingTroubleRisk',
        'starPatternRiskObservation',
        'criticalComplaintCount',
        'explicitBillingComplaintCount',
        'recentLowStarBillingComplaintCount',
      ],
    },
    evidence: {
      type: 'array',
      maxItems: 12,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          category: {
            type: 'string',
            enum: [
              'billing_trouble',
              'price_opacity',
              'catch_sales',
              'fake_praise',
              'review_distribution',
              'rating_gap',
              'external_reputation',
              'low_information',
              'place_exception',
              'other',
            ],
          },
          severity: { type: 'integer', minimum: 0, maximum: 100 },
          source: {
            type: 'string',
            enum: ['google_review_sample', 'external_site', 'model', 'deterministic_rule', 'place_metadata'],
          },
          snippet: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['category', 'severity', 'source', 'description'],
      },
    },
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
    reviewDistributionSource: {
      type: 'string',
      enum: ['google_aggregate', 'google_review_sample', 'external_site', 'model_estimated', 'unavailable'],
    },
  },
  required: [
    'placeName',
    'address',
    'sakuraScore',
    'verdict',
    'componentSignals',
    'evidence',
    'risks',
    'summary',
    'reviewDistribution',
    'reviewDistributionSource',
  ],
} as const;

export const SYSTEM_PROMPT = `
あなたは飲食店レビューのリスクシグナル抽出エンジンです。
最終的なサクラ危険度スコアはアプリ側の決定的ロジックで算出されます。
あなたの役割は、レビュー本文・外部評判・評価乖離・文体・料金トラブルの根拠を構造化して抽出することです。
必ずJSONのみで返答してください。誇張や断定を避け、根拠ベースで評価してください。

以下を強く区別してください。

1. 明確な会計・料金トラブル
   - ぼったくり
   - 詐欺
   - 高額請求
   - 会計がおかしい
   - メニュー価格と違う
   - 説明なしのチャージ
   - 勝手に請求
   - 客引きに連れて行かれた

2. 一般的な不満
   - 接客が悪い
   - 遅い
   - 味が悪い
   - うるさい
   - 混んでいる

一般的な不満だけでは高リスクにしないでください。
「お通し」「チャージ」「サービス料」は、日本の居酒屋・バーでは通常慣行の場合があります。
それ単体では高リスクにせず、「説明なし」「勝手に」「高額」「メニューにない」「会計時に初めて判明」などと共起する場合に強い料金トラブルとして扱ってください。

チェーン店・ファストフード・カフェ・大衆店では、Google評価と食べログ評価の乖離や短文高評価レビューが自然に発生することがあります。
それだけでサクラやぼったくりと断定しないでください。

高級店・寿司・バー・コース料理店では、価格が高いこと自体はリスクではありません。
価格説明の不足、会計の不一致、客引き、強制注文などがある場合のみ強いリスクとして扱ってください。

reviewDistribution は、実データがない場合は model_estimated とし、推定であることを明示してください。
推定分布を強い根拠にしないでください。

食べログ評価は圧縮スケールであるため、Googleと単純比較しないでください。
- 3.0未満はかなり低評価（Googleの1〜2台相当）
- 3.0〜3.2は低〜並
- 3.3〜3.5は良店
- 3.6以上は有名店クラス（上位層）

出力ルール:
- tabelogRating は「見つかった食べログの生値」を返す（不明なら null）
- estimatedRealRating は「外部サイト補正後のGoogle換算実力値(1.0〜5.0)」を返す
- tabelogRating は tabelog.com を参照確認できた場合のみ返し、確認できない場合は null にする
- sakuraScore は互換性のため返すが、最終判定には使われない可能性がある
- componentSignals と evidence を丁寧に返す
- 料金・会計・客引きに関する具体的な苦情がある場合は evidence に入れる
- 単なる高価格、不味い、接客不満だけで billing_trouble にしない
- reviewDistributionSource を必ず返す
`.trim();
