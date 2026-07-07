# ApplyFlow DB設計書 v0.1

## 1. 目的

本書は、ApplyFlow のデータベース設計を定義する。

ApplyFlow
は、就活・転職・インターン・業務委託案件応募における、応募先・選考フェーズ・面談候補日時・返信待ち・承諾期限・日程衝突を管理する選考CRMである。

本DB設計では、以下を重視する。

-   Company ではなく Application を中心に設計する
-   Interview と ProposedSlot を分離する
-   ステータスは enum で管理する
-   日時は UTC で保存する
-   期限管理を汎用化する
-   衝突検知に必要なインデックスを設計する
-   v0.1 では外部連携用テーブルを作り込みすぎない

------------------------------------------------------------------------

## 2. 設計方針

## 2.1 Application を集約ルートとする

ApplyFlow の中心は企業ではなく、応募単位である。

同じ企業に複数職種で応募する可能性があるため、Company
を中心にすると以下のケースで破綻する。

-   同一企業に複数ポジションで応募する
-   同一企業に直接応募とエージェント経由で応募する
-   カジュアル面談と本選考が別ルートで進む
-   同一企業でインターン選考と本選考が並行する

したがって、Application を集約ルートとし、Company
は応募先企業のマスタ情報として扱う。

``` txt
User
 └─ Application
     ├─ Company
     ├─ SelectionStage
     │   └─ Interview
     │       └─ ProposedSlot
     ├─ Deadline
     └─ ActivityLog
```

------------------------------------------------------------------------

## 2.2 Interview と ProposedSlot を分離する

Interview は「面談イベントそのもの」を表す。

ProposedSlot は「面談に対して提示した候補日時」を表す。

この2つを分けることで、以下を表現できる。

-   1つの面談に複数候補日を提示する
-   候補日のうち1つを確定する
-   確定されなかった候補日を rejected / cancelled にする
-   候補日同士の衝突を検知する
-   未確定予定をカレンダー上に表示する

------------------------------------------------------------------------

## 2.3 日時は UTC で保存する

DB上の日時は UTC で保存する。

表示時にユーザーのタイムゾーンへ変換する。

初期実装では日本国内利用を前提に `Asia/Tokyo` をデフォルトとする。

将来的に海外利用を考慮し、User に timezone を持たせる。

------------------------------------------------------------------------

## 2.4 削除方針

主要テーブルは論理削除を基本とする。

対象：

-   Application
-   SelectionStage
-   Interview
-   ProposedSlot
-   Deadline

論理削除には `deletedAt` を使用する。

User や ActivityLog は原則として物理削除しない。

------------------------------------------------------------------------

## 2.5 v0.1 と将来拡張の分離

v0.1 では以下を中心に設計する。

-   応募先管理
-   選考フェーズ管理
-   面談管理
-   候補日時管理
-   期限管理
-   活動ログ
-   アプリ内データ同士の衝突検知

Google Calendar / Gmail / AI抽出に関するテーブルは v0.2 / v1.0
の拡張として扱う。

------------------------------------------------------------------------

## 3. ER概要

``` txt
User
 ├─ Account
 ├─ Session
 ├─ Company
 ├─ Application
 │   ├─ SelectionStage
 │   │   └─ Interview
 │   │       └─ ProposedSlot
 │   ├─ Deadline
 │   └─ ActivityLog
```

Auth.js を利用するため、User / Account / Session / VerificationToken は
Auth.js 標準構成に準拠する。

------------------------------------------------------------------------

## 4. テーブル一覧

  テーブル                用途                                v0.1
  ----------------------- ----------------------------------- ------
  User                    ユーザー                            必須
  Account                 OAuthアカウント                     必須
  Session                 セッション                          必須
  VerificationToken       認証トークン                        必須
  Company                 企業情報                            必須
  Application             応募単位                            必須
  SelectionStage          選考フェーズ                        必須
  Interview               面談                                必須
  ProposedSlot            面談候補日時                        必須
  Deadline                期限                                必須
  ActivityLog             活動ログ                            必須
  ExternalCalendarEvent   Google Calendarイベントキャッシュ   v0.2
  EmailImport             Gmail取り込み履歴                   v1.0
  AiExtractionResult      AI抽出結果                          v1.0

------------------------------------------------------------------------

## 5. Enum定義

## 5.1 ApplicationType

``` txt
JOB_HUNTING
CAREER_CHANGE
INTERNSHIP
FREELANCE
PART_TIME
GRADUATE_SCHOOL
OTHER
```

## 5.2 ApplicationRoute

``` txt
DIRECT
AGENT
REFERRAL
JOB_BOARD
SCOUT
SNS
OTHER
```

## 5.3 ApplicationStatus

``` txt
DRAFT
APPLIED
DOCUMENT_SCREENING
INTERVIEWING
OFFERED
ACCEPTED
DECLINED
REJECTED
WITHDRAWN
CLOSED
```

## 5.4 Priority

``` txt
LOW
MEDIUM
HIGH
TOP
```

## 5.5 StageType

``` txt
DOCUMENT_SCREENING
CASUAL_MEETING
FIRST_INTERVIEW
SECOND_INTERVIEW
FINAL_INTERVIEW
OFFER_MEETING
CONDITION_MEETING
ASSIGNMENT
OTHER
```

## 5.6 StageStatus

``` txt
NOT_STARTED
IN_PROGRESS
WAITING_REPLY
SCHEDULED
COMPLETED
SKIPPED
CANCELLED
```

## 5.7 InterviewStatus

``` txt
DRAFT
PROPOSED
WAITING_REPLY
CONFIRMED
COMPLETED
CANCELLED
EXPIRED
```

## 5.8 ProposedSlotStatus

``` txt
PENDING
CONFIRMED
REJECTED
CANCELLED
EXPIRED
```

## 5.9 DeadlineType

``` txt
REPLY_DEADLINE
OFFER_ACCEPTANCE
DOCUMENT_SUBMISSION
ASSIGNMENT_SUBMISSION
INTERVIEW_PREPARATION
OTHER
```

## 5.10 DeadlineStatus

``` txt
OPEN
DONE
EXPIRED
CANCELLED
```

## 5.11 ActivityAction

``` txt
APPLICATION_CREATED
APPLICATION_UPDATED
APPLICATION_STATUS_CHANGED
STAGE_CREATED
STAGE_STATUS_CHANGED
INTERVIEW_CREATED
INTERVIEW_STATUS_CHANGED
PROPOSED_SLOT_CREATED
PROPOSED_SLOT_CONFIRMED
PROPOSED_SLOT_CANCELLED
DEADLINE_CREATED
DEADLINE_COMPLETED
APPLICATION_WITHDRAWN
APPLICATION_REJECTED
OFFER_ACCEPTED
OFFER_DECLINED
```

------------------------------------------------------------------------

## 6. テーブル定義

## 6.1 User

ユーザーを表す。

Auth.js の User モデルをベースとする。

  カラム          型         必須   説明
  --------------- ---------- ------ ---------------------------------
  id              String     Yes    ユーザーID
  name            String     No     表示名
  email           String     No     メールアドレス
  emailVerified   DateTime   No     メール確認日時
  image           String     No     アイコンURL
  timezone        String     Yes    タイムゾーン。初期値 Asia/Tokyo
  createdAt       DateTime   Yes    作成日時
  updatedAt       DateTime   Yes    更新日時

------------------------------------------------------------------------

## 6.2 Company

企業情報を表す。

Company はユーザーごとに管理する。

理由は、同名企業の扱いやメモの個人差を許容するためである。

  カラム       型         必須   説明
  ------------ ---------- ------ --------------
  id           String     Yes    企業ID
  userId       String     Yes    所有ユーザー
  name         String     Yes    企業名
  websiteUrl   String     No     企業URL
  note         String     No     メモ
  createdAt    DateTime   Yes    作成日時
  updatedAt    DateTime   Yes    更新日時

制約：

-   同一ユーザー内で company.name は必ずしもユニークにしない
-   表記揺れや部署違いがあるため、重複登録を許容する

------------------------------------------------------------------------

## 6.3 Application

応募単位を表す。

ApplyFlow における中核テーブル。

  カラム            型                  必須   説明
  ----------------- ------------------- ------ ----------------------
  id                String              Yes    応募ID
  userId            String              Yes    所有ユーザー
  companyId         String              Yes    企業ID
  position          String              Yes    応募職種・ポジション
  applicationType   ApplicationType     Yes    応募種別
  route             ApplicationRoute    Yes    応募経路
  status            ApplicationStatus   Yes    応募ステータス
  priority          Priority            Yes    優先度
  appliedAt         DateTime            No     応募日
  sourceUrl         String              No     求人URL
  note              String              No     メモ
  createdAt         DateTime            Yes    作成日時
  updatedAt         DateTime            Yes    更新日時
  deletedAt         DateTime            No     論理削除日時

設計メモ：

-   Application は Company ではなく選考プロセスを表す
-   期限、面談、活動ログは Application に紐づける
-   同一 Company に複数 Application を許容する

------------------------------------------------------------------------

## 6.4 SelectionStage

応募に紐づく選考フェーズを表す。

  カラム          型            必須   説明
  --------------- ------------- ------ --------------
  id              String        Yes    フェーズID
  userId          String        Yes    所有ユーザー
  applicationId   String        Yes    応募ID
  type            StageType     Yes    フェーズ種別
  name            String        No     任意表示名
  status          StageStatus   Yes    フェーズ状態
  order           Int           Yes    表示順
  scheduledAt     DateTime      No     予定日時
  completedAt     DateTime      No     完了日時
  note            String        No     メモ
  createdAt       DateTime      Yes    作成日時
  updatedAt       DateTime      Yes    更新日時
  deletedAt       DateTime      No     論理削除日時

設計メモ：

-   type は選考種別を表す
-   name は「技術面接」「人事面談」など自由入力用
-   order でタイムライン表示順を制御する

------------------------------------------------------------------------

## 6.5 Interview

選考フェーズに紐づく面談を表す。

  カラム             型                必須   説明
  ------------------ ----------------- ------ -------------------
  id                 String            Yes    面談ID
  userId             String            Yes    所有ユーザー
  selectionStageId   String            Yes    選考フェーズID
  status             InterviewStatus   Yes    面談状態
  title              String            No     面談タイトル
  meetingUrl         String            No     オンライン面談URL
  location           String            No     対面場所
  interviewerName    String            No     担当者名
  interviewerEmail   String            No     担当者メール
  confirmedStartAt   DateTime          No     確定開始日時
  confirmedEndAt     DateTime          No     確定終了日時
  note               String            No     メモ
  createdAt          DateTime          Yes    作成日時
  updatedAt          DateTime          Yes    更新日時
  deletedAt          DateTime          No     論理削除日時

設計メモ：

-   候補日時は ProposedSlot に持たせる
-   確定日時は検索性と表示性を高めるため Interview にも持つ
-   ProposedSlot の confirmed と Interview の confirmedStartAt /
    confirmedEndAt は同一トランザクションで更新する

------------------------------------------------------------------------

## 6.6 ProposedSlot

面談候補日時を表す。

ApplyFlow の最重要テーブルの1つ。

  カラム        型                   必須   説明
  ------------- -------------------- ------ ------------------------------
  id            String               Yes    候補日時ID
  userId        String               Yes    所有ユーザー
  interviewId   String               Yes    面談ID
  startAt       DateTime             Yes    開始日時 UTC
  endAt         DateTime             Yes    終了日時 UTC
  timezone      String               Yes    入力時タイムゾーン
  status        ProposedSlotStatus   Yes    候補日時状態
  source        String               No     manual / gmail / calendar 等
  note          String               No     メモ
  createdAt     DateTime             Yes    作成日時
  updatedAt     DateTime             Yes    更新日時
  deletedAt     DateTime             No     論理削除日時

制約：

-   `startAt < endAt` をアプリケーション層で保証する
-   同一 Interview 内で confirmed は原則1件のみ
-   DB制約での部分ユニーク制約は Prisma
    では扱いづらいため、アプリケーション層で制御する

------------------------------------------------------------------------

## 6.7 Deadline

返信期限・承諾期限・課題提出期限などを表す。

  カラム          型               必須   説明
  --------------- ---------------- ------ --------------
  id              String           Yes    期限ID
  userId          String           Yes    所有ユーザー
  applicationId   String           Yes    応募ID
  type            DeadlineType     Yes    期限種別
  status          DeadlineStatus   Yes    期限状態
  title           String           Yes    期限タイトル
  dueAt           DateTime         Yes    期限日時 UTC
  completedAt     DateTime         No     完了日時
  note            String           No     メモ
  createdAt       DateTime         Yes    作成日時
  updatedAt       DateTime         Yes    更新日時
  deletedAt       DateTime         No     論理削除日時

設計メモ：

-   承諾期限専用ではなく、汎用期限として設計する
-   返信期限、書類提出、課題提出にも使える
-   ダッシュボードでは dueAt 昇順で表示する

------------------------------------------------------------------------

## 6.8 ActivityLog

ユーザー操作・状態変更履歴を表す。

  カラム          型               必須   説明
  --------------- ---------------- ------ ------------------
  id              String           Yes    ログID
  userId          String           Yes    所有ユーザー
  applicationId   String           Yes    応募ID
  action          ActivityAction   Yes    操作種別
  message         String           Yes    表示用メッセージ
  metadata        Json             No     追加情報
  createdAt       DateTime         Yes    作成日時

設計メモ：

-   ActivityLog は原則更新・削除しない
-   CRMらしい時系列履歴を表示するために使用する
-   metadata には変更前後のステータスや候補日時IDなどを格納する

------------------------------------------------------------------------

## 7. v0.2 拡張テーブル

## 7.1 ExternalCalendarEvent

Google Calendar の予定を一時的に扱うためのテーブル。

v0.2 で検討する。

  カラム            型         必須   説明
  ----------------- ---------- ------ --------------------------
  id                String     Yes    ID
  userId            String     Yes    所有ユーザー
  externalEventId   String     Yes    Google Calendar event ID
  calendarId        String     Yes    Calendar ID
  summary           String     No     予定名
  startAt           DateTime   Yes    開始日時
  endAt             DateTime   Yes    終了日時
  fetchedAt         DateTime   Yes    取得日時

保存方針：

-   原則、Google Calendarイベントは永続保存しない
-   パフォーマンス改善が必要になった場合のみ短期キャッシュする
-   本格運用では stale data の扱いに注意する

------------------------------------------------------------------------

## 8. v1.0 拡張テーブル

## 8.1 EmailImport

Gmailから取り込んだメールの履歴を表す。

  カラム           型         必須   説明
  ---------------- ---------- ------ ------------------
  id               String     Yes    ID
  userId           String     Yes    所有ユーザー
  gmailMessageId   String     Yes    Gmail message ID
  gmailThreadId    String     No     Gmail thread ID
  subject          String     No     件名
  fromAddress      String     No     送信者
  snippet          String     No     スニペット
  importedAt       DateTime   Yes    取り込み日時

注意：

-   メール本文全文の保存は避ける
-   必要な構造化データのみ保存する
-   プライバシー上、最小保存を原則とする

------------------------------------------------------------------------

## 8.2 AiExtractionResult

AI抽出結果を表す。

  カラム          型         必須   説明
  --------------- ---------- ------ ------------------
  id              String     Yes    ID
  userId          String     Yes    所有ユーザー
  emailImportId   String     Yes    メール取り込みID
  extractedJson   Json       Yes    抽出結果
  confidence      Float      No     信頼度
  confirmedAt     DateTime   No     ユーザー確認日時
  createdAt       DateTime   Yes    作成日時

注意：

-   AI抽出結果は自動登録しない
-   必ずユーザー確認を挟む
-   confirmedAt があるものだけ登録済みデータとみなす

------------------------------------------------------------------------

## 9. インデックス設計

## 9.1 基本インデックス

  テーブル         インデックス               目的
  ---------------- -------------------------- ------------------------------
  Company          userId                     ユーザー別企業一覧
  Application      userId, status             応募一覧・ステータス絞り込み
  Application      userId, priority           優先度絞り込み
  SelectionStage   applicationId, order       タイムライン表示
  Interview        userId, status             面談ステータス検索
  Interview        selectionStageId           フェーズ配下の面談取得
  ProposedSlot     userId, startAt            カレンダー表示・衝突検知
  ProposedSlot     userId, endAt              衝突検知
  ProposedSlot     interviewId, status        面談ごとの候補取得
  Deadline         userId, dueAt              期限順表示
  Deadline         userId, status, dueAt      未完了期限一覧
  ActivityLog      applicationId, createdAt   応募詳細の履歴表示

------------------------------------------------------------------------

## 9.2 衝突検知用検索

新しい候補日時 `newStartAt`, `newEndAt`
に対して、以下の条件で候補を取得する。

``` txt
existing.startAt < newEndAt
AND
newStartAt < existing.endAt
```

対象：

-   ProposedSlot status = PENDING / CONFIRMED
-   Interview status = CONFIRMED

v0.2以降：

-   ExternalCalendarEvent

------------------------------------------------------------------------

## 10. 主要制約

## 10.1 データ所有権

すべての主要テーブルに `userId` を持たせる。

対象：

-   Company
-   Application
-   SelectionStage
-   Interview
-   ProposedSlot
-   Deadline
-   ActivityLog

理由：

-   認可チェックを単純化する
-   クエリを高速化する
-   Joinを深くしなくても所有者判定できる

------------------------------------------------------------------------

## 10.2 時間制約

以下はアプリケーション層で保証する。

-   ProposedSlot.startAt \< ProposedSlot.endAt
-   Interview.confirmedStartAt \< Interview.confirmedEndAt
-   Deadline.dueAt は必須

------------------------------------------------------------------------

## 10.3 状態制約

以下はアプリケーション層で保証する。

-   1つの Interview に confirmed ProposedSlot は原則1件のみ
-   ProposedSlot を confirmed にした場合、Interview を confirmed にする
-   Interview が cancelled になった場合、未確定 ProposedSlot も
    cancelled にする
-   Deadline が done になった場合、completedAt をセットする

------------------------------------------------------------------------

## 11. Prisma Schema案

``` prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum ApplicationType {
  JOB_HUNTING
  CAREER_CHANGE
  INTERNSHIP
  FREELANCE
  PART_TIME
  GRADUATE_SCHOOL
  OTHER
}

enum ApplicationRoute {
  DIRECT
  AGENT
  REFERRAL
  JOB_BOARD
  SCOUT
  SNS
  OTHER
}

enum ApplicationStatus {
  DRAFT
  APPLIED
  DOCUMENT_SCREENING
  INTERVIEWING
  OFFERED
  ACCEPTED
  DECLINED
  REJECTED
  WITHDRAWN
  CLOSED
}

enum Priority {
  LOW
  MEDIUM
  HIGH
  TOP
}

enum StageType {
  DOCUMENT_SCREENING
  CASUAL_MEETING
  FIRST_INTERVIEW
  SECOND_INTERVIEW
  FINAL_INTERVIEW
  OFFER_MEETING
  CONDITION_MEETING
  ASSIGNMENT
  OTHER
}

enum StageStatus {
  NOT_STARTED
  IN_PROGRESS
  WAITING_REPLY
  SCHEDULED
  COMPLETED
  SKIPPED
  CANCELLED
}

enum InterviewStatus {
  DRAFT
  PROPOSED
  WAITING_REPLY
  CONFIRMED
  COMPLETED
  CANCELLED
  EXPIRED
}

enum ProposedSlotStatus {
  PENDING
  CONFIRMED
  REJECTED
  CANCELLED
  EXPIRED
}

enum DeadlineType {
  REPLY_DEADLINE
  OFFER_ACCEPTANCE
  DOCUMENT_SUBMISSION
  ASSIGNMENT_SUBMISSION
  INTERVIEW_PREPARATION
  OTHER
}

enum DeadlineStatus {
  OPEN
  DONE
  EXPIRED
  CANCELLED
}

enum ActivityAction {
  APPLICATION_CREATED
  APPLICATION_UPDATED
  APPLICATION_STATUS_CHANGED
  STAGE_CREATED
  STAGE_STATUS_CHANGED
  INTERVIEW_CREATED
  INTERVIEW_STATUS_CHANGED
  PROPOSED_SLOT_CREATED
  PROPOSED_SLOT_CONFIRMED
  PROPOSED_SLOT_CANCELLED
  DEADLINE_CREATED
  DEADLINE_COMPLETED
  APPLICATION_WITHDRAWN
  APPLICATION_REJECTED
  OFFER_ACCEPTED
  OFFER_DECLINED
}

model User {
  id            String    @id @default(cuid())
  name          String?
  email         String?   @unique
  emailVerified DateTime?
  image         String?
  timezone      String    @default("Asia/Tokyo")
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  accounts      Account[]
  sessions      Session[]

  companies     Company[]
  applications  Application[]
  stages        SelectionStage[]
  interviews    Interview[]
  proposedSlots ProposedSlot[]
  deadlines     Deadline[]
  activityLogs  ActivityLog[]
}

model Account {
  id                String  @id @default(cuid())
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String?
  access_token      String?
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String?
  session_state     String?

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
  @@index([userId])
}

model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}

model VerificationToken {
  identifier String
  token      String   @unique
  expires    DateTime

  @@unique([identifier, token])
}

model Company {
  id         String   @id @default(cuid())
  userId     String
  name       String
  websiteUrl String?
  note       String?
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  user         User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  applications Application[]

  @@index([userId])
  @@index([userId, name])
}

model Application {
  id              String            @id @default(cuid())
  userId          String
  companyId       String
  position        String
  applicationType ApplicationType
  route           ApplicationRoute
  status          ApplicationStatus @default(DRAFT)
  priority        Priority          @default(MEDIUM)
  appliedAt       DateTime?
  sourceUrl       String?
  note            String?
  createdAt       DateTime          @default(now())
  updatedAt       DateTime          @updatedAt
  deletedAt       DateTime?

  user      User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  company   Company @relation(fields: [companyId], references: [id], onDelete: Restrict)

  stages       SelectionStage[]
  deadlines    Deadline[]
  activityLogs ActivityLog[]

  @@index([userId, status])
  @@index([userId, priority])
  @@index([companyId])
  @@index([deletedAt])
}

model SelectionStage {
  id            String      @id @default(cuid())
  userId        String
  applicationId String
  type          StageType
  name          String?
  status        StageStatus @default(NOT_STARTED)
  order         Int
  scheduledAt   DateTime?
  completedAt   DateTime?
  note          String?
  createdAt     DateTime    @default(now())
  updatedAt     DateTime    @updatedAt
  deletedAt     DateTime?

  user        User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  application Application @relation(fields: [applicationId], references: [id], onDelete: Cascade)

  interviews Interview[]

  @@index([userId, status])
  @@index([applicationId, order])
  @@index([deletedAt])
}

model Interview {
  id                String          @id @default(cuid())
  userId            String
  selectionStageId  String
  status            InterviewStatus @default(DRAFT)
  title             String?
  meetingUrl        String?
  location          String?
  interviewerName   String?
  interviewerEmail  String?
  confirmedStartAt  DateTime?
  confirmedEndAt    DateTime?
  note              String?
  createdAt         DateTime        @default(now())
  updatedAt         DateTime        @updatedAt
  deletedAt         DateTime?

  user           User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  selectionStage SelectionStage @relation(fields: [selectionStageId], references: [id], onDelete: Cascade)

  proposedSlots ProposedSlot[]

  @@index([userId, status])
  @@index([selectionStageId])
  @@index([userId, confirmedStartAt])
  @@index([deletedAt])
}

model ProposedSlot {
  id          String             @id @default(cuid())
  userId      String
  interviewId String
  startAt     DateTime
  endAt       DateTime
  timezone    String             @default("Asia/Tokyo")
  status      ProposedSlotStatus @default(PENDING)
  source      String?
  note        String?
  createdAt   DateTime           @default(now())
  updatedAt   DateTime           @updatedAt
  deletedAt   DateTime?

  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  interview Interview @relation(fields: [interviewId], references: [id], onDelete: Cascade)

  @@index([userId, startAt])
  @@index([userId, endAt])
  @@index([interviewId, status])
  @@index([userId, status, startAt])
  @@index([deletedAt])
}

model Deadline {
  id            String         @id @default(cuid())
  userId        String
  applicationId String
  type          DeadlineType
  status        DeadlineStatus @default(OPEN)
  title         String
  dueAt         DateTime
  completedAt   DateTime?
  note          String?
  createdAt     DateTime       @default(now())
  updatedAt     DateTime       @updatedAt
  deletedAt     DateTime?

  user        User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  application Application @relation(fields: [applicationId], references: [id], onDelete: Cascade)

  @@index([userId, dueAt])
  @@index([userId, status, dueAt])
  @@index([applicationId])
  @@index([deletedAt])
}

model ActivityLog {
  id            String         @id @default(cuid())
  userId        String
  applicationId String
  action        ActivityAction
  message       String
  metadata      Json?
  createdAt     DateTime       @default(now())

  user        User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  application Application @relation(fields: [applicationId], references: [id], onDelete: Cascade)

  @@index([userId, createdAt])
  @@index([applicationId, createdAt])
}
```

------------------------------------------------------------------------

## 12. DB設計上の注意点

## 12.1 userId の冗長保持

SelectionStage / Interview / ProposedSlot は、リレーションを辿れば User
に到達できる。

それでも userId を持たせる。

理由：

-   認可チェックが単純になる
-   カレンダー表示・衝突検知で深いJOINを避けられる
-   Prismaクエリが書きやすくなる
-   ポートフォリオとして実務寄りの設計に見える

欠点：

-   userId の整合性をアプリケーション層で保証する必要がある

------------------------------------------------------------------------

## 12.2 confirmedStartAt の重複保持

Interview は confirmedStartAt / confirmedEndAt を持つ。

一方、ProposedSlot にも confirmed ステータスがある。

これはやや冗長だが、意図的な設計である。

理由：

-   確定面談一覧を高速に取得できる
-   カレンダー表示が簡潔になる
-   ProposedSlotを毎回JOINしなくてよい

整合性は、候補日時確定処理を必ずトランザクションで行うことで担保する。

------------------------------------------------------------------------

## 12.3 論理削除と一覧取得

論理削除対象テーブルでは、通常クエリで以下を必ず条件に含める。

``` txt
deletedAt IS NULL
```

これを忘れると削除済みデータが表示される。

実装時には repository / query function に閉じ込める。

------------------------------------------------------------------------

## 12.4 DB制約とアプリケーション制約

以下はDB制約ではなく、アプリケーション層で制御する。

-   startAt \< endAt
-   同一Interview内のconfirmed ProposedSlotは1件のみ
-   status遷移の妥当性
-   userId整合性
-   論理削除済みデータの更新禁止

Prisma + PostgreSQL
でチェック制約や部分ユニーク制約を追加することも可能だが、初期開発では複雑化を避ける。

------------------------------------------------------------------------

## 13. 初期実装で作成するテーブル

v0.1 で作成するテーブル：

-   User
-   Account
-   Session
-   VerificationToken
-   Company
-   Application
-   SelectionStage
-   Interview
-   ProposedSlot
-   Deadline
-   ActivityLog

v0.1 では作成しないテーブル：

-   ExternalCalendarEvent
-   EmailImport
-   AiExtractionResult

------------------------------------------------------------------------

## 14. まとめ

ApplyFlow のDB設計では、Application
を中心に、SelectionStage、Interview、ProposedSlot、Deadline、ActivityLog
を紐づける。

この設計により、以下を表現できる。

-   同一企業への複数応募
-   複数フェーズの選考
-   複数候補日時の提示
-   候補日時の確定・却下・期限切れ
-   返信期限・承諾期限の管理
-   日程衝突検知
-   活動履歴の可視化

v0.1 ではアプリ内データの管理に集中し、Google Calendar / Gmail /
AI抽出は後続フェーズで拡張する。
