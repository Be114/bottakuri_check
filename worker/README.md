# Worker API

Cloudflare Workers で `POST /api/analyze` と `GET /api/health` を提供します。  
Gemini 3 Flash は OpenRouter 経由で呼び出し、APIキーは Worker secret に保持します。

## セットアップ

1. 依存関係をインストール

```bash
cd worker
npm install
```

2. KV namespace を作成

```bash
npx wrangler kv:namespace create APP_KV
npx wrangler kv:namespace create APP_KV --preview
```

作成された `id` / `preview_id` を `worker/wrangler.toml` に設定します。

3. シークレットを設定

```bash
npx wrangler secret put OPENROUTER_API_KEY
npx wrangler secret put GOOGLE_PLACES_API_KEY
```

4. ローカル実行

```bash
npm run dev
```

## 環境変数

`worker/wrangler.toml` の `[vars]` で管理します。

- `ALLOWED_ORIGINS`: カンマ区切り許可オリジン
- `DAILY_BUDGET_USD`: 日次予算上限
- `WORST_CASE_COST_USD`: 1分析あたり想定最大コスト
- `CACHE_TTL_SECONDS`: 結果キャッシュTTL（秒）
- `PER_MINUTE_LIMIT`: IP単位の1分あたり制限
- `PER_DAY_NEW_ANALYSIS_LIMIT`: IP単位の1日新規分析上限
- `OPENROUTER_MAX_TOKENS`: 応答トークン上限
- `REVIEW_SAMPLE_LIMIT`: Placesレビューの参照件数（推奨: 8）
- `DAY_ROLLOVER_TIMEZONE`: 日次制限の切替タイムゾーン（例: `Asia/Tokyo`）
