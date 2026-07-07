# ApplyFlow アーキテクチャ設計書 v0.1

## 1. 目的

本書は、ApplyFlow
のシステム構成、技術スタック、責務分担、認証方式、データフロー、外部API連携方針、デプロイ構成を定義する。

ApplyFlow
は、就活・転職・インターン・業務委託案件応募における、応募先・選考フェーズ・候補日時・返信待ち・承諾期限・日程衝突を管理するWebアプリケーションである。

本設計では、以下の方針を採用する。

-   v0.1では外部カレンダー・Gmailに依存しない
-   v0.2でGoogle Calendar Readonly連携を追加する
-   v1.0でGmail連携とAI抽出を追加する
-   初期開発では完成可能性を優先する
-   将来拡張を妨げない構造にする

------------------------------------------------------------------------

## 2. 全体アーキテクチャ

### 2.1 v0.1 構成

``` txt
User Browser
   |
   | HTTPS
   v
Next.js App Router
   |
   | Server Actions / Route Handlers
   v
Application Service Layer
   |
   | Prisma Client
   v
PostgreSQL
```

### 2.2 v0.2 構成

``` txt
User Browser
   |
   v
Next.js App Router
   |
   | Auth.js
   v
Google OAuth
   |
   v
Google Calendar API readonly
   |
   v
ApplyFlow Calendar View
```

### 2.3 v1.0 構成

``` txt
User Browser
   |
   v
Next.js App Router
   |
   | Auth.js
   v
Google OAuth
   |
   v
Gmail API
   |
   v
Email Import Service
   |
   v
AI Extraction Service
   |
   v
User Confirmation UI
   |
   v
PostgreSQL
```

------------------------------------------------------------------------

## 3. 技術スタック

## 3.1 Frontend

  技術              用途
  ----------------- ------------------------------
  Next.js           Webアプリケーション基盤
  React             UI構築
  TypeScript        型安全性
  Tailwind CSS      スタイリング
  shadcn/ui         UIコンポーネント
  FullCalendar      カレンダー表示
  React Hook Form   フォーム管理
  Zod               入力バリデーション
  TanStack Query    クライアント側データ取得管理

## 3.2 Backend

  技術                     用途
  ------------------------ ----------------------------
  Next.js Route Handlers   APIエンドポイント
  Server Actions           フォーム送信・サーバー処理
  Prisma                   ORM
  PostgreSQL               メインDB
  Auth.js                  認証

## 3.3 External Services

  サービス                  用途                 導入フェーズ
  ------------------------- -------------------- --------------
  Google OAuth              ログイン             v0.1
  Google Calendar API       予定読み取り         v0.2
  Gmail API                 メール読み取り       v1.0
  OpenAI API / Gemini API   メール本文の構造化   v1.0

## 3.4 Infrastructure

  技術              用途
  ----------------- -----------------------------
  Vercel            フロントエンド・APIデプロイ
  Neon / Supabase   PostgreSQLホスティング
  Docker            ローカル開発環境
  GitHub Actions    CI
  Sentry            エラー監視
  PostHog           利用状況分析

------------------------------------------------------------------------

## 4. アプリケーション構成

### 4.1 推奨ディレクトリ構成

``` txt
applyflow/
  app/
    (auth)/
      login/
    (dashboard)/
      dashboard/
      applications/
      applications/[id]/
      calendar/
      deadlines/
      settings/
    api/
      auth/
      calendar/
      gmail/
  components/
    ui/
    layout/
    calendar/
    application/
    interview/
    deadline/
  features/
    applications/
      actions.ts
      queries.ts
      schema.ts
      types.ts
      components/
    interviews/
    proposed-slots/
    deadlines/
    conflict-detection/
    activity-logs/
  lib/
    auth.ts
    prisma.ts
    google.ts
    validation.ts
    date.ts
  prisma/
    schema.prisma
    migrations/
  tests/
```

### 4.2 設計方針

-   `app/` はルーティング中心
-   `features/` にドメイン単位の処理を置く
-   `components/` は再利用UIを置く
-   `lib/` は横断的な技術処理を置く
-   DBアクセスは Prisma 経由に統一する
-   日程衝突などのビジネスロジックは `features/conflict-detection/`
    に分離する

------------------------------------------------------------------------

## 5. レイヤー構成

``` txt
Presentation Layer
  - Page
  - Component
  - Form

Application Layer
  - Server Actions
  - Route Handlers
  - Use Case Functions

Domain Layer
  - Entity Types
  - Status Transition
  - Conflict Detection
  - Deadline Evaluation

Infrastructure Layer
  - Prisma
  - Auth.js
  - Google APIs
  - AI API
```

### 5.1 Presentation Layer

責務：

-   画面表示
-   入力フォーム
-   カレンダー表示
-   ユーザー操作の受付

### 5.2 Application Layer

責務：

-   ユースケース実行
-   認可チェック
-   入力バリデーション
-   DB更新
-   外部API呼び出し

### 5.3 Domain Layer

責務：

-   状態遷移
-   日程衝突判定
-   期限警告判定
-   応募ステータス判定

### 5.4 Infrastructure Layer

責務：

-   DBアクセス
-   OAuth
-   Google API連携
-   AI API連携

------------------------------------------------------------------------

## 6. 認証・認可設計

### 6.1 認証方式

Auth.js を使用し、Google OAuth によるログインを行う。

v0.1ではログイン用途の最小スコープを使用する。

想定スコープ：

``` txt
openid
email
profile
```

v0.2以降で Google Calendar Readonly のスコープを追加する。

``` txt
https://www.googleapis.com/auth/calendar.readonly
```

v1.0で Gmail 読み取り用スコープを検討する。

``` txt
https://www.googleapis.com/auth/gmail.readonly
```

### 6.2 認可方針

すべての主要データは `userId` を持つ。

ユーザーは自分の `userId` に紐づくデータのみ参照・編集できる。

認可チェックは以下で実施する。

-   Server Actions
-   Route Handlers
-   Prisma query 条件

例：

``` ts
where: {
  id: applicationId,
  userId: session.user.id
}
```

------------------------------------------------------------------------

## 7. データフロー

## 7.1 応募先作成

``` txt
User
  -> Application Create Form
  -> Zod Validation
  -> Server Action
  -> Auth Check
  -> Prisma
  -> PostgreSQL
  -> Redirect to Application Detail
```

## 7.2 候補日時登録

``` txt
User
  -> Proposed Slot Form
  -> Zod Validation
  -> Server Action
  -> Auth Check
  -> Conflict Detection
  -> Prisma Transaction
  -> PostgreSQL
  -> Calendar Refresh
```

## 7.3 候補日時確定

``` txt
User
  -> Confirm Proposed Slot
  -> Server Action
  -> Auth Check
  -> Prisma Transaction
      - selected slot: confirmed
      - interview: confirmed
      - other slots: rejected / cancelled
      - activity log created
  -> PostgreSQL
```

## 7.4 衝突検知

``` txt
New ProposedSlot
  -> Fetch existing confirmed interviews
  -> Fetch existing pending proposed slots
  -> Compare time ranges
  -> Return warnings
```

v0.2では比較対象に Google Calendar events を追加する。

------------------------------------------------------------------------

## 8. 衝突検知設計

### 8.1 対象

v0.1:

-   ProposedSlot vs ProposedSlot
-   ProposedSlot vs Confirmed Interview
-   Confirmed Interview vs Confirmed Interview

v0.2:

-   ProposedSlot vs Google Calendar Event
-   Confirmed Interview vs Google Calendar Event

### 8.2 時間重複判定

2つの予定A/Bについて、以下の場合に衝突と判定する。

``` txt
A.startAt < B.endAt AND B.startAt < A.endAt
```

### 8.3 衝突の重大度

  種別                     重大度   説明
  ------------------------ -------- ----------------------------
  confirmed vs confirmed   high     確定予定同士の衝突
  pending vs confirmed     medium   提示中候補と確定予定の衝突
  pending vs pending       low      複数社に同じ候補を提示中

### 8.4 登録制御

v0.1では衝突があっても登録可能とする。

ただし、警告を表示し、ユーザーに明示する。

理由：

-   候補日時は未確定である
-   複数社に同一候補を提示する運用もあり得る
-   強制ブロックはUXを悪化させる

------------------------------------------------------------------------

## 9. 状態遷移設計

### 9.1 Interview Status

``` txt
draft
  -> proposed
  -> waiting_reply
  -> confirmed
  -> completed

waiting_reply
  -> expired

waiting_reply
  -> cancelled

confirmed
  -> cancelled
```

### 9.2 ProposedSlot Status

``` txt
pending
  -> confirmed

pending
  -> rejected

pending
  -> expired

pending
  -> cancelled
```

### 9.3 方針

状態は文字列で自由入力させず、enumで管理する。

状態遷移はUI上の操作とサーバー側ロジックで制御する。

------------------------------------------------------------------------

## 10. Google Calendar連携設計（v0.2）

### 10.1 方針

v0.2では Google Calendar の読み取りのみを行う。

予定の作成・更新・削除は行わない。

理由：

-   OAuthスコープを最小化する
-   ユーザーのカレンダーを破壊しない
-   実装難度を抑える
-   ポートフォリオとしては読み取り＋衝突検知で十分価値がある

### 10.2 取得対象

-   Primary calendar
-   指定期間内のイベント
-   デフォルトでは当月〜翌月程度

### 10.3 利用用途

-   ApplyFlowカレンダーへの表示
-   ApplyFlow内候補日時との衝突検知

### 10.4 保存方針

Google Calendarイベントは原則DBに永続保存しない。

必要に応じて一時キャッシュする場合は、以下のみ保存する。

-   externalEventId
-   startAt
-   endAt
-   summary
-   calendarId
-   fetchedAt

------------------------------------------------------------------------

## 11. Gmail連携設計（v1.0）

### 11.1 方針

Gmail連携は自動監視ではなく、ユーザー操作を起点とする。

``` txt
ユーザーがメール検索
  -> 対象メールを選択
  -> 本文取得
  -> AI抽出
  -> 確認画面
  -> 登録
```

### 11.2 自動登録しない理由

-   メール本文の誤抽出リスクがある
-   日時解釈の誤りが致命的になり得る
-   プライバシー上の不信感が強い
-   ユーザー確認を挟む方が安全

### 11.3 Gmail検索条件例

``` txt
面接
日程調整
候補日
カジュアル面談
選考
内定
承諾期限
from:recruit
```

### 11.4 抽出対象

-   会社名
-   応募職種
-   選考フェーズ
-   候補日時
-   確定日時
-   返信期限
-   承諾期限
-   面談URL
-   担当者名
-   メール件名
-   メールスレッドID

------------------------------------------------------------------------

## 12. AI抽出設計（v1.0）

### 12.1 処理フロー

``` txt
Email Body
  -> Preprocess
  -> AI Extraction
  -> JSON Schema Validation
  -> Confidence Score
  -> User Confirmation
  -> Create Application / Interview / ProposedSlot
```

### 12.2 出力JSON例

``` json
{
  "companyName": "株式会社サンプル",
  "position": "Webエンジニア",
  "stage": "first_interview",
  "status": "waiting_reply",
  "proposedSlots": [
    {
      "startAt": "2026-07-12T19:00:00+09:00",
      "endAt": "2026-07-12T20:00:00+09:00"
    }
  ],
  "replyDeadline": "2026-07-10T12:00:00+09:00",
  "meetingUrl": "https://meet.google.com/example",
  "confidence": 0.86
}
```

### 12.3 バリデーション

-   JSON Schema または Zod で検証する
-   日時はタイムゾーン付きISO文字列に正規化する
-   confidence が低い項目はUIで警告する
-   不足項目はユーザーに入力させる

------------------------------------------------------------------------

## 13. API設計方針

### 13.1 基本方針

Next.js Server Actionsを優先する。

外部API連携やWebhook的処理にはRoute Handlersを利用する。

### 13.2 主なServer Actions

-   createApplication
-   updateApplication
-   deleteApplication
-   createSelectionStage
-   updateSelectionStage
-   createInterview
-   updateInterviewStatus
-   createProposedSlot
-   confirmProposedSlot
-   createDeadline
-   createActivityLog

### 13.3 主なRoute Handlers

-   `/api/auth/*`
-   `/api/calendar/events`
-   `/api/gmail/search`
-   `/api/gmail/import`
-   `/api/ai/extract-email`

------------------------------------------------------------------------

## 14. エラーハンドリング

### 14.1 方針

-   ユーザー起因エラーは画面上に明示する
-   システム起因エラーはSentryに送信する
-   外部APIエラーはリトライせず、ユーザーに再実行を促す

### 14.2 代表的なエラー

  エラー               対応
  -------------------- -----------------------
  未認証               ログイン画面へ誘導
  認可エラー           403表示
  入力不備             フォーム上に表示
  DBエラー             汎用エラー表示 + ログ
  Google API認可切れ   再連携を促す
  AI抽出失敗           手動入力へ誘導

------------------------------------------------------------------------

## 15. ログ・監査

### 15.1 ActivityLog

ユーザー操作の履歴を保存する。

対象：

-   応募先作成
-   応募ステータス変更
-   選考フェーズ追加
-   候補日時追加
-   候補日時確定
-   面談キャンセル
-   期限追加
-   辞退
-   不採用登録

### 15.2 技術ログ

-   Sentryで例外監視
-   PostHogで画面遷移・主要イベントを分析

------------------------------------------------------------------------

## 16. セキュリティ設計

### 16.1 基本方針

-   最小権限
-   ユーザーごとのデータ分離
-   認証必須
-   サーバー側認可チェック
-   APIキーは環境変数管理

### 16.2 Google APIスコープ

v0.1:

``` txt
openid
email
profile
```

v0.2:

``` txt
calendar.readonly
```

v1.0:

``` txt
gmail.readonly
```

### 16.3 注意点

Gmail連携はユーザーの機密情報に触れるため、公開アプリ化する場合はOAuth審査・プライバシーポリシー・データ取扱説明が必要になる可能性がある。

ポートフォリオ段階では、限定ユーザー向けのテスト運用を想定する。

------------------------------------------------------------------------

## 17. デプロイ構成

### 17.1 本番構成

``` txt
GitHub
  -> GitHub Actions
  -> Vercel
  -> Neon / Supabase PostgreSQL
```

### 17.2 環境

-   local
-   preview
-   production

### 17.3 環境変数

``` txt
DATABASE_URL
NEXTAUTH_SECRET
AUTH_GOOGLE_ID
AUTH_GOOGLE_SECRET
GOOGLE_CALENDAR_API_KEY
OPENAI_API_KEY
SENTRY_DSN
POSTHOG_KEY
```

------------------------------------------------------------------------

## 18. CI/CD

### 18.1 CI

GitHub Actionsで以下を実行する。

-   install
-   lint
-   typecheck
-   test
-   prisma generate
-   build

### 18.2 CD

mainブランチへのマージでVercelへ自動デプロイする。

------------------------------------------------------------------------

## 19. テスト方針

### 19.1 Unit Test

対象：

-   衝突検知ロジック
-   状態遷移ロジック
-   日付正規化
-   Zod schema

### 19.2 Integration Test

対象：

-   応募先作成
-   候補日時登録
-   候補日時確定
-   期限登録

### 19.3 E2E Test

対象：

-   ログイン後、応募先を作成する
-   候補日時を登録する
-   カレンダーで確認する
-   衝突警告を確認する

------------------------------------------------------------------------

## 20. 今後の拡張方針

### v0.2

-   Google Calendar readonly連携
-   Google Calendar予定との衝突検知

### v1.0

-   Gmail連携
-   AI抽出
-   確認画面経由の登録

### v1.1以降

-   通知・リマインダー
-   面接フィードバック管理
-   オファー比較
-   職務経歴書管理
-   Outlook Calendar連携
-   Slack / Discord通知
-   モバイル最適化

------------------------------------------------------------------------

## 21. 設計上の重要判断

### 21.1 Google Calendarはv0.2に後回し

理由：

-   v0.1の完成可能性を上げる
-   コア機能は外部連携なしでも検証可能
-   外部API依存で初期開発が止まることを避ける

### 21.2 Gmail連携はv1.0に後回し

理由：

-   OAuthスコープが重い
-   プライバシー説明が必要
-   AI抽出の誤り対策が必要
-   最初に取り組むと未完成リスクが高い

### 21.3 Applicationを中心に設計する

理由：

-   同一企業に複数ポジションで応募できる
-   選考プロセスは企業ではなく応募単位で進行する
-   期限・面談・フェーズも応募単位に紐づく

### 21.4 衝突は警告に留める

理由：

-   候補日は未確定である
-   同じ候補を複数社に提示することは現実にあり得る
-   強制ブロックは運用を阻害する

------------------------------------------------------------------------

## 22. まとめ

ApplyFlow のアーキテクチャは、Next.js + PostgreSQL + Prisma + Auth.js
を中心としたシンプルなWebアプリ構成とする。

v0.1では外部APIに依存せず、応募・選考・候補日時・期限・衝突検知というコアドメインを完成させる。

v0.2でGoogle Calendar
readonly連携を追加し、v1.0でGmail連携とAI抽出を追加する。

この段階的設計により、完成可能性を担保しつつ、ポートフォリオとして評価されやすい外部API連携・AI構造化・状態管理・衝突検知まで拡張できる。
