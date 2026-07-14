# ApplyFlow アーキテクチャ設計書 v1.1

更新日: 2026-07-14

## 1. システム構成

```text
Browser
  -> Next.js App Router / Server Components / Server Actions
      -> Auth.js + Google OAuth
      -> Prisma Client -> PostgreSQL
      -> Google Calendar API (readonly)
      -> Gmail API (readonly)
      -> OpenAI Responses API
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

OpenAI Responses APIのstrict JSON Schema出力を使用する。モデルは`OPENAI_MODEL`で切り替えられる。

プロンプトにはユーザータイムゾーン、処理基準日時、メール受信日時、件名、送信者、スニペット、最新本文、引用履歴を渡す。

抽出結果はZodで再検証する。

- 日時は明示offset必須
- 開始日時 < 終了日時
- stage typeはアプリのenumだけ許可
- confidenceは0〜1

`AiExtractionResult`へ抽出JSON、総合confidence、モデル名、プロンプト版を保存する。確認後の入力は`reviewedJson`へ保存する。

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
| OpenAI timeout / 429 | 原因別メッセージを表示 |
| JSON schema不一致 | 登録せず形式エラーを表示 |
| DB登録失敗 | トランザクションをrollback |

## 11. セキュリティ

- Server Action冒頭で`requireUser()`を実行する。
- DB queryは必ず`userId`を条件に含める。
- 外部イベントと応募先の所有権をサーバーで検証する。
- OAuth token、OpenAI API keyをClient Componentへ渡さない。
- 外部URLは新しいタブで開き、`rel=noreferrer`を付与する。
- Gmail本文を永続化しない。

## 12. 品質保証

- 純粋変換、スキーマ、日付、衝突検知をVitestで検証する。
- Prisma schema変更時はmigrationと`prisma generate`を実行する。
- 完了条件は`test / typecheck / lint / build`の全成功とする。

## 13. 設計判断の正本

| ルール | OK例 | NG例 | 適用条件 | 根拠 |
|---|---|---|---|---|
| Google連携はreadonly | Google予定をApplyFlowへコピー | Google予定をAPIで更新 | Calendar/Gmail連携全体 | OAuth scope、外部データ保護 |
| 外部予定はサーバー再取得 | event IDからevents.get | クライアント送信日時を保存 | Calendar取込 | 改ざん・鮮度対策 |
| AI結果は人が確認 | 確認画面から登録 | 抽出直後に自動登録 | メール取込 | 誤抽出リスク |
| Gmail本文は非永続 | metadataと抽出JSONを保存 | raw bodyをDB保存 | Gmail取込 | プライバシー |
| ローカル日時はtimezone付き変換 | Asia/TokyoとしてUTC保存 | server timezoneで`new Date` | datetime-local入力 | 実行環境差異防止 |

## 14. 旧版移行

v0.1の段階別将来構想は実装状況と不一致になったため廃止した。本書v1.1を現行アーキテクチャの正本とし、将来構想は「未実装」と明記した項目だけに限定する。
