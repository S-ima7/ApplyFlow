# ApplyFlow

ApplyFlowは、就職・転職活動の応募先、選考フェーズ、面談候補、期限、返信待ちを一元管理する選考CRMです。Google Calendarとの予定照合・取り込み、Gmail検索・定期監視、AIによる応募情報抽出にも対応します。

## 主な機能

- 応募先・企業・選考フェーズの管理
- 面談候補日時、確定面談、返信待ちの管理
- 返信期限、承諾期限、提出期限の管理
- アプリ内予定とGoogle Calendar予定の統合表示・衝突検知
- Google Calendar予定のApplyFlowへの個別・一括取り込み
- 確定面談のGoogle Primary Calendarへの明示登録
- Gmailの検索・本文取得
- Gmail検索条件に合う新着メールを15分間隔で監視
- メールから会社名、イベント種別、選考フェーズ、日時、期限、面談URLなどをAI抽出
- 一意な既存応募に対する高信頼な変更だけを自動反映し、それ以外を確認待ちに保留
- 手動Gmail取込は高信頼な正常系を自動反映し、例外だけ項目別信頼度・根拠を確認して登録
- 転職サイトの求人詳細を確認後に登録するChrome拡張機能
- 転職サイトの企業メッセージから面接の確定・候補・変更・取消を確認登録
- メッセージから会社名・ポジションも抽出し、既存応募先の統合または新規作成
- PC向けサイドバーとスマートフォン向けボトムナビゲーション
- iPhone 14以降のSafari表示とホーム画面から起動できるPWA

## 技術スタック

- Next.js 15 App Router / React 19 / TypeScript
- Tailwind CSS 4 / ローカルUIコンポーネント
- Auth.js / Google OAuth
- Prisma / PostgreSQL
- FullCalendar
- Cloudflare Workers AI REST API / `@cf/openai/gpt-oss-120b`
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
AI_PROVIDER=cloudflare-workers-ai
AI_MODEL=@cf/openai/gpt-oss-120b
AI_REASONING_EFFORT=high
AI_DAILY_NEURON_BUDGET=10000
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_API_TOKEN=
EMAIL_MONITOR_WORKER_SECRET=
```

Google Cloud側では、OAuthクライアントに加えてGoogle Calendar APIとGmail APIを有効化します。アプリが要求するスコープは次のとおりです。

- `openid email profile`
- `https://www.googleapis.com/auth/calendar.readonly`
- `https://www.googleapis.com/auth/calendar.events.owned`
- `https://www.googleapis.com/auth/gmail.readonly`

Google Calendarへの書き込みは、利用者が応募詳細で確定面談の登録ボタンを押した場合だけ行います。既存利用者は追加権限を許可するため、設定画面から再ログインしてください。Gmailへの書き込みは行いません。

Cloudflare Dashboardで **Workers AI → Use REST API → Create a Workers AI API Token** を選び、`CLOUDFLARE_ACCOUNT_ID` と `CLOUDFLARE_API_TOKEN` を設定してください。手動作成するtokenには `Workers AI - Read` と `Workers AI - Edit` の両方を付与します。詳しくは[Cloudflare Workers AI REST APIの公式手順](https://developers.cloudflare.com/workers-ai/get-started/rest-api/)を参照してください。ApplyFlowは有料AI APIへフォールバックしません。

## Netlify / Neonデプロイ

無料構成ではNetlify Scheduled Functionが15分ごとにGmail監視用Background Functionを起動します。Neonでは`DATABASE_URL`にpooled URL、`DIRECT_URL`にdirect URLを設定します。CloudflareはWorkers Freeのまま運用し、Workers Paidへアップグレードしません。Workers AI Freeの1日10,000 Neuronsに達した場合やCloudflareから429が返った場合は、課金せず残件を翌日以降へ繰り越します。使用量は[Cloudflare Workers AIの料金・使用量ページ](https://developers.cloudflare.com/workers-ai/platform/pricing/)で確認してください。

本番ビルドからDB migrationは実行しません。デプロイ前の明示的なrelease stepとして実行してください。

```bash
npm run prisma:migrate:deploy
npm run build
```

既存DBの移行、OAuth redirect URI、無料枠の確認、ロールバックは[デプロイ・移行手順](docs/ApplyFlow_Netlify_Neonデプロイ手順.md)を参照してください。

## iPhone Safari / PWA

本番のHTTPS URLをiPhone Safariで開き、共有メニューの「ホーム画面に追加」を選ぶと、ApplyFlowをホーム画面から起動できます。対象はiPhone 14以降の、サポート中の最新iOS Safariです。

PWAはオンライン前提です。Service Workerは認証済み画面やAPIレスポンスをキャッシュしないため、通信できない場合はSafari版と同様にデータを参照・更新できません。Chrome拡張機能はiOS Safariでは利用できません。

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
- Gmail本文と企業メッセージ本文はCloudflare Workers AI上の`@cf/openai/gpt-oss-120b`へ一時送信します。ApplyFlowはメール本文をCloudflareの保存サービスへ保存せず、生本文をDBやログへも保存しません。
- 企業メッセージは利用者が選択して同意した本文だけをAI抽出時に送信し、生本文はDBへ保存しません。
- Google Calendarから取り込んだ予定はApplyFlow所有のスナップショットとして保存します。利用者のタイムゾーンにおける今月初日から翌月末までを一括取り込みでき、再取り込み時は同じ外部イベントを最新情報へ更新して重複作成しません。削除済みの同じ予定は、明示的な再取り込みによって再表示されます。
- Google Calendarへ登録する確定面談は、利用者と面談IDから生成した決定的なイベントIDで重複作成を防ぎます。自動登録、更新・削除同期は行いません。

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
- [iPhone Safari / PWA設計契約](docs/ApplyFlow_iPhone_PWA設計契約.md)
- [Google Calendar登録設計契約](docs/ApplyFlow_Google_Calendar登録設計契約.md)
- [ブラウザ拡張機能設計書](docs/ApplyFlow_ブラウザ拡張機能設計書.md)
- [メール監視・無料AIデプロイ設計契約](docs/ApplyFlow_メール監視デプロイ設計契約.md)
- [Netlify / Neonデプロイ・移行手順](docs/ApplyFlow_Netlify_Neonデプロイ手順.md)
