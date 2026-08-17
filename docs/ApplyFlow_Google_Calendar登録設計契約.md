# ApplyFlow Google Calendar登録設計契約

更新日: 2026-08-17

## 1. 目的と完成条件

Gmail、PC Chrome、手入力からApplyFlowへ登録された確定面談を、利用者の明示操作で本人のGoogle Primary Calendarへ登録できるようにする。

- ログイン利用者が所有する`CONFIRMED` Interviewだけを対象とする。
- `confirmedStartAt`と`confirmedEndAt`が存在し、開始が終了より前の場合だけ登録する。
- タイトル、会社名、ポジション、場所、面談URL、説明、開始・終了日時をDBからGoogle Eventへ変換する。
- 成功、登録済み、権限不足、API失敗を応募詳細の面談カード内へ表示する。
- 再操作、並行操作、作成応答が不明な場合にも同じ面談を重複作成しない。

## 2. 非目標

- Google由来の`ScheduleEvent`、候補日時、期限の再登録
- 自動登録、常時双方向同期、Google予定の更新・削除同期
- 登録先カレンダーの選択
- Google側の変更をInterviewへ反映すること
- DBスキーマ変更

## 3. 制約と不変条件

- Server Actionが`Interview.id / userId / deletedAt`と親Applicationの有効性を検証する。
- クライアントから受け取るのはInterview IDだけとし、タイトルや日時を信用しない。
- Primary Calendar固定で`events.insert`を使い、`sendUpdates=none`を明示する。
- OAuthは既存の`calendar.readonly`を維持し、最小の書き込みscopeとして`calendar.events.owned`を追加する。
- access token更新は`lib/google-auth.ts`の共通処理を再利用する。
- 新しい依存関係を追加しない。

## 4. 責務境界

| 責務 | 所有箇所 |
| --- | --- |
| OAuth scope、token取得、Google Event変換・API呼び出し | `lib/google-calendar.ts` |
| ログイン・所有権・Interview状態のDB再検証 | `features/calendar/actions.ts` |
| 利用者操作と結果表示 | 応募詳細の面談カード |
| 登録済みGoogle予定の二重表示・自己衝突除外 | Calendar / conflict query |

## 5. API形状

Before: Calendar APIは`events.list`と`events.get`による読み取りだけを行う。

After: 次のイベントをPrimary Calendarへ作成する。

```http
POST /calendar/v3/calendars/primary/events?sendUpdates=none
```

```json
{
  "id": "<userIdとInterview.idから生成した64文字のSHA-256 hex>",
  "summary": "Example株式会社｜最終面接",
  "description": "会社: Example株式会社\nポジション: Engineer\n面談URL: https://example.com/meeting\n説明: 面談メモ",
  "location": "東京本社",
  "start": { "dateTime": "2026-08-20T01:00:00.000Z" },
  "end": { "dateTime": "2026-08-20T02:00:00.000Z" },
  "extendedProperties": {
    "private": { "applyFlowInterviewKey": "<同じSHA-256 hex>" }
  }
}
```

SHA-256 hexはGoogle Event IDが許可するbase32hex文字の部分集合であり、長さ要件も満たす。`userId`を含め、同一Interview IDが別利用者領域へ現れた場合もキーを分離する。

## 6. 冪等性と失敗時動作

初回は決定的event IDで`events.insert`する。409の場合は同じIDを`events.get`し、イベントがキャンセル済みでなく、private markerが一致する場合だけ「登録済み」として成功を返す。marker不一致、GET失敗、削除済みイベントはAPI失敗として扱い、別IDで再作成しない。

通信断で作成結果が不明な場合は失敗を表示するが、再操作は同じevent IDを使うため重複しない。401、token欠落、scope不足、書き込み権限の403は再ログインへ誘導する。429とその他のGoogle API障害はAPI失敗として表示する。

## 7. UI/UX

応募詳細はデータの出所を問わず確定面談を発見できる既存画面であるため、面談カードへ登録ボタンを置く。処理中と成功後は多重操作を無効化し、登録URLが返った場合はGoogle Calendarを開ける。既存利用者が追加scopeを持たない場合は、設定画面のGoogle再ログインへ案内する。

## 8. 検証可能な振る舞い

- 他利用者のInterview IDではGoogle APIを呼ばない。
- 未確定、日時欠落、開始以後に終了する面談ではGoogle APIを呼ばない。
- POST先がPrimary Calendarで、通知を送らない。
- 同じ利用者と面談から常に同じGoogle Event IDを生成する。
- 409後のmarker一致だけを登録済み成功にする。
- 作成済みGoogleイベントを統合カレンダーへ重複表示せず、元面談との衝突に数えない。

## 9. リスクと人間確認

- 追加scopeを本番OAuth同意画面へ登録し、公開アプリに必要なGoogle審査状態を運用者が確認する。
- Google側で登録イベントを削除した場合、同じevent IDの再利用可否はGoogleの削除済みイベント保持に依存する。本機能は削除・復元同期を対象外とする。
- 認証・権限・外部API書き込みを含むため、本番反映前に実Googleアカウントで追加同意、作成、再操作、通知なしを人間が確認する。

## 10. 公式仕様

- [Events: insert](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert)
- [Events: get](https://developers.google.com/workspace/calendar/api/v3/reference/events/get)
- [Calendar API scopes](https://developers.google.com/workspace/calendar/api/auth)
- [Calendar API errors](https://developers.google.com/workspace/calendar/api/guides/errors)
