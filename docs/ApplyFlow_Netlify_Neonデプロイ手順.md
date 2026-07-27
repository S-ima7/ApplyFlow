# ApplyFlow Netlify / Neonデプロイ・移行手順

## 1. 無料枠と外部設定の確認

本手順はNetlify Free、Neon Free、Groq Freeを前提とする。各サービスの料金画面で次を確認し、従量課金への自動移行や自動リチャージを有効にしない。

- Netlify: Freeプラン、月間クレジット残量、production branch
- Neon: Freeプラン、AWS US East (Ohio)、ストレージ・compute使用量
- Groq: Free Developer tier、`openai/gpt-oss-120b`のrate limit、Zero Data Retention有効

無料条件が設計契約と異なる場合はデプロイを中止する。有料プランや別モデルへ自動的に切り替えない。

## 2. Preview環境

1. feature branchをNetlifyへ接続し、Deploy Previewを有効にする。
2. Neonに空のpreview branchを作り、productionとは異なるpooled URLとdirect URLを設定する。
3. Google OAuth clientへPreview URLのcallbackを追加する。
4. Preview contextだけにテスト用の環境変数を設定する。
5. production DB URL、production OAuth token、移行元DBのdumpをPreviewへ渡さない。
6. `npm run prisma:migrate:deploy`をpreviewのdirect URLに対して明示実行してからbuildする。

Netlify build commandは`npm run build`であり、build中にDB migrationを実行しない。

## 3. Production環境変数

NetlifyのProduction contextへ次をserver-side secretとして設定する。

```env
DATABASE_URL="<Neon pooled URL>"
DIRECT_URL="<Neon direct URL>"
AUTH_SECRET="<32 bytes以上のランダム値>"
AUTH_GOOGLE_ID="<Google OAuth client ID>"
AUTH_GOOGLE_SECRET="<Google OAuth client secret>"
AUTH_URL="https://<site>.netlify.app"
NEXTAUTH_URL="https://<site>.netlify.app"
AI_PROVIDER="groq"
AI_MODEL="openai/gpt-oss-120b"
AI_REASONING_EFFORT="high"
AI_DAILY_TOKEN_BUDGET="180000"
GROQ_API_KEY="<Groq API key>"
EMAIL_MONITOR_WORKER_SECRET="<32 bytes以上のランダム値>"
```

秘密値を`.env.example`、Netlify build log、Git、Issue、PRへ貼り付けない。

## 4. 既存PostgreSQLの移行

1. ApplyFlowへの書込みを停止する。
2. 移行元を読み取り専用として扱い、TLS接続でdumpする。
3. SessionとVerificationTokenを除外し、所有者・ACLを含めずにdumpする。
4. 空のNeon production DBへrestoreする。
5. 新しいmigrationをdirect URLへ適用する。

```bash
pg_dump --format=custom --no-owner --no-acl \
  --exclude-table-data='"Session"' \
  --exclude-table-data='"VerificationToken"' \
  --file=applyflow-production.dump \
  "$SOURCE_DATABASE_URL"

pg_restore --no-owner --no-acl --clean --if-exists \
  --dbname="$DIRECT_URL" \
  applyflow-production.dump

npm run prisma:migrate:deploy
```

restore後に全テーブルの件数、外部キー、代表的な応募・面接・期限、Google Account token、BrowserExtensionTokenを確認する。Sessionを移行しないため利用者は再ログインする。dumpは確認完了後に安全に削除し、Gitへ追加しない。

## 5. OAuth・ブラウザ拡張

Google Cloud Consoleで次のcallbackをproduction OAuth clientへ追加する。

```text
https://<site>.netlify.app/api/auth/callback/google
```

Calendar APIとGmail APIを有効化し、要求scopeがCalendar readonlyとGmail readonlyのままであることを確認する。

Chrome拡張機能をproduction URLで再buildし、利用者側で新しい`browser-extension/dist`を読み込む。DBを全移行するため既存の未失効BrowserExtensionTokenは継続利用できる。

## 6. Canaryと受入確認

1. production deploy直後は全利用者のメール監視をOFFにする。
2. 一利用者だけ監視を有効にする。
3. 検索条件に合う合成テストメールを送る。
4. 2監視周期以内にjobが作られることを確認する。
5. 高信頼・一意一致だけが一回反映され、曖昧・取消メールが確認待ちになることを確認する。
6. DBとNetlify logにメール本文がないことを確認する。
7. Netlify、Neon、Groqの使用量を24時間監視する。
8. 問題がなければ残りの利用者が各自で明示的に監視を有効化する。

## 7. ロールバック

1. 設定画面からmonitorをOFFにする。
2. Netlify Scheduled Functionを無効化するか、直前のdeployへrollbackする。
3. `PENDING`と`RETRY_WAIT`のjobは削除せず保持する。
4. DBの自動down migrationは実行しない。
5. 受入完了まで移行元DBを保持し、必要ならアプリ接続先を移行元へ戻す。
