# ApplyFlow アーキテクチャ設計書 v1.4

更新日: 2026-07-27

## 1. システム構成

```text
Browser
  -> Next.js App Router / Server Components / Server Actions
      -> Auth.js + Google OAuth
      -> Prisma Client -> PostgreSQL
      -> Google Calendar API (readonly)
      -> Gmail API (readonly)
      -> Cloudflare Workers AI REST API / @cf/openai/gpt-oss-120b

Netlify Scheduled Function (15分)
  -> internal signature
  -> Netlify Background Function
      -> Gmail polling
      -> Email automation job
      -> Prisma Client -> Neon PostgreSQL

Chrome Extension (Manifest V3)
  -> Content Script / Shadow DOM
      -> Extension Service Worker
          -> Browser Extension Route Handlers -> Prisma Client -> PostgreSQL
```

画面表示はServer Componentを基本とし、フォーム、カレンダー、外部API操作など対話が必要な部分だけClient Componentとする。データ更新はServer Actionへ集約する。

## 2. ディレクトリ責務

```text
app/                    ルート、ページ、レイアウト
components/ui/          汎用UI部品
components/layout/      PC・モバイルナビゲーション
features/applications/  応募、企業、選考フェーズ
features/interviews/    面談、候補日時
features/deadlines/     期限
features/calendar/      統合カレンダー、Google予定取込
features/conflict-detection/ 衝突検知
features/email-import/  Gmail取込、AI抽出、確認登録
features/email-monitor/ Gmail監視、job状態機械、安全判定、自動反映
features/browser-extension/ Token、API契約、設定UI
browser-extension/      Manifest V3拡張機能本体とビルド
netlify/functions/      Scheduled / Background Function
lib/                    Google API、認証、日付、Prisma
prisma/                 DBスキーマ、マイグレーション
tests/                  Vitest
docs/                   仕様・設計の正本
```

## 3. 認証・Googleトークン

Auth.jsのPrisma AdapterとDBセッションを使用する。ログイン時にGoogle Accountのaccess token、refresh token、期限、scopeを更新する。

`lib/google-auth.ts`が次を共通提供する。

- Google Account取得
- scope判定
- access token期限判定
- refresh tokenによるaccess token更新

CalendarとGmailはこの共通処理を利用する。要求scopeはopenid/profile/email、Calendar readonly、Gmail readonlyである。

## 4. Calendar表示フロー

```text
/calendar
  -> getCalendarData(userId)
      -> Interview(CONFIRMED)
      -> ProposedSlot(PENDING)
      -> Deadline(OPEN)
      -> ScheduleEvent
      -> Google Calendar events.list
  -> 取込済みGoogle event keyを除外
  -> FullCalendar用CalendarEventへ変換
```

Google API障害時も、`ScheduleEvent`として取り込んだ予定はDBから表示できる。

## 5. Google Calendar取込フロー

```text
イベント選択
  -> 詳細ダイアログ
  -> calendarId / externalEventId / applicationIdをServer Actionへ送信
  -> ユーザーと応募先の所有権を検証
  -> Google events.getで予定を再取得
  -> ScheduleEventへupsert
  -> /calendar と /dashboard を再検証
```

クライアントからタイトルや日時を受け取らず、保存直前にGoogle APIから再取得する。これにより改ざんと古いスナップショットの登録を防ぐ。

一意制約は以下である。

```text
userId + source + externalCalendarId + externalEventId
```

取り込みは一回限りのコピーを基本とする。同じ予定を再度取り込むと最新スナップショットで更新するが、バックグラウンド同期は行わない。

## 6. 衝突検知

`ScheduleItem`へ正規化してから純粋関数`detectConflicts`で判定する。

対象:

- 提示中・確定済みProposedSlot
- CONFIRMED Interview
- 取込済みScheduleEvent
- 未取込Google Calendar event

取込済み外部イベントは外部キーでライブGoogle予定を除外して二重判定を防ぐ。transparent Google予定は対象外とする。

## 7. Gmail検索・本文取得

```text
/email-import?q=...
  -> Gmail messages.list
  -> message IDごとにmetadata取得
  -> ユーザーが1件を選択
  -> Gmail messages.get(format=full)
  -> MIME本文抽出
```

検索結果は25件単位。Gmail page token履歴はURL-safe Base64でクエリに保持する。

本文は次の順で処理する。

1. 添付ではない全`text/plain`パートを収集・重複排除
2. plain textがなければHTMLパートをテキスト化
3. Unicode、改行、空白を正規化
4. 最新本文と引用・転送履歴へ分離
5. 最新12,000文字、引用5,000文字を抽出入力に使用

メール本文そのものはDBへ保存しない。

## 8. AI抽出

Cloudflare Workers AI Responses APIへstrict JSON Schemaを要求し、返却JSONをZodで再検証する。Cloudflareの[JSON Mode](https://developers.cloudflare.com/workers-ai/features/json-mode/)はSchema準拠を保証しないため、検証失敗時は登録も自動反映も行わない。既定モデルは`@cf/openai/gpt-oss-120b`、reasoning effortは`high`とする。有料AI APIへのフォールバックは実装しない。

プロンプトにはユーザータイムゾーン、処理基準日時、メール受信日時、件名、送信者、スニペット、最新本文、引用履歴を渡す。

抽出結果はZodで再検証する。

- 日時は明示offset必須
- 開始日時 < 終了日時
- stage typeはアプリのenumだけ許可
- confidenceは0〜1
- relevantとeventTypeは必須
- 自動反映に使う全フィールドのfield confidenceは必須

`AiExtractionResult`へ抽出JSON、総合confidence、モデル名、プロンプト版を保存する。AI応答のtoken usageは日次無料枠制御に使う。確認後の入力は`reviewedJson`へ保存する。

## 8.1 Gmail監視フロー

```text
Scheduled Function (*/15 * * * *)
  -> EMAIL_MONITOR_WORKER_SECRETで署名
  -> Background Function
      -> enabledなEmailMonitorConfigを列挙
      -> query + after cursorでGmail messages.list
      -> message IDをEmailImport / EmailAutomationJobへ永続化
      -> 1件ずつ本文取得・AI抽出
      -> decision policy
          -> AUTO_APPLIED
          -> REVIEW_REQUIRED
          -> IGNORED
          -> RETRY_WAIT / FAILED
```

初回有効化時に`monitoringSince`とcursorを現在時刻へ設定する。通常の検索には10分のoverlapを入れるが、取得後にGmail `internalDate >= monitoringSince`をミリ秒精度で再検証する。jobを永続化してからcursorを進める。1回のscanで最大25件をJob化し、Background FunctionはNetlifyの15分実行上限を守るためAI処理を最大2件ずつ行う。日次10,000 Neurons到達時は未処理jobを翌日へ残す。

`EmailAutomationJob`はleaseとattemptを持ち、Gmail message IDと内容digestで冪等性を保証する。raw bodyはjob、error、logへ含めない。

手動Gmail取込も同じ`EmailImport / EmailAutomationJob`を利用する。同期Server ActionはGmail本文を一時取得してdigestを作り、署名付きBackground FunctionへJob IDを渡した時点で応答する。Background Functionが本文を再取得してdigestを照合し、AI抽出、自動反映または確認待ちへの振り分けまで実行する。Gmail抽出には最大5分を許容し、手動Jobのleaseはこの上限より長くする。画面は軽量なServer ActionでJob状態だけをポーリングする。これによりNetlifyの同期実行上限からAI推論時間を分離し、本文をDBへ保存せず再実行の冪等性も維持する。

AI呼出し前に、JSON Schema・promptを含む実リクエストのUTF-8 byte数、サーバーフレーミング余裕、最大出力4,096 tokenから保守的な最大使用量を算出し、`AiDailyUsage`へSerializable transactionで予約する。成功時は実usageで精算し、応答不明の失敗は予約全量を使用済みとみなす。これにより入力サイズにかかわらず、Scheduled実行と「今すぐ実行」が重なっても日次上限を共有する。

## 8.2 自動反映ポリシー

既存のcompany / position正規化照合を共通利用し、一意なApplication完全一致を必須にする。総合confidenceと変更対象フィールドconfidenceがすべて0.90以上の場合だけtransactionを開始する。

- `CREATE_OR_UPDATE`: 一意な既存応募内で、安全に特定できるstage / interview / slot / deadlineだけを作成または更新する。
- `RESCHEDULE`: 同じstage typeの有効Interviewが一件だけの場合に限り更新する。
- `CANCEL`: 自動変更せず確認待ちにする。
- 新規応募、曖昧一致、手入力データとの競合: 自動変更せず確認待ちにする。

変更前後は`EmailAutomationChange`へ、利用者向け概要は`ActivityLog`へ保存する。どちらにもメール本文を含めない。

## 9. 応募登録トランザクション

AI確認画面からの登録は次を1トランザクションで実行する。

1. Company
2. Application
3. SelectionStage
4. Interview
5. ProposedSlot
6. Deadline
7. ActivityLog
8. AiExtractionResultの確認済み更新

登録済み`AiExtractionResult`は既存`createdApplicationId`を返し、二重登録しない。

ブラウザの`datetime-local`はoffsetを持たないため、User.timezoneまたは候補日時のtimezoneを使い、サーバー環境のローカルタイムに依存せずUTCへ変換する。

## 10. エラー処理

| 状態 | 挙動 |
|---|---|
| OAuth未連携・scope不足 | 設定または再ログインへ誘導 |
| token期限切れ | refresh tokenで更新、失敗時は再認証 |
| Calendar API無効 | Google Cloud Consoleへの導線表示 |
| Google event削除済み | 取込失敗として画面表示 |
| Gmail取得失敗 | メール一覧上に再試行可能なエラー表示 |
| Cloudflare Workers AI timeout / 429 | 手動取込は原因別表示、監視jobはRETRY_WAIT |
| AI日次上限 | 未処理jobを翌日へ繰り越し |
| Gmail監視のtoken失効 | configを停止し再認証を表示 |
| JSON schema不一致 | 登録せず形式エラーを表示 |
| DB登録失敗 | トランザクションをrollback |

## 11. セキュリティ

- Server Action冒頭で`requireUser()`を実行する。
- DB queryは必ず`userId`を条件に含める。
- 外部イベントと応募先の所有権をサーバーで検証する。
- OAuth token、Cloudflare API token、worker secretをClient Componentへ渡さない。
- 外部URLは新しいタブで開き、`rel=noreferrer`を付与する。
- Gmail本文を永続化しない。
- 拡張機能APIはWebセッションではなく個別失効可能なBearer Tokenで認証する。
- 拡張機能TokenはDBへSHA-256 digestだけを保存し、Content Scriptから参照できない。
- 拡張機能APIは媒体host、payload上限、入力schema、ユーザー所有権をサーバーで検証する。
- 企業メッセージ生本文は明示同意した抽出要求のメモリ上だけで扱い、永続化・ログ出力しない。

## 11.1 ブラウザ拡張機能フロー

```text
求人詳細で保存ボタン押下
  -> 公開JSON-LD / 可視DOMを抽出
  -> Service Workerが送信元hostを検証
  -> /api/browser-extension/lookupで保存済み照合
  -> ユーザーが確認・修正
  -> /api/browser-extension/capturesへBearer Token + Idempotency-Keyで送信
  -> Company再利用または作成 + Application + ActivityLogをtransaction保存
```

Content ScriptはTokenを保持せず、API通信はService Workerへ限定する。媒体権限は任意付与し、許可済み媒体だけContent Scriptを動的登録する。

```text
企業メッセージを選択して抽出ボタン押下
  -> 選択本文とCloudflare Workers AI上のgpt-oss送信への個別同意を確認
  -> Service Workerが送信元hostを検証
  -> /api/browser-extension/message-extractionsでstrict JSON Schema抽出
  -> 会社名・ポジションを本人所有Application / Companyと照合
  -> 完全一致は自動選択、表記ゆれは確認、一致なしは新規作成を初期選択
  -> ユーザーが応募先・対象面接・日時・変更/取消を確認
  -> /api/browser-extension/message-eventsへBearer Token + Idempotency-Keyで送信
  -> 必要ならCompany / Applicationを作成し、SelectionStage / Interview / ProposedSlot / ActivityLog / BrowserMessageImportをtransaction更新
```

登録後は既存のApplication queryがInterviewとProposedSlotを取得するため、応募先詳細へ即時反映される。確定Interviewと未確定ProposedSlotは既存dashboard queryの対象であり、専用のダッシュボード複製データは持たない。

## 12. 品質保証

- 純粋変換、スキーマ、日付、衝突検知をVitestで検証する。
- Prisma schema変更時はmigrationと`prisma generate`を実行する。
- 完了条件は`test / typecheck / lint / build`の全成功とする。

## 13. 設計判断の正本

| ルール | OK例 | NG例 | 適用条件 | 根拠 |
|---|---|---|---|---|
| Google連携はreadonly | Google予定をApplyFlowへコピー | Google予定をAPIで更新 | Calendar/Gmail連携全体 | OAuth scope、外部データ保護 |
| 外部予定はサーバー再取得 | event IDからevents.get | クライアント送信日時を保存 | Calendar取込 | 改ざん・鮮度対策 |
| AI結果の自動反映は高信頼・既存一意一致だけ | 90%以上かつ一意な既存応募を更新 | 新規応募・取消・曖昧一致を自動反映 | Gmail監視 | 誤抽出リスク |
| Gmail本文は非永続 | metadataと抽出JSONを保存 | raw bodyをDB保存 | Gmail取込 | プライバシー |
| 企業メッセージは選択・同意・確認 | 選択本文を抽出し応募先を確認 | 画面全文の自動送信・自動登録 | ブラウザ拡張 | プライバシー、誤紐付け防止 |
| ローカル日時はtimezone付き変換 | Asia/TokyoとしてUTC保存 | server timezoneで`new Date` | datetime-local入力 | 実行環境差異防止 |

## 14. 旧版移行

v0.1の段階別将来構想は実装状況と不一致になったため廃止した。本書v1.2を現行アーキテクチャの正本とし、将来構想は「未実装」と明記した項目だけに限定する。

v1.2ではChrome拡張機能、専用Bearer Token、Route Handler、動的ホスト権限を現行アーキテクチャへ追加した。

v1.4ではNetlify Scheduled / Background Function、Neon、EmailMonitorConfig / EmailAutomationJob / EmailAutomationChange、Cloudflare Workers AI上の`@cf/openai/gpt-oss-120b`を追加した。
