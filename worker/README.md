# Worker API

Cloudflare Workers で `POST /api/analyze` と `GET /api/health` を提供します。  
Google Gemini 3.1 Flash Lite Preview は OpenRouter 経由で呼び出し、APIキーは Worker secret に保持します。

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

`worker/wrangler.toml.example` を `worker/wrangler.toml` にコピーし、作成された `id` / `preview_id` を設定します。
`wrangler.toml` はローカル設定ファイルとしてgit管理しません。

```bash
cp wrangler.toml.example wrangler.toml
```

`COUNTERS` Durable Object binding と `AtomicCounter` migration はexampleに含まれています。

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
- `CHAIN_STORE_KEYWORDS`: チェーン店判定キーワード（任意、カンマ区切り）

## 状態管理

- `APP_KV`: 分析結果キャッシュのみで使用します。
- `COUNTERS`: Durable Objectsでレート制限、予算制限、メトリクスを原子的に更新します。
