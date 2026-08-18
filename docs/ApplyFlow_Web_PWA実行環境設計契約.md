# Design Contract: Web / PWA実行環境への特化

## Context and outcome

- Problem: 配布文書とChrome拡張機能にDocker、開発用DB、平文HTTP接続先が残り、本番Web/PWAの利用経路と混在している。
- Users: PC版Chrome、またはiPhone 14以降のSafari/PWAからApplyFlowを利用する求職者。
- Desired outcome: Netlify / Neonで公開したHTTPS Webアプリを正本とし、PC版ChromeとiOS PWAの既存機能を安全に利用できる。
- Why now: 実行環境を本番Web/PWAへ絞り、不要な開発用配布導線と平文HTTP権限をなくすため。

## Completion criteria

- [ ] `docker-compose.yml`とREADMEのDocker・ローカル起動導線がない。
- [ ] セットアップ文書と環境変数例がNetlify / Neonと本番HTTPSを前提にしている。
- [ ] Chrome拡張機能はHTTPSのApplyFlow URLだけを保存し、平文HTTPを明確なエラーで拒否する。
- [ ] Chrome拡張機能の任意ホスト権限はHTTPSだけを宣言する。
- [ ] PC sidebar、mobile nav、PWAインストール、iOS standaloneのpull-to-refreshを維持する。
- [ ] 対象テスト、全テスト、型検査、Lint、production buildが成功する。

## Non-goals

- Chrome拡張機能自体の削除。
- DBスキーマやAPI形状の変更。
- オフライン同期、UI全面再設計、新しい依存パッケージの追加。
- Google Calendar書き込みやOAuth scopeの変更。

## Constraints and invariants

- Service Workerは認証済みHTML、APIレスポンス、ユーザーデータをキャッシュしない。
- PC版のsidebarとスマートフォン版のmobile navを維持する。
- 業務データの入力で使う`datetime-local`はローカル日時を表す正しい用語であり、削除対象にしない。
- 通常のWeb/PWA利用は既存の認証、データ取得、更新経路を維持する。
- 既存依存とWeb標準だけを使う。

## Responsibilities and interfaces

| Boundary | Owner | Input | Output | Must not do |
| --- | --- | --- | --- | --- |
| Production runtime | README、`.env.example`、Netlify / Neon手順 | 本番DB URL、OAuth設定、HTTPS origin | PC Chrome / iOS PWA共通の公開URL | Dockerや開発用DBを配布要件に戻さない |
| Chrome extension connection | options、background、manifest | 利用者が入力したApplyFlow URL | HTTPS originへの任意ホスト権限とAPI通信 | 平文HTTPを保存・通信しない |
| PWA lifecycle | metadata、manifest、Service Worker、pull-to-refresh | iOS standalone環境 | インストール可能なオンライン専用PWA | 認証済みレスポンスをキャッシュしない |
| Responsive shell | sidebar、mobile nav | PC / iPhone viewport | 既存情報構造に応じたナビゲーション | 全面再設計や画面分岐を増やさない |

## Decisions

| Decision | Choice | Reason | Rejected alternative |
| --- | --- | --- | --- |
| 配布環境 | Netlify + Neonの本番HTTPS | 既存デプロイ構成を正本にでき、PCとiOSで同じoriginを使える | Dockerを利用者向け導線として維持する |
| 拡張機能URL | HTTPSのみ | Token付きAPI通信の平文送信と不要なホスト例外を防げる | 開発用ホストだけHTTPを許可する |
| PWAデータ | オンライン正本 | 認証済み業務データの古いキャッシュ表示を避ける | オフラインDBや同期を追加する |
| UI対応 | 既存responsive shellを維持 | PC sidebarとiOS mobile navが既に完成条件を満たす | 実行環境ごとに別UIを作る |

## Failure, migration, and rollback

- Failure behavior: Chrome拡張機能へHTTPS以外のApplyFlow URLを入力した場合は、権限要求や保存を行わず「ApplyFlow URLにはHTTPS URLを指定してください」と表示する。通常Web/PWAは従来どおり動作する。
- Compatibility or migration: DB/API移行はない。旧形式の平文HTTP URLがChrome storageに残っていても未設定として扱い、HTTPS URLの再設定を求める。
- Rollback: 文書、環境変数例、拡張機能URL検証、manifestの差分を戻せる。DB migrationはない。

## Verification

| Criterion | Check | Expected evidence |
| --- | --- | --- |
| 不要な実行環境の削除 | ファイル・全文検索 | Docker定義と開発用ホスト例外が存在しない |
| HTTPS境界 | optionsの操作テスト、manifest契約テスト | HTTPは保存前に拒否し、HTTPSだけ権限要求・保存する |
| PWA不変条件 | PWA / pull-to-refreshテスト | network-only SW、standalone、iOS限定gestureが維持される |
| ナビ不変条件 | PWA契約テストと既存回帰テスト | PC sidebarとmobile navが維持される |
| 品質ゲート | `npm test`、`npm run typecheck`、`npm run lint`、`npm run build` | 全コマンド成功 |

## Risks and human review

- Windowsの自動テストではiOS Safariのホーム画面追加UIとsafe area描画を完全再現できないため、実機でのPWAインストール確認は人間が行う。
- Chrome拡張機能は開発者モード配布のため、実際の権限ダイアログと本番URL接続をPC版Chromeで最終確認する。
- Google OAuth redirect URIとNetlify環境変数が本番HTTPS URLに一致しているかは、デプロイ時に人間が確認する。

## Open questions

- None.
