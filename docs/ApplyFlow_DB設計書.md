# ApplyFlow DB設計書 v1.1

更新日: 2026-07-14

## 1. 概要

PostgreSQLとPrismaを使用する。すべての業務データはUserを所有者とし、応募管理はApplicationを中心に構成する。

```text
User
 ├─ Company ─ Application
 │              ├─ SelectionStage ─ Interview ─ ProposedSlot
 │              ├─ Deadline
 │              ├─ ActivityLog
 │              └─ ScheduleEvent (optional relation)
 ├─ ScheduleEvent
 └─ EmailImport ─ AiExtractionResult ─ Application (optional relation)
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
| deletedAt | No | 論理削除 |

`userId,status`、`userId,priority`、`companyId`、`deletedAt`にインデックスを持つ。

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

## 6. 主要enum

- ApplicationType: 就活、転職、インターン、業務委託、アルバイト、大学院、その他
- ApplicationStatus: 下書き、応募済み、書類選考、面接中、オファー、承諾、辞退、不採用、取下げ、終了
- StageType / StageStatus: 選考種別と状態
- InterviewStatus: 下書き、候補提示、返信待ち、確定、完了、取消、期限切れ
- ProposedSlotStatus: 提示中、確定、非選択、取消、期限切れ
- DeadlineType / DeadlineStatus: 期限種別と状態
- ScheduleEventSource: Google Calendar、手動
- ActivityAction: 応募・フェーズ・面談・候補・期限の操作履歴

## 7. 削除方針

- Application、SelectionStage、Interview、ProposedSlot、Deadline、ScheduleEventは`deletedAt`で論理削除する。
- User削除時は所有する業務データをcascade削除する。
- CompanyはApplicationからrestrictされるため、参照中は削除できない。
- 活動履歴とAI抽出履歴は監査・再確認のため、関連先削除後も可能な範囲で保持する。

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

変更時は以下を実行する。

```bash
npx prisma format
npm run prisma:generate
npm run prisma:migrate
```

## 10. 旧版からの変更

旧版の「EmailImport / AiExtractionResult / ExternalCalendarEventは将来作成」という記述を廃止した。外部予定キャッシュではなく、ユーザーが明示的に取り込んだアプリ所有予定を`ScheduleEvent`として正本化する。
