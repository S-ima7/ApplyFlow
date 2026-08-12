# ApplyFlow DB設計書 v1.4

更新日: 2026-07-27

## 1. 概要

PostgreSQLとPrismaを使用する。すべての業務データはUserを所有者とし、応募管理はApplicationを中心に構成する。

```text
User
 ├─ Company ─ Application
 │              ├─ SelectionStage ─ Interview ─ ProposedSlot
 │              ├─ Deadline
 │              ├─ ActivityLog
 │              ├─ ScheduleEvent (optional relation)
 │              └─ BrowserMessageImport ─ Interview (optional relation)
 ├─ ScheduleEvent
 ├─ EmailImport ─ AiExtractionResult ─ Application (optional relation)
 └─ BrowserExtensionToken
```

## 2. 認証モデル

### User

| 主なカラム | 型 | 説明 |
|---|---|---|
| id | String | cuid主キー |
| email | String? | unique |
| timezone | String | 既定値`Asia/Tokyo` |
| createdAt / updatedAt | DateTime | 作成・更新日時 |

### Account / Session / VerificationToken

Auth.js Prisma Adapter標準モデル。AccountにGoogle access token、refresh token、expires_at、scopeを保存する。

## 3. 応募管理モデル

### Company

ユーザー単位の企業。`userId`と`name`に検索用インデックスを持つ。同名企業を許容する。

### Application

| カラム | 必須 | 説明 |
|---|---:|---|
| userId / companyId | Yes | 所有者、企業 |
| position | Yes | 応募ポジション |
| applicationType / route | Yes | 応募種別、経路 |
| status / priority | Yes | 選考状態、優先度 |
| appliedAt / sourceUrl / note | No | 付加情報 |
| sourceSite / sourceJobId / sourceKey | No | ブラウザ拡張機能の媒体・求人識別子・重複キー |
| locationText / employmentTypeText / compensationText | No | 求人ページから確認後に保存した原文 |
| capturedAt / captureAdapterVersion | No | 抽出時刻・アダプターバージョン |
| captureIdempotencyKey | No | 拡張機能APIの冪等キー |
| deletedAt | No | 論理削除 |

`userId,status`、`userId,priority`、`companyId`、`deletedAt`にインデックスを持つ。
`(userId,sourceKey)`と`(userId,captureIdempotencyKey)`をuniqueとする。論理削除時は両キーをnullにし、同じ求人の再登録を許可する。

### BrowserExtensionToken

Chrome拡張機能専用のBearer Tokenを管理する。`tokenHash`にはSHA-256 digestだけを保存し、平文Tokenは発行直後に一度だけ表示する。`tokenPrefix`、`lastUsedAt`、任意の`expiresAt`、`revokedAt`を保持し、ユーザー単位で個別失効できる。

### BrowserMessageImport

企業メッセージから確認登録した面接イベントの重複防止レコード。`userId`、`applicationId`、任意の`interviewId`、`sourceSite`、`eventType`、`messageDigest`、`idempotencyKey`を保持する。メッセージ生本文やAI evidenceは保存しない。

`(userId,idempotencyKey)`と`(userId,applicationId,messageDigest)`をuniqueとする。Application削除時はcascadeし、Interview削除時は`interviewId`をnullにする。

### SelectionStage

応募ごとの選考フェーズ。`order`で表示順を管理する。Application削除時はcascadeする。

### Interview

SelectionStageに属する面談。確定日時、面談URL、場所、担当者を保持する。

### ProposedSlot

Interviewに属する候補日時。開始・終了、timezone、状態、登録元を保持する。

### Deadline

Applicationに属する期限。返信、承諾、提出、準備などを`DeadlineType`で区別する。

### ActivityLog

Applicationに関する状態変更や登録操作を記録する。業務履歴のため論理削除しない。

## 4. ScheduleEvent

ApplyFlow所有の汎用予定。現在はGoogle Calendarから明示的に取り込んだ予定を保存する。

| カラム | 型 | 必須 | 説明 |
|---|---|---:|---|
| id | String | Yes | cuid主キー |
| userId | String | Yes | 所有者 |
| applicationId | String? | No | 任意の応募先紐付け |
| source | ScheduleEventSource | Yes | `GOOGLE_CALENDAR` / `MANUAL` |
| externalCalendarId | String? | No | 外部カレンダーID |
| externalEventId | String? | No | 外部イベントID |
| title | String | Yes | 予定名 |
| description / location | String? | No | 説明、場所 |
| meetingUrl | String? | No | 面談URL |
| startAt / endAt | DateTime | Yes | UTC保存する日時 |
| startDate / endDate | String? | No | 終日予定の日付境界 |
| allDay | Boolean | Yes | 終日フラグ |
| timezone | String | Yes | 既定値`Asia/Tokyo` |
| externalUrl | String? | No | Google側URL |
| sourceUpdatedAt | DateTime? | No | Google側更新日時 |
| importedAt | DateTime | Yes | 最終取り込み日時 |
| deletedAt | DateTime? | No | 論理削除 |

一意制約:

```text
(userId, source, externalCalendarId, externalEventId)
```

この制約により、同じGoogle予定の再取り込みは新規作成ではなく更新になる。Application削除時はScheduleEvent自体を残し、`applicationId`をnullにする。

## 5. メール取り込みモデル

### EmailImport

| カラム | 必須 | 説明 |
|---|---:|---|
| userId | Yes | 所有者 |
| gmailMessageId | Yes | Gmail message ID |
| gmailThreadId | No | Gmail thread ID |
| subject / fromAddress / snippet | No | メタデータ |
| sentAt / importedAt | No/Yes | 送信・取込日時 |

`(userId,gmailMessageId)`をuniqueとする。メール本文は保存しない。
手動取込では検索結果のsnippetをmetadataとして保持できるが、定期監視経路は本文断片を残さないためsnippetを保存しない。

### AiExtractionResult

| カラム | 必須 | 説明 |
|---|---:|---|
| userId / emailImportId | Yes | 所有者、取り込み元 |
| extractedJson | Yes | AI抽出結果 |
| confidence | No | 総合信頼度 |
| modelName | No | 使用モデル |
| promptVersion | No | プロンプト・スキーマ版 |
| reviewedJson | No | ユーザー確認後の入力 |
| confirmedAt | No | 確認完了日時 |
| createdApplicationId | No | 作成されたApplication |

EmailImport削除時はcascadeする。Application削除時は抽出履歴を残し、`createdApplicationId`をnullにする。

### EmailMonitorConfig

| カラム | 必須 | 説明 |
|---|---:|---|
| userId | Yes | 所有者。Userごとに一件 |
| enabled / consentedAt | Yes/No | 監視状態、AI送信への同意日時 |
| gmailQuery / monitoringSince / cursorAt | Yes | 検索条件、有効化境界、処理カーソル |
| scanUpperBoundAt / scanPageToken | No | ページング中の固定上限、Gmail page token |
| lastRunAt / lastSuccessAt | No | 実行・成功日時 |
| lastErrorCode / lastErrorMessage | No | 本文を含まない最新エラー |

OFFからONへ切り替えると`cursorAt`を現在時刻へ設定し、過去メールを自動処理しない。

### EmailAutomationJob

| カラム | 必須 | 説明 |
|---|---:|---|
| userId / emailImportId | Yes | 所有者、対象メール |
| gmailMessageId / messageDigest | Yes | Gmail識別子、本文を保存しない冪等digest |
| status | Yes | 処理状態 |
| attempts / leaseUntil / nextAttemptAt | Yes/No/No | 排他取得、再試行 |
| errorCode / errorMessage | No | 本文を含まない失敗概要 |
| aiInputTokens / aiOutputTokens / aiTotalTokens | Yes | 実AI使用量 |
| aiReservedTokens / aiReservationDate | Yes/No | 並行workerを含む日次無料枠の事前予約 |
| extractionResultId / matchedApplicationId | No | AI結果、安全に一致した既存応募 |
| processedAt | No | 終端状態になった日時 |

`emailImportId`をuniqueとし、`(userId,gmailMessageId,messageDigest)`でも重複を防ぐ。

### EmailAutomationChange

| カラム | 必須 | 説明 |
|---|---:|---|
| jobId | Yes | 自動反映job。一job一変更 |
| userId / applicationId | Yes | 所有者、変更対象応募 |
| interviewId | No | 対象面接 |
| beforeJson / afterJson | Yes | 本文を含まない変更前後 |

Job削除時はcascadeする。Application削除時は自動変更履歴もcascadeするため、本モデルはドメイン変更の冪等性・説明用であり、法的な不変監査ログではない。

### AiDailyUsage

Cloudflare Workers AIアカウント全体の日次Neuron使用量と処理中予約量をUTC日単位で保持する。`(provider,usageDate)`を主キーとし、AI呼出し前に実リクエスト全体のUTF-8 byte数、サーバーフレーミング余裕、最大出力tokenからモデル公表値で換算した保守的なNeuron上限をSerializable transactionで予約する。成功時は実使用量で精算し、応答が不明な失敗やworker停止は予約量全体を使用済みとして安全側に計上する。

## 6. 主要enum

- ApplicationType: 就活、転職、インターン、業務委託、アルバイト、大学院、その他
- ApplicationStatus: 下書き、応募済み、書類選考、面接中、オファー、承諾、辞退、不採用、取下げ、終了
- StageType / StageStatus: 選考種別と状態
- InterviewStatus: 下書き、候補提示、返信待ち、確定、完了、取消、期限切れ
- ProposedSlotStatus: 提示中、確定、非選択、取消、期限切れ
- DeadlineType / DeadlineStatus: 期限種別と状態
- ScheduleEventSource: Google Calendar、手動
- ActivityAction: 応募・フェーズ・面談・候補・期限の操作履歴
- BrowserMessageEventType: 新規・更新、日時変更、取消
- EmailAutomationJobStatus: 待機、処理中、自動反映、確認待ち、無視、再試行待ち、失敗

## 7. 削除方針

- Application、SelectionStage、Interview、ProposedSlot、Deadline、ScheduleEventは`deletedAt`で論理削除する。
- User削除時は所有する業務データをcascade削除する。
- CompanyはApplicationからrestrictされるため、参照中は削除できない。
- 活動履歴とAI抽出履歴は監査・再確認のため、関連先削除後も可能な範囲で保持する。
- BrowserMessageImportはApplicationとともに削除するが、保持中もメッセージ生本文を含まない。

## 8. タイムゾーン

- DateTimeはDBでUTCとして扱う。
- ユーザー既定timezoneはUser.timezoneに保存する。
- ProposedSlotとScheduleEventは個別timezoneも保持する。
- 終日予定はUTC変換による日付ずれを避けるため`startDate / endDate`も保持する。

## 9. マイグレーション

| migration | 内容 |
|---|---|
| `20260707102447_new_applyflow` | 応募管理コアスキーマ |
| `20260710173000_add_email_import_ai_extraction` | EmailImport、AiExtractionResult |
| `20260714170000_add_schedule_events_and_extraction_metadata` | ScheduleEvent、抽出モデル・プロンプト・確認値 |
| `20260715120000_add_browser_extension` | Application求人取得項目、重複・冪等キー、BrowserExtensionToken |
| `20260715130000_normalize_schedule_event_index_name` | PostgreSQLの識別子長制限で切り詰められたScheduleEvent unique index名を明示名へ統一 |
| `20260715140000_add_browser_message_import` | 企業メッセージ登録の反映先・処理種別・digest・冪等キー |
| `20260727090000_add_email_monitor_automation` | Gmail監視設定、automation job、変更前後、Neon direct URL |
| `20260727100000_add_email_monitor_ai_usage_timestamp` | AI日次無料枠を正確に集計する処理日時 |
| `20260727110000_add_email_monitor_activation_boundary` | 同一秒を含め有効化以前のメールを除外する境界 |
| `20260727120000_add_ai_daily_usage_budget` | 並行worker対応の日次token予約・使用量ledger（旧Groq用） |
| `20260812090000_add_cloudflare_neuron_budget` | Cloudflare Workers AI用のNeuron予約・使用量列を追加し、旧token列はロールバック互換のため保持 |

変更時は以下を実行する。

```bash
npx prisma format
npm run prisma:generate
npm run prisma:migrate
```

## 10. 旧版からの変更

旧版の「EmailImport / AiExtractionResult / ExternalCalendarEventは将来作成」という記述を廃止した。外部予定キャッシュではなく、ユーザーが明示的に取り込んだアプリ所有予定を`ScheduleEvent`として正本化する。
