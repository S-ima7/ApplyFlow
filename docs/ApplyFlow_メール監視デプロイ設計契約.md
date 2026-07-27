# ApplyFlow メール監視・無料AIデプロイ設計契約

## Context and outcome

- Problem: Gmail取込は利用者が画面を開いて実行する必要があり、OpenAI APIはChatGPT契約と別に従量課金される。
- Users: ApplyFlowを個人利用する既存ユーザー。
- Desired outcome: Gmail readonly検索を15分間隔で実行し、安全条件を満たす新着メールだけを既存応募へ自動反映する。AIとホスティングに追加月額費用を発生させない。
- Why now: 選考メールの見落としと手作業を減らし、現在の低性能な抽出モデルを置き換える。

## Completion criteria

- [ ] 監視を有効化した時刻より後の検索一致メールが、通常15分以内、遅くとも2監視周期以内に永続ジョブになる。
- [ ] 90%以上の総合・変更対象フィールド信頼度と、一意な既存応募・対象面接を満たすメールだけが一度だけ自動反映される。
- [ ] 新規応募、曖昧一致、取消、手入力データを上書きする変更は確認待ちになり、ドメインデータを変更しない。
- [ ] メール本文がDB、アプリログ、監査ログに保存されない。
- [ ] メール取込とブラウザ拡張がGroq上の`openai/gpt-oss-120b`を使用し、有料OpenAI APIへフォールバックしない。
- [ ] Netlify Free、Neon Free、Groq Freeの上限到達時は課金せず処理を保留する。
- [ ] 単体・統合テスト、型検査、Lint、production build、プレビュー相当のスモーク検証を通過する。

## Non-goals

- 無料サービス上での稼働SLA保証。
- Gmail、Google Calendar、企業サイトへの書込み権限追加。
- 自動的な企業・応募先の新規作成。
- 取消メールの自動反映。
- カスタムドメイン、課金プラン、自動課金フォールバック。
- 過去メールの一括自動処理。

## Constraints and invariants

- Gmail権限はreadonlyを維持する。
- 初回有効化時の現在時刻を処理開始点とし、それ以前のメールは自動処理しない。
- Gmail message IDと内容ダイジェストで冪等性を保証する。
- 処理カーソルは検索結果を永続ジョブ化した後にだけ進め、10分の重複区間を設ける。
- 自動反映は一つのDBトランザクションで行い、監査可能な変更前後情報を残す。
- 手入力の候補日時・期限を自動削除または上書きしない。
- AIはStrict JSON Schemaで検証し、総合と変更対象フィールドのconfidenceがすべて0.90以上でなければ自動反映しない。
- AI日次トークン使用量が180,000へ達した場合、残件は翌日へ繰り越す。
- 秘密情報、メール本文、移行ダンプをGitへ保存しない。

## Responsibilities and interfaces

| Boundary | Owner | Input | Output | Must not do |
| --- | --- | --- | --- | --- |
| AI client | `lib/ai` | Strict Schema、抽出入力 | 検証済みJSON、model、usage | 有料OpenAIへフォールバックしない |
| Gmail poller | email monitor | user、query、cursor | 永続化済みjob、次cursor | 本文を永続化しない |
| Decision policy | email automation | extraction、既存応募候補 | AUTO_APPLIEDまたはREVIEW_REQUIRED | 新規応募・取消を自動反映しない |
| Registration service | message registration domain | target、event、schedule | transaction result、activity log | 手入力データを黙って上書きしない |
| Scheduler | Netlify Scheduled Function | 15分cron | 署名付きbackground起動 | 外部公開の管理APIを作らない |
| Worker | Netlify Background Function | internal secret | 最大25件の逐次処理 | 無料枠を越えて有料処理しない |
| Settings UI | authenticated user | enabled、query、consent | monitor config、状態表示 | 同意なしに監視を有効化しない |

## Decisions

| Decision | Choice | Reason | Rejected alternative |
| --- | --- | --- | --- |
| Hosting | Netlify Free | Next.js、定期・background関数、無料枠上限で停止 | Vercel Hobbyはcronが日次、常駐無料VMは停止・期限制約 |
| Database | Neon Free / AWS Ohio | Netlify既定リージョンに近く、pooled/direct URLを分離可能 | Netlify Databaseは費用予測が弱い |
| AI | Groq Free上の`openai/gpt-oss-120b`、reasoning high | OpenAI製の最上位open-weightモデルを追加課金なしで利用 | OpenAI APIはChatGPT契約と別課金 |
| Monitoring | 15分Gmail polling | Pub/Sub課金口座を不要にし、無料構成を維持 | Gmail PushはGCP Pub/Subとwatch更新が必要 |
| Automatic action | 既存応募への高信頼変更のみ | 誤登録・取消の不可逆影響を抑える | 全件自動登録 |

## Failure, migration, and rollback

- Failure behavior: 429、5xx、network errorはRETRY_WAITへ戻す。日次上限は翌日まで保留する。Google認証失効は監視を停止して再認証を表示する。再試行上限後はFAILEDとして本文なしのエラー概要を保存する。
- Compatibility or migration: 既存DBを`pg_dump --no-owner --no-acl`でNeonへ復元し、新しいPrisma migrationを`DIRECT_URL`へ適用する。SessionとVerificationTokenは移行せず再ログインする。ブラウザ拡張の公開API契約は維持する。
- Rollback: monitor configを無効化しScheduled Functionを停止して直前アプリ版へ戻す。DB変更は追加型とし、自動down migrationを行わない。移行元DBは受入完了まで保持する。

## Verification

| Criterion | Check | Expected evidence |
| --- | --- | --- |
| Safe auto-apply | policy/domain tests | 高信頼・一意一致のみ一回更新 |
| Review guardrails | adversarial fixtures | 新規、曖昧、取消、手入力衝突の自動変更0件 |
| Privacy | persistence/log assertions | raw bodyがDB・ログに存在しない |
| Idempotency | worker retry/concurrency tests | job、slot、activityの重複0件 |
| AI quality | synthetic live evaluation | Strict Schema 100%、重要項目90%以上 |
| Compatibility | existing full test suite | ブラウザ拡張・手動取込を含む回帰なし |
| Deployability | typecheck、lint、build、function smoke | 全コマンド成功、cronからbackground起動 |

## Risks and human review

- Google OAuth access/refresh token、BrowserExtensionTokenをNeonへ移す操作。
- メール本文がGroqの米国インフラへ一時送信されることとZero Data Retentionの有効化。
- Netlify、Neon、Groqの無料条件と上限はデプロイ直前に公式画面で再確認する。
- 本番OAuth redirect URI、環境変数、production deploy、データ切替は人間が重点確認する。

## Open questions

- None.
