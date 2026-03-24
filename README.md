# FocusFlow

ADHD 特性に寄り添う、完全クライアントサイドのタスク管理 Web アプリです。

## セットアップ

```bash
npm install
npm run dev
```

## 現在の実装範囲

- Next.js 14 (App Router) + TypeScript + Tailwind CSS
- Dexie.js による IndexedDB スキーマ
- 初期カテゴリ、タスク分解テンプレート、朝ルーティン、通知設定の投入
- `next-pwa` を使った PWA 設定
- オフラインページ、Web App Manifest、アイコンの土台

## デプロイ

静的出力を前提に `next.config.mjs` で `output: "export"` を有効にしています。
