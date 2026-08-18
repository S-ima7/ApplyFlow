# Design Contract: iPhone Safari / PWA対応

## Context and outcome

- Problem: 現行UIには部分的なモバイル対応があるが、iPhone Safari固有のsafe area、入力フォーカス時の自動ズーム、動的viewport高、ホーム画面追加に必要なPWA情報が揃っていない。
- Users: iPhone 14以降を使い、Safariまたはホーム画面からApplyFlowを利用する求職者。
- Desired outcome: 主要画面と主要操作を横スクロールなしで利用でき、Safariの「ホーム画面に追加」からオンライン前提の独立したWebアプリとして起動できる。
- Why now: PC中心の利用経路を、移動中にも確認・更新できるiPhoneへ広げるため。

## Completion criteria

- [ ] iPhone 14系の代表的なCSS viewport（幅390px、430px）で、ログイン、ダッシュボード、応募、カレンダー、返信待ち、期限、メール取込、設定の主要操作にページ全体の横スクロールが発生しない。
- [ ] ノッチ、Dynamic Island、ホームインジケータ領域と、固定ヘッダー・下部ナビ・下端シートが重ならない。
- [ ] 入力欄へフォーカスしてもSafariの文字サイズ起因の自動ズームが発生せず、主要なタップ領域は44px以上ある。
- [ ] manifest、アプリアイコン、テーマ色、standalone表示、Service Worker登録が提供され、Safariからホーム画面へ追加して起動できる。
- [ ] 画面回転後もカレンダーが幅に応じた表示へ更新される。
- [ ] 既存の認証、データ取得、更新、PC表示を壊さず、テスト、型検査、Lint、production buildが成功する。

## Non-goals

- オフライン時のデータ参照・更新・同期。
- Web Push通知、バックグラウンド同期、アプリストア配布。
- Android、iPhone 13以前、iPadを個別の完成保証対象にすること。
- iOS Safariでは利用できないChromeブラウザ拡張機能を代替すること。

## Constraints and invariants

- ユーザーデータ、API、DBスキーマ、認証方式は変更しない。
- Service Workerは認証済みHTMLやAPIレスポンスをキャッシュしない。常にネットワークを正本とする。
- 既存の青・白・Slateを中心とするUI、情報構造、PC向けサイドバーを維持する。
- ズーム操作を禁止せず、アクセシビリティを維持する。
- 新しい依存パッケージは追加せず、Next.js metadata API、Web App Manifest、標準Service Worker、既存Tailwind CSSを使う。

## Responsibilities and interfaces

| Boundary | Owner | Input | Output | Must not do |
| --- | --- | --- | --- | --- |
| App metadata | `app/layout.tsx`, metadata routes | アプリ名、色、表示方針 | Safari/PWAが読むmetadataとmanifest | 認証・業務データへ依存しない |
| PWA lifecycle | 登録用client component、`public/sw.js` | ブラウザのService Worker API | 同一originのService Worker登録 | HTML/API/個人データをキャッシュしない |
| Mobile shell | dashboard layout、header、bottom nav、global CSS | viewportとsafe-area環境変数 | 安全領域内の固定UI | PCナビの情報構造を変えない |
| Screen content | 既存page / form / calendar components | 既存データと操作 | iPhone幅で読めて操作できる配置 | API形状や保存形式を変えない |
| Verification | テスト、静的検査、browser smoke | 390/430px表示、PWA資産 | 完成条件の観測証拠 | コマンド成功だけで完了扱いしない |

## Decisions

| Decision | Choice | Reason | Rejected alternative |
| --- | --- | --- | --- |
| 「WPA」の解釈 | PWA（Progressive Web App） | Safari対応と併記され、一般的なWebアプリ要件として整合する | Wi-Fi Protected AccessはWebアプリ実装の範囲外 |
| 対応形態 | オンライン前提のinstallable PWA | 認証済み業務データを古いキャッシュから表示する危険を避けつつ、ホーム画面起動を実現できる | 今回の要件にないオフラインDB・同期 |
| モバイル対応 | 既存responsive UIの修正とsafe-area対応 | 既存のカード表示・下部ナビを再利用できる | 別モバイルアプリ、別画面群 |
| アイコン | Next.jsのimage metadata routeで生成 | バイナリ資産管理や追加依存なしで必要サイズを生成できる | 手作業の複数PNG、画像生成サービス |
| Service Worker更新 | 登録時に更新確認、activate時に即時引継ぎ | 古いshellを保持せず、オンライン正本を維持する | cache-first/offline-first |

## Failure, migration, and rollback

- Failure behavior: Service Worker登録に失敗しても通常のSafari Webサイトとして機能を継続する。登録エラーは開発環境のconsoleへ記録する。
- Compatibility or migration: DB/API移行はない。既存利用者は再ログイン不要。既に開いているタブは再読込後に新しいUIを使う。
- Rollback: metadata route、登録component、Service Worker、responsive class/CSSの差分を戻せば従来のWebアプリへ戻る。

## Verification

| Criterion | Check | Expected evidence |
| --- | --- | --- |
| PWA構成 | manifest/icon/swのテストとproduction build | 正しい名前、standalone、色、アイコン、同一origin SWが出力される |
| iPhone表示 | 390x844、430x932のbrowser smokeとスクリーンショット | viewport幅を超えるdocument要素がなく、固定UIがsafe areaを含む |
| Safari入力 | 共通input/select/textareaのcomputed font-size確認 | 390pxで16px以上 |
| カレンダー回転 | matchMedia変更処理のテストまたは実ブラウザ確認 | 狭幅は日表示、広幅は週表示へ切り替わる |
| 回帰 | `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` | 全コマンド成功 |

## Risks and human review

- Windows環境では実機Safariのホーム画面追加UIとノッチ描画を完全再現できないため、最終的な実機インストール確認は人間が行う。
- OAuthの本番redirect URIとHTTPS配信は既存デプロイ設定に依存する。PWAの配布は本番HTTPSを必須とする。
- iOSのバージョン差は機種だけでは固定できない。対象機種ではサポート中の最新iOS Safariを前提とする。

## Open questions

- None. 「WPA」はPWAとして進め、異なる意図だった場合はこの契約を更新する。
