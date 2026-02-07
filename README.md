# Googleぼったくりチェッカー

Googleマップの店舗情報をもとに、レビューの信頼性とぼったくりリスクを推定するWebアプリです。  
UIはシンプルなまま維持し、分析処理は Cloudflare Workers 経由で実行します。

## 変更後アーキテクチャ

- フロント: React + TypeScript + Vite
- APIゲートウェイ: Cloudflare Workers
- 店舗情報: Google Places API (Text Search / Place Details)
- AI分析: OpenRouter (`google/gemini-3-flash-preview`)
- キャッシュ/制限: Cloudflare KV (24時間キャッシュ、レート制限、日次予算制御)
- 広告: Google AdSense（非連動バナー1枠）

## 機能

- Google評価と外部評判の乖離をAIで分析
- ぼったくり危険度スコア（0〜100）を表示
- 判定詳細、評価分布、検出キーワードを表示
- 参照ソースURLを表示
- 24時間キャッシュで同一検索コストを抑制

## セキュリティ/コスト制御

- APIキーはすべて Worker secrets に保存（フロントへ露出しない）
- CORSのOrigin許可リスト
- 入力クエリ検証（2〜80文字）
- IPハッシュベースのレート制限
- 日次予算上限による新規分析停止

## ディレクトリ構成

```text
bottakuri_check/
├── components/
├── services/
│   └── apiService.ts
├── worker/
│   ├── src/index.ts
│   ├── wrangler.toml
│   ├── .dev.vars.example
│   └── README.md
├── App.tsx
├── types.ts
└── vite.config.ts
```

## セットアップ

### 1. フロントエンド

```bash
npm install
```

必要に応じて `.env.local` を作成します。

```bash
VITE_API_BASE_URL=/api
VITE_API_PROXY_TARGET=http://127.0.0.1:8787
VITE_ADSENSE_CLIENT_ID=ca-pub-xxxxxxxxxxxxxxxx
VITE_ADSENSE_SLOT_ID=1234567890
```

本番で Worker を別ドメイン運用する場合は、`VITE_API_BASE_URL` を Worker のURLに設定します。

```bash
VITE_API_BASE_URL=https://bottakuri-check-api.steep-wood-db4a.workers.dev/api
```

### 2. Worker API

```bash
cd worker
npm install
```

KV namespace を作成して `worker/wrangler.toml` に反映します。

```bash
npx wrangler kv:namespace create APP_KV
npx wrangler kv:namespace create APP_KV --preview
```

シークレットを設定します。

```bash
npx wrangler secret put OPENROUTER_API_KEY
npx wrangler secret put GOOGLE_PLACES_API_KEY
```

`worker/.dev.vars.example` を参考に `worker/.dev.vars` を作成するとローカル実行時に使えます。

## 起動方法（ローカル）

ターミナル1:

```bash
npm run dev:api
```

ターミナル2:

```bash
npm run dev
```

フロント: `http://localhost:3000`  
Worker: `http://127.0.0.1:8787`

## 本番デプロイ手順（Cloudflare）

### 1) Worker APIをデプロイ

```bash
cd worker
npx wrangler deploy
```

### 2) フロントをビルドしてPagesへデプロイ

```bash
cd ..
npm run build
npx wrangler pages deploy dist --project-name bottakuri-check
```

### 3) 接続確認

```bash
curl -s https://bottakuri-check-api.steep-wood-db4a.workers.dev/api/health
curl -I https://bottakuri-check.pages.dev
```

## API

### `POST /api/analyze`

Request:

```json
{
  "query": "新宿 居酒屋 ○○",
  "location": { "lat": 35.69, "lng": 139.70 }
}
```

Error:

```json
{
  "error": {
    "code": "BUDGET_EXCEEDED",
    "message": "本日の新規分析上限に達しました。"
  }
}
```

### `GET /api/health`

Workerの稼働状態、制限値、当日メトリクスを返します。

## スクリプト

- `npm run dev`: フロント開発サーバー
- `npm run dev:api`: Workerローカル実行
- `npm run build`: フロントビルド
- `npm run build:api`: Workerのdry-runビルド
- `npm run preview`: フロントプレビュー

## 注意事項

- AI判定結果は参考情報です。最終判断は必ず利用者が行ってください。
- 広告は判定ロジックに影響しません。
