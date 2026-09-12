# v0.6 デプロイ記録

## デプロイ日時
2026年9月12日

## デプロイ手順

### 1. GitHub PR作成
- ブランチ: `cursor/add-v06-feature-history-f0f0`
- ベースブランチ: `main`
- リポジトリ: `sprintjapan-hq/HI-DO-RI`

### 2. 変更内容
- `artifacts/hidori/src/pages/feature-history.tsx` - v0.6カードを追加
- `docs/ops/feature-ship-pipeline.md` - 機能リリースパイプラインドキュメント
- `docs/releases/v0.6/01-spec.md` - 仕様書
- `docs/releases/v0.6/02-review.md` - レビュー記録
- `docs/releases/v0.6/03-preview-test.md` - プレビューテスト仕様
- `docs/releases/v0.6/04-final-spec.md` - 最終仕様書
- `docs/releases/v0.6/05-history-note.md` - 履歴掲載内容
- `docs/releases/v0.6/06-deploy.md` - 本ドキュメント
- `docs/releases/v0.6/07-production-test.md` - 本番テスト記録

### 3. Replit Publish
**ステータス**: 待機中

Replit Publishは以下の手順で実施:
1. Replitにログイン（人手による操作）
2. Publishボタンをクリック
3. Cloudflare設定の確認

**注意**: 
- Replitログインおよび公開操作は人手で実施
- 夏本へのプロンプト転送やPublishクリック依頼は不要
- Cloudflare設定に関して人手のサポートが必要な場合のみ依頼

## デプロイ結果
（Replit Publishの完了後に更新）

## ロールバック手順
もし問題が発生した場合:
1. GitHubでPRをrevert
2. Replitで前のバージョンを再公開

## デプロイ後の確認事項
- [ ] `/feature-history` ページでv0.6カードが表示される
- [ ] 既存のv0.1〜v0.5カードが正常に表示される
- [ ] 自動公開リリースとの共存が正常に動作する
- [ ] モバイル・デスクトップ両方で適切に表示される
