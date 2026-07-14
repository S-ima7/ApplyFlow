# ApplyFlow

ApplyFlowは、就職・転職活動の応募先、選考フェーズ、面談候補、期限、返信待ちを一元管理する選考CRMです。Google Calendarとの予定照合・取り込み、Gmail検索、AIによる応募情報抽出にも対応します。

## 主な機能

- 応募先・企業・選考フェーズの管理
- 面談候補日時、確定面談、返信待ちの管理
- 返信期限、承諾期限、提出期限の管理
- アプリ内予定とGoogle Calendar予定の統合表示・衝突検知
- Google Calendar予定のApplyFlowへの取り込み
- Gmailの検索・本文取得
- メールから会社名、選考フェーズ、日時、期限、面談URLなどをAI抽出
- AI抽出結果の項目別信頼度・根拠表示と、ユーザー確認後の登録
- PC向けサイドバーとスマートフォン向けボトムナビゲーション

## 技術スタック

- Next.js 15 App Router / React 19 / TypeScript
- Tailwind CSS 4 / ローカルUIコンポーネント
- Auth.js / Google OAuth
- Prisma / PostgreSQL
- FullCalendar
- OpenAI Responses API
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
AUTH_SECRET=
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
```

Google Cloud側では、OAuthクライアントに加えてGoogle Calendar APIとGmail APIを有効化します。アプリが要求するスコープは次のとおりです。

- `openid email profile`
- `https://www.googleapis.com/auth/calendar.readonly`
- `https://www.googleapis.com/auth/gmail.readonly`

Google Calendarへの書き込みは行いません。

## データ取り扱い

- Gmail本文はAI抽出時にのみ取得し、DBへ保存しません。
- DBにはGmail message ID、件名、送信者、スニペット、抽出結果を保存します。
- AI抽出結果は自動登録せず、必ず確認画面を経由します。
- Google Calendarから取り込んだ予定はApplyFlow所有のスナップショットとして保存します。再取り込み時は同じ外部イベントを更新し、重複作成しません。

## 品質チェック

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

実OpenAI APIを使う任意の抽出評価は、課金が発生するため通常テストから分離しています。

```powershell
$env:RUN_OPENAI_EVALS="1"
npm run test:ai-eval
```

詳細は以下を参照してください。

- [仕様書](docs/ApplyFlow_仕様書.md)
- [アーキテクチャ設計書](docs/ApplyFlow_アーキテクチャ設計書.md)
- [DB設計書](docs/ApplyFlow_DB設計書.md)
- [UI/UX設計書](docs/ApplyFlow_UIUX設計書.md)
