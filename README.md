# HI-DO-RI（日どり）

HI-DO-RIは、主催者が候補日時を作成し、参加者がログインせずに「○・△・×」で回答できる日本語の日程調整アプリです。

主催者はClerkでログインして出欠表を管理できます。Googleカレンダーの空き時間確認、予定確定、Slackを利用した運営通知にも対応しています。

## 主な機能

- 日本語の条件から候補日時を生成
  - 日付範囲、平日・曜日、午前・午後・夜、時間範囲、枠の長さなどに対応
- URLを共有して参加者を募集
- 参加者はログインせずに「○・△・×」で回答
- 主催者向けマイページ
  - 出欠表の作成、編集、確認、日程確定
- Googleカレンダー連携
  - `calendar.freebusy` スコープによる空き時間確認
  - `calendar.events` 権限を既に持つ利用者のみ予定を書き込み
- 機能リクエストの受付と公開履歴
- 運営者向け開発状況管理とSlack通知
- プライバシーポリシー、OGP、レスポンシブ表示

## 利用者と認証

| 利用者 | ログイン | 主な操作 |
| --- | --- | --- |
| 主催者 | Clerk認証が必要 | 出欠表の作成・編集・確定、カレンダー連携 |
| 参加者 | 不要 | 共有URLから名前を入力して回答 |
| 運営者 | Clerk認証と運営者設定が必要 | 機能リクエストの開発状況管理 |

## 技術構成

- Node.js 24 / TypeScript
- pnpm workspace
- React / Vite / Wouter / TanStack Query
- Express
- PostgreSQL / Drizzle ORM
- Clerk
- Google Calendar API
- Slack
- Zod / OpenAPI / Orval

## ディレクトリ構成

```text
.
├── artifacts/
│   ├── hidori/          # Reactフロントエンド
│   ├── api-server/      # Express API
│   └── mockup-sandbox/  # UI検討用プレビュー
├── lib/
│   ├── api-client-react/ # 生成されたReact APIクライアント
│   ├── api-spec/         # OpenAPI仕様
│   ├── api-zod/          # 生成されたZodスキーマ
│   └── db/               # Drizzleスキーマとマイグレーション
└── scripts/              # ワークスペース用スクリプト
```

## セットアップ

### 必要なもの

- Node.js 24
- pnpm
- PostgreSQL
- Clerkアプリ

GoogleカレンダーとSlackの機能を使う場合は、それぞれの接続設定も必要です。ReplitではIntegrationsから接続します。

### 依存関係のインストール

```bash
pnpm install
```

### 環境変数

秘密情報はリポジトリへコミットせず、Replit Secretsなどの安全な方法で設定してください。

| 変数 | 必須 | 用途 |
| --- | --- | --- |
| `DATABASE_URL` | 必須 | PostgreSQL接続先 |
| `CLERK_PUBLISHABLE_KEY` | 必須 | API側のClerk設定 |
| `CLERK_SECRET_KEY` | 必須 | Clerkのサーバー認証 |
| `VITE_CLERK_PUBLISHABLE_KEY` | 必須 | フロントエンドのClerk設定 |
| `PORT` | API起動時に必須 | APIサーバーの待受ポート |
| `OPERATOR_USER_IDS` | 任意 | 運営者として扱うClerkユーザーID |
| `FEATURE_REQUEST_SLACK_CHANNEL_ID` | 任意 | 機能リクエスト通知先 |
| `LOG_LEVEL` | 任意 | APIログレベル |

`GOOGLE_CALENDAR_TEST_BASE_URL` と `GOOGLE_CALENDAR_TEST_TOKEN` はGoogleカレンダー連携テスト用です。本番アプリの通常起動には不要です。

## 開発

APIサーバーを起動します。

```bash
pnpm --filter @workspace/api-server run dev
```

別のターミナルでフロントエンドを起動します。

```bash
pnpm --filter @workspace/hidori run dev
```

Replitでは登録済みのWorkflowから両方を起動できます。

## データベース

スキーマ変更後にマイグレーションを生成します。

```bash
pnpm --filter @workspace/db run generate
```

内容を確認してから、対象環境へ明示的に適用します。

```bash
pnpm --filter @workspace/db run migrate
```

テストやAPI起動時に本番マイグレーションを自動実行しない設計です。

## 検証

全パッケージの型チェック:

```bash
pnpm run typecheck
```

型チェックとビルド:

```bash
pnpm run build
```

APIテスト:

```bash
pnpm --filter @workspace/api-server run test
```

APIテストの前には、読み取り専用のデータベーススキーマ確認が実行されます。

## Googleカレンダー権限

新規接続で要求する権限は、空き時間確認用の非機密スコープ `calendar.freebusy` のみです。

過去の接続ですでに `calendar.events` を持つ利用者については予定の書き込みを継続します。権限を持たない利用者でも、出欠表の作成や日程確定は失敗せず、カレンダーへの書き込みだけをスキップします。

## ライセンス

ライセンスは現在未指定です。利用・再配布条件が必要な場合は、公開前にライセンスファイルを追加してください。