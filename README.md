# ApplyFlow

ApplyFlowは、就職・転職活動の応募先、選考フェーズ、面談候補、期限、返信待ちを一元管理する選考CRMです。Google Calendarとの予定照合・取り込み、Gmail検索・定期監視、AIによる応募情報抽出にも対応します。

## 主な機能

- 応募先・企業・選考フェーズの管理
- 面談候補日時、確定面談、返信待ちの管理
- 返信期限、承諾期限、提出期限の管理
- アプリ内予定とGoogle Calendar予定の統合表示・衝突検知
- Google Calendar予定のApplyFlowへの取り込み
- Gmailの検索・本文取得
- Gmail検索条件に合う新着メールを15分間隔で監視
- メールから会社名、イベント種別、選考フェーズ、日時、期限、面談URLなどをAI抽出
- 一意な既存応募に対する高信頼な変更だけを自動反映し、それ以外を確認待ちに保留
- AI抽出結果の項目別信頼度・根拠表示と、ユーザー確認後の登録
- 転職サイトの求人詳細を確認後に登録するChrome拡張機能
- 転職サイトの企業メッセージから面接の確定・候補・変更・取消を確認登録
- メッセージから会社名・ポジションも抽出し、既存応募先の統合または新規作成
- PC向けサイドバーとスマートフォン向けボトムナビゲーション

## 技術スタック

- Next.js 15 App Router / React 19 / TypeScript
- Tailwind CSS 4 / ローカルUIコンポーネント
- Auth.js / Google OAuth
- Prisma / PostgreSQL
- FullCalendar
- Groq Responses API / OpenAI gpt-oss-120b
- Netlify Functions / Neon PostgreSQL
- Vitest / ESLint

## ローカル起動

```bash
npm install
docker compose up -d
npm run prisma:migrate
npm run dev
```

`.env.example`を参考に`.env`または`.env.local`を設定してください。

## 必須環境変数

```env
DATABASE_URL=
DIRECT_URL=
AUTH_SECRET=
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=
AI_PROVIDER=groq
AI_MODEL=openai/gpt-oss-120b
AI_REASONING_EFFORT=high
AI_DAILY_TOKEN_BUDGET=180000
GROQ_API_KEY=
EMAIL_MONITOR_WORKER_SECRET=
```

Google Cloud側では、OAuthクライアントに加えてGoogle Calendar APIとGmail APIを有効化します。アプリが要求するスコープは次のとおりです。

- `openid email profile`
- `https://www.googleapis.com/auth/calendar.readonly`
- `https://www.googleapis.com/auth/gmail.readonly`

Google CalendarとGmailへの書き込みは行いません。

Groq Consoleでは本番利用前にZero Data Retentionを有効化してください。ApplyFlowは有料OpenAI APIへフォールバックしません。

## Netlify / Neonデプロイ

無料構成ではNetlify Scheduled Functionが15分ごとにGmail監視用Background Functionを起動します。Neonでは`DATABASE_URL`にpooled URL、`DIRECT_URL`にdirect URLを設定します。

本番ビルドからDB migrationは実行しません。デプロイ前の明示的なrelease stepとして実行してください。

```bash
npm run prisma:migrate:deploy
npm run build
```

既存DBの移行、OAuth redirect URI、無料枠の確認、ロールバックは[デプロイ・移行手順](docs/ApplyFlow_Netlify_Neonデプロイ手順.md)を参照してください。

## Chrome拡張機能

```bash
npm run extension:build
```

Chromeのデベロッパーモードで`browser-extension/dist`を読み込みます。対象媒体ページで拡張アイコンを開いて有効化すると、求人詳細には保存ボタン、それ以外のページには面接日時抽出ボタンを挿入します。保存・登録には、ApplyFlowの「設定 → ブラウザ拡張機能」で発行した専用トークンが必要です。媒体権限はGreen・dodaごとに任意付与します。

拡張機能は求人一覧の収集、自動巡回、自動応募、Cookie取得、媒体の内部API呼び出しを行いません。詳細は[ブラウザ拡張機能README](browser-extension/README.md)を参照してください。

## データ取り扱い

- Gmail本文はAI抽出時にのみ取得し、DBへ保存しません。
- DBにはGmail message ID、件名、送信者、受信日時、抽出結果を保存します。定期監視では本文断片となるsnippetも保存しません。
- Gmail監視では総合・変更対象フィールドconfidenceが90%以上で、一意な既存応募へ安全に反映できる場合だけ自動更新します。
- 新規応募、曖昧一致、取消、手入力データと競合する抽出結果は確認画面へ保留します。
- Gmail本文と企業メッセージ本文はGroq上のgpt-ossへ一時送信します。生本文はDBやログへ保存しません。
- 企業メッセージは利用者が選択して同意した本文だけをAI抽出時に送信し、生本文はDBへ保存しません。
- Google Calendarから取り込んだ予定はApplyFlow所有のスナップショットとして保存します。再取り込み時は同じ外部イベントを更新し、重複作成しません。

## 品質チェック

```bash
npm test
npm run typecheck
npm run lint
npm run build
```


詳細は以下を参照してください。

- [仕様書](docs/ApplyFlow_仕様書.md)
- [アーキテクチャ設計書](docs/ApplyFlow_アーキテクチャ設計書.md)
- [DB設計書](docs/ApplyFlow_DB設計書.md)
- [UI/UX設計書](docs/ApplyFlow_UIUX設計書.md)
- [ブラウザ拡張機能設計書](docs/ApplyFlow_ブラウザ拡張機能設計書.md)
- [メール監視・無料AIデプロイ設計契約](docs/ApplyFlow_メール監視デプロイ設計契約.md)
- [Netlify / Neonデプロイ・移行手順](docs/ApplyFlow_Netlify_Neonデプロイ手順.md)
