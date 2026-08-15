# アイドルノート 引き継ぎ書

最終更新: 2026-08-15

読む人（AI・人間どちらも）が調べ直さずに済むよう、**認証方式・テーブルとRLSの状態・
PIN設計の意図**をここに集約している。変更したら必ず更新すること。

---

## 1. これは何か

9歳の娘が「アイドルになりたい」という夢に向かうプロセスを、親子で管理するWebアプリ。

| 領域 | 内容 |
|---|---|
| 毎日の練習記録 | メニューのチェック＋時間、連続日数、週スタンプ、ヒートマップ |
| 目標とロードマップ | 大目標 → 月目標 → 週目標 → タスク（自己参照の1テーブル）、進捗の自動ロールアップ |
| オーディション/レッスン | 応募先・締切・書類/持ち物チェックリスト・結果、カレンダー |
| 成長の記録 | 写真・できたこと日記・自己PR・動画リンク、身長体重グラフ |
| こども向け | ごほうび、スタンプ、バッジ、親からの応援メッセージ（Realtime） |

同じデータを **こどもモード / おとなモード** の2つのUIで見る。

---

## 2. 技術構成

| 項目 | 内容 |
|---|---|
| フロント | バニラJS（ESモジュール）。**ビルドステップなし**。React/TS/Tailwind 不使用 |
| スタイル | 手書きCSS + CSSカスタムプロパティ。`style.css`（共通）/ `kid.css` / `adult.css` |
| ルーティング | ハッシュルーター（`js/router.js`）。view は動的 import |
| 状態 | `js/store.js` の最小 pub/sub（約60行） |
| バックエンド | Supabase のみ（Edge Function なし） |
| Supabase JS | jsDelivr の ESM CDN から読み込み |
| PWA | `manifest.json` + `sw.js`（Network First） |
| ホスティング | GitHub Pages |
| テスト | `node --test tests/format.test.mjs`（純関数20件）＋ ヘッドレスChromeでの目視確認 |

### ローカル起動
```bash
npm start          # npx serve . -l 3000
npm test           # node --test tests/format.test.mjs
```

---

## 3. 認証方式

- **Supabase Auth の Google ログインのみ**。メール＋パスワードは扱わない
- **親と娘で別アカウント**。`idol_family_members` の `role` で `'parent'` / `'child'` を持つ
- `storageKey: 'idol-auth'` にしている理由: 同じ Supabase プロジェクトを使う taskra とセッションを分けるため
- **1ユーザー＝1家族**（`unique(user_id)`）。ヘルパー関数をスカラー化して RLS を単純化するための制約

### なぜ Google 専用にしたか（2026-08-15 に変更）

初版はメール＋パスワードで作ってあったが、実際に運用しようとした時点で
**この Supabase プロジェクトの全ユーザー14人が Google 認証で、
パスワードを持つアカウントが1つも存在しない**ことが分かった
（taskra 等の同居アプリがすべて Google ログイン）。

親子で使う2つのアカウントも既に Google で作成済みだったため、
パスワードを後付けするより入口を Google に一本化するほうが素直だと判断した。
副次的な利点として、9歳の娘にパスワードの管理を負わせずに済む。

- 通常のログイン: `prompt=select_account`
  （家族で端末を共有するので「前の人のまま黙って入る」のを防ぐ）
- 新規登録という導線は存在しない。初回も2回目も同じボタン1つ
- `#/signup` ルートは削除した

### ★Supabase 側に必要な設定（忘れると必ずハマる）

Supabase は、アプリが渡した戻り先（`redirectTo`）が**許可リストに無い場合、
黙って Site URL に飛ばす**。このプロジェクトの Site URL は taskra なので、
設定を忘れると Google 認証後に `https://app.taskra.jp/` に着地する
（実際に一度これを踏んだ。エラーは出ないので原因が分かりにくい）。

```
Authentication → URL Configuration → Redirect URLs に追加
  http://localhost:3000/**
  https://dat0925.github.io/idol-note/**
```

**Site URL は taskra のまま変えないこと**（変えると taskra 側が壊れる）。

### 削除したもの
`signUp` / `signIn` / `resetPassword` / `verifyPassword` と、
ログイン画面のメール・パスワード欄、新規登録画面。

なお初版には**パスワード再設定が行き止まりになる不具合**があった
（再設定メールは送るが、リンクを開いた後に新しいパスワードを入力する画面が
どこにも無く、`updateUser({password})` を呼ぶ箇所が存在しなかった）。
Google 専用化でこの導線ごと無くなったため、修正ではなく削除で解消している。

### 家族への参加フロー
| 操作 | 手段 | 結果 |
|---|---|---|
| 家族をつくる | RPC `idol_create_family()` | 呼んだ人が **parent**。練習メニュー5種も自動投入 |
| 家族に参加 | RPC `idol_join_family(招待コード)` | 必ず **child**。親への昇格は既存の親が行う |
| コード再発行 | RPC `idol_rotate_invite_code()` | 親のみ |

**`idol_family_members` への直接 INSERT は RLS で禁止**（ポリシーを作っていない）。
理由: `with check (user_id = auth.uid())` にすると family_id を推測されて他人の家族に入られる。
招待コードの検証を挟むため RPC に一本化している。

### 権限昇格の防止
`idol_guard_member_role()` BEFORE UPDATE トリガーで、
- 子による `role` の変更 → 拒否
- 最後の親の降格 → 拒否
- `family_id` の付け替え → 拒否

RLS は列単位の制御ができないため、これがないと子が自分の行の role を parent に書き換えられる。

---

## 4. 主要テーブルと RLS の状態

**すべて RLS 有効。すべて `idol_` 接頭辞**（taskra と同一プロジェクトのため）。

### RLS の判定関数（全ポリシーの土台）
```sql
public.idol_family_id()   -- 自分の family_id を返す（未所属なら NULL）
public.idol_is_parent()   -- 自分が親か
```
どちらも `security definer` + `stable` + `set search_path = public, pg_temp`。
**ポリシーからは必ず `(select public.idol_family_id())` とサブクエリで包んで呼ぶ。**
- `security definer` … `idol_family_members` を参照するポリシーの無限再帰（42P17）を断つため
- `(select ...)` で包む … InitPlan 化して行ごとの関数呼び出しを避けるため

### テーブル一覧

| テーブル | RLS | SELECT | INSERT/UPDATE | DELETE |
|---|---|---|---|---|
| `idol_families` | ✅ | 同family | 直接INSERT不可（RPC経由）/ 親のみUPDATE | 作成者のみ |
| `idol_family_members` | ✅ | 同family | 直接INSERT不可（RPC経由）/ 本人か親 | 本人か親 |
| **`idol_parent_pins`** | ✅ | **本人かつ親のみ** | 本人かつ親 | 本人かつ親 |
| `idol_app_settings` | ✅ | 本人のみ | 本人のみ | 本人のみ |
| `idol_practice_menus` | ✅ | 同family | 同family | 親のみ |
| `idol_practice_logs` | ✅ | 同family | 同family | 同family |
| `idol_practice_log_items` | ✅ | 同family | 同family | 同family |
| `idol_goals` | ✅ | 同family | 同family | 同family |
| `idol_auditions` | ✅ | 同family | **親のみ** | 親のみ |
| **`idol_audition_results`** | ✅ | **親のみ** | **親のみ** | 親のみ |
| `idol_audition_tasks` | ✅ | 同family | 同family | 親のみ |
| `idol_lessons` | ✅ | 同family | 同family | 親のみ |
| `idol_portfolio_entries` | ✅ | 同family | 同family | 同family |
| **`idol_body_records`** | ✅ | **親 or `visible_to_child`** | **親のみ** | 親のみ |
| `idol_cheer_messages` | ✅ | 同family | 本人が著者 / 既読更新は同family | 著者か親 |
| `idol_rewards` | ✅ | 同family | 親のみINSERT / UPDATEは同family※ | 親のみ |
| `idol_earned_badges` | ✅ | 同family | 同family | 親のみ |

※ 子は `status='requested'`（交換したい）まで押せる。`redeemed` への変更と
`cost_points` の変更は `idol_guard_reward_redeem()` トリガーで親に限定。

### ビュー（すべて `security_invoker = true`）
| ビュー | 内容 |
|---|---|
| `v_idol_streaks` | 連続日数（gaps-and-islands）。current / best / total / practiced_today |
| `v_idol_points` | ポイント残高。**残高カラムを持たず常に導出**（改ざん不能） |
| `v_idol_calendar` | 締切・本番・書類期限・レッスンの統合カレンダー |

**`security_invoker` を付け忘れるとビューがオーナー権限で走り、RLS を貫通する。**

### サーバーが正の値（クライアントから書かない）
- `idol_practice_logs.total_minutes` → `idol_recalc_log_total()` トリガー
- `idol_goals.progress_pct`（`progress_mode='auto'` のとき）→ `idol_rollup_goal_progress()` トリガー
- `idol_auditions.shared_result` → `idol_sync_shared_result()` トリガー
- 連続日数・ポイント → 上記ビュー

---

## 5. デリケート情報の扱い（設計の中核）

**Postgres の RLS は行単位でしか効かず、列マスクができない。**
そのため「子に見せたくない情報」は列ではなく**テーブルごと分離**している。

```
idol_auditions          … 案件名・締切・会場・状態      → 家族全員が見る
idol_audition_results   … 合否・講評・親メモ・費用      → 親だけ（RLS）
```

「合格したから娘にも伝えたい」は `idol_audition_results.reveal_to_child` を ON にする。
`idol_sync_shared_result()` トリガーが、共有してよい範囲だけを
`idol_auditions.shared_result` / `shared_result_note` に転記する。
**`parent_memo` と `fee_yen` は転記されない**ので、開示しても親の本音は漏れない。

`idol_body_records` は行ごとの `visible_to_child`。
9歳に体重の数値を毎日見せ続けるリスクを考えて既定は非表示。
「身長だけ本人に見せる」運用ができるよう行単位にしてある。

---

## 6. PIN の設計意図（誤解しやすいので必読）

**PIN は防御ではなく目隠し。** 4桁 = 10,000通りなので、ハッシュが読めれば総当たりは一瞬。

| 層 | 何を守るか | 実装 |
|---|---|---|
| 層1（本命） | 娘が**自分のアカウント**で API / DevTools / curl を叩いても機密が返らない | 上記のRLS |
| 層2（運用） | **親がログインしたままの端末**を娘が触ったときの目隠し | 4桁PIN |

### PIN を忘れたときの本人確認（2026-08-15 に変更）
以前は「親のメール＋パスワード」で確認していたが、Google 専用化にともない
**Google での再ログイン**に置き換えた。`prompt=login` を付けているので、
端末に Google のセッションが残っていても**必ずパスワードを再入力させられる**。
＝ 親のログイン済み端末を娘が触っても、ここは通れない。

Google へ遷移して戻る間にモーダルは失われるため、
`sessionStorage` に印を置き、`app.js` の起動処理で拾って再設定へ進む。
印だけを条件にすると自分で印を書けば通れてしまうので、
`last_sign_in_at` が直近かどうかで「本当に今認証し直したか」を裏取りしている。

- ハッシュ: PBKDF2-SHA256 20万回 + ランダム16byte salt。**平文は保存しない**
- ハッシュを置く `idol_parent_pins` は「本人かつ親」しか SELECT できない（子は行ごと取得不可）
- 解錠フラグは **sessionStorage + 10分TTL**。localStorage には置かない
- 自動施錠: 無操作10分 / タブ非表示60秒 / リロード
- 失敗ロックアウト: 5回で60秒、以降倍々（最大10分）
- リカバリ: 親のメール＋パスワードで本人確認 → PIN再設定（平文は復元できない）
- `role === 'child'` のときはモードトグル自体を描画しない（存在を見せない）

---

## 6.4 こどもモードの文言

**小学5年生を基準にする。漢字を使う。**
ひらがなに開きすぎると、かえって読みにくく、子ども扱いされている感じになる。

| 直す前 | 直したあと |
|---|---|
| れんしゅう / きろく | 練習 / 記録 |
| ぜんぶ / おうえん | 全部 / 応援 |
| こうかん / もくひょう | 交換 / 目標 |
| あんしん番号 / しゃしん | 安心番号 / 写真 |

判断に迷ったら「小5の教科書に出るか」で決める。
「ごほうび」「おうちの人」のように、漢字にすると硬くなる語はひらがなのままでよい。

---

## 6.5 背景ステージ（こどもモードの視差演出）

娘のやる気を上げるための装飾。`css/stage.css` + `js/components/stage.js`。

### 構成
`body` の先頭に `.stage`（`position: fixed`）を差し込み、`.shell` を前面に置く。
奥から glow → stars → hero（イラスト）→ sparks の4層。

### 動かし方（ここが要点）
**JS が書くのは `.stage` の `--sx` / `--sy` だけ**。奥行きごとの合成は
CSS 側の `--depth` に任せる。

```
transform: translate3d(calc(var(--sx) * var(--depth)), calc(var(--sy) * var(--depth)), 0)
```

レイヤーごとに `style.transform` を JS から書きに行くと、レイヤー数ぶん
スタイル再計算が走って古い端末でスクロールが引っかかる。
変数1つの更新なら再計算は1回で済む。

- 入力: スクロール（全端末）＋ ポインタ（デスクトップのみ）
- 目標値へ毎フレーム12%ずつ寄せる。止めた瞬間にピタッと止まらない
- 動かすのは `transform` と `opacity` だけ。`top`/`width` は触らない

### 決めごと
| 項目 | 判断 |
|---|---|
| おとなモード | **出さない**。作業する画面に動くものを置かない（`applyMode` で `destroy`） |
| 装飾の粒 | **絵文字ではなくインラインSVG**。絵文字は端末にフォントが無いと豆腐（□）になる。実際 Windows で `🩷` が四角になった |
| `prefers-reduced-motion` | 動きを全部止める。iOS の「視差効果を減らす」も拾う。静止した装飾としては残す |
| 支援技術 | `aria-hidden="true"` + `pointer-events: none`。読み上げにも操作にも干渉しない |
| 画像が無いとき | `stage.js` が読み込み失敗を拾ってその層だけ畳む。**画面は壊れない** |

### やる気の仕掛け
- 今日のミッションを全部終えると `Stage.setProgress()` が `.is-cheering` を付け、
  2人が前に出て（不透明度が上がり）跳ねる。「終わらせたくなる」ための仕掛け
- **イラストは複数種類。娘自身が選べる**（`.hero-pick`）。
  「自分の画面」だと思えることがやる気の下地になるので、親ではなく本人に選ばせる。
  選択は `localStorage` の `idol:hero`。家族で1つの値を取り合わないよう
  サーバーには置かない（親と娘で好みが違う）
- **一覧はホームに常設せず、モーダルに追い出してある。**
  スマホだと選択肢のカードで画面が埋まり、肝心の背景がほとんど見えなくなる
  （本末転倒だったので修正した）。ホームにはボタン1つだけ置き、
  選んだら即座に閉じる。一覧は横スクロール（スワイプ）なので枚数が増えても崩れない
- **イラストの枚数を持っているのは `stage.js` の `HERO_COUNT` だけ。**
  `storage.js` には上限を書かない（2箇所に書くと片方だけ直して壊れる）

### カードをすりガラスにしている理由
`[data-mode="kid"] .card` を半透明＋`backdrop-filter` にしている。
**不透明のままだと、背景イラストがカードの裏に完全に隠れて1ミリも見えない。**
`backdrop-filter` が無い環境では、ほぼ不透明の白にフォールバックする
（文字が読めなくなるほうが害が大きいので `@supports` で分岐）。

### 踏んだ罠: レイヤーの `inset: -10%`
視差でずれても縁が見えないよう各層を画面より10%大きく敷いているが、
**イラスト層だけは実寸（`inset: 0`）にする**。大きいままだと下寄せ・右寄せの
基準が画面の外側になり、イラストが画面外に押し出されて見えなくなる。

### 画像の差し替え
```bash
python tools/build-hero.py 画像1.png 画像2.png 画像3.png
```
長辺920pxの本体とサムネを書き出す。透過が無い画像は外周を楕円状に飛ばして
なじませる（そのままだと四角い板が浮く）。透過済みの画像には掛けない。

元データはコミットしない（`.gitignore` 済み）。publicリポジトリなので、
置くと GitHub Pages から誰でも落とせてしまう。
差し替えたら `sw.js` の `CACHE` 版数を上げること。

---

## 7. オフライン / 同期

- Supabase が source of truth。localStorage は**キャッシュ**と**送信待ちバッファ**のみ
- 差分同期: `updated_at > lastSyncAt` で取得（`js/sync.js` の `pullDelta()`）
- 削除は `deleted_at` のトゥームストーン。
  **これがないと「消したはずの記録が復活する」**（差分同期で最頻の事故）
- 書き込みは outbox に積み、ID はクライアント採番 → upsert が冪等でリトライ安全
- 競合解決は Last-Write-Wins（親子2人・端末数台なので CRDT は過剰）

### localStorage に置かないもの
| 対象 | 理由 |
|---|---|
| `idol_body_records` / `idol_audition_results` / `idol_parent_pins` | 平文で端末に残るとPINロックの意味が消える |
| Storage の署名付きURL | 期限切れ＋事実上のアクセス権 |
| 画像バイナリ | 容量。Service Worker の Cache Storage で扱う |
| `invite_code` | 漏れると他人が家族に入れる。表示時に都度取得 |

---

## 8. Storage

- バケット `idol-media`（**非公開**）、10MB上限
- パス規約: `{family_id}/{kind}/{yyyy}/{uuid}.webp`
  - `kind`: `avatar` / `practice` / `portfolio` / `docs` / `private`
  - **第2階層が `private` の場合だけ親限定**（`storage.objects` のポリシーで判定）
- ポリシーは `storage.foldername(name)[1] = idol_family_id()::text` で家族を判定
- 写真は端末側で Canvas 圧縮（長辺1600px / WebP q0.82、非対応環境は JPEG）
- 動画はアップロードしない。YouTube 限定公開などの URL を記録するだけ
- **表示は毎回 `createSignedUrl`。URLは保存しない**

---

## 9. ファイル構成

```
index.html            単一シェル（head内インラインscriptで data-mode を先に適用しFOUC防止）
sw.js                 Service Worker（Network First / CACHE版数を毎リリース上げる）
assets/               背景イラスト（idol-hero.webp）。差し替えは tools/build-hero.py
tools/build-hero.py   イラストを長辺920pxの透過WebPに変換する道具
css/                  style.css（トークン・共通） kid.css adult.css stage.css
js/
  app.js              エントリ（SW登録・認証ブート・モード適用・グローバル配線）
  config.js           Supabase クライアント
  auth.js             認証と家族の解決
  store.js            pub/sub ストア
  router.js           ハッシュルーター＋ガード（auth / mode / role / PIN）
  db.js               Supabase テーブルアクセスの単一窓口
  sync.js             差分同期＋outbox
  storage.js          localStorage ラッパ
  pin.js              PBKDF2 の PIN と自動施錠
  photos.js           Canvas圧縮 → アップロード → 署名URL
  ui.js               DOMヘルパ（modal/toast/confirm/ring/confetti）
  format.js           純関数のみ（テスト対象）
  components/         nav.js pin-modal.js stage.js
  views/              auth-view home practice goals album messages rewards
                      auditions calendar body settings
supabase/migrations/  0001〜0009（後述）
tests/format.test.mjs node --test
```

**`supabase` を import してよいのは config/auth/db/sync/photos/pin だけ。**
views は必ず db.js を通す。

---

## 10. マイグレーション

適用順に流すこと。**0003 より前に `idol_create_family()` を呼ぶとエラーになる**
（練習メニューの初期投入があるため）。

| ファイル | 内容 |
|---|---|
| `0001_idol_core.sql` | 共通関数 / families / family_members / app_settings / 参加RPC |
| `0002_idol_parent_pin.sql` | parent_pins |
| `0003_idol_practice.sql` | practice_menus / logs / log_items + 集計トリガー |
| `0004_idol_goals.sql` | goals（階層内包）+ ロールアップ + ロードマップ雛形RPC |
| `0005_idol_auditions.sql` | auditions / audition_results(親限定) / audition_tasks / lessons |
| `0006_idol_portfolio.sql` | portfolio_entries / body_records(親限定) |
| `0007_idol_gamification.sql` | cheer_messages(Realtime) / rewards / earned_badges |
| `0008_idol_views.sql` | v_idol_streaks / v_idol_points / v_idol_calendar |
| `0009_idol_storage.sql` | idol-media バケット + storage.objects ポリシー |
| `0010_idol_advisor_fixes.sql` | 適用後の advisor 指摘対応（search_path 固定 / トリガー関数の EXECUTE 剥奪） |

### 適用状況
**0001〜0010 は 2026-08-15 に本番プロジェクト（`sfhtvtcmgueystyuhzvd`）へ適用済み。**
`supabase_migrations.schema_migrations` に `idol_0001_core` 〜 `idol_0010_advisor_fixes`
として記録されている。

### 適用方法
`.mcp.json` に Supabase MCP をプロジェクトスコープで入れてある。
MCP の `apply_migration` で流すか、ダッシュボード → SQL Editor に 0001 から順に貼る。

---

## 11. 現在の状態と次にやるべきこと

### できていること
- 全画面の実装（こども/おとな両モード）
- マイグレーション 0001〜0010 の作成
- 純関数テスト20件パス
- ヘッドレスChromeで全画面のレンダリング確認（コンソールエラー0件）
- **マイグレーション 0001〜0010 の本番適用（2026-08-15）**
- **適用後の実測確認（2026-08-15）**
  - `idol_*` の全17テーブルが `rls_enabled = true`、ポリシーは各3〜4本
  - `v_idol_streaks` / `v_idol_points` / `v_idol_calendar` の
    `security_invoker = true` を `pg_class.reloptions` で確認
  - security advisor の `idol_*` 関連 WARN を 0010 で解消
    （残る `idol_family_id` 等の SECURITY DEFINER 警告は意図通り）
- **RLS 突破テスト（DB層）を実施（2026-08-15）— 全20項目 期待どおり**
  - スクリプト: `supabase/tests/idol_rls_probe.sql`（本番DBで再実行可・残留物なし）

### RLS 突破テストの結果（2026-08-15）

`set local role authenticated` + `request.jwt.claims` でアプリと同じ権限になりすまし、
最後に例外でロールバックする方式。**postgres ロールのまま select しても
RLS を素通りするので検証にならない**点に注意。

| 検証 | 結果 |
|---|---|
| 子から `idol_parent_pins` / `idol_audition_results` | 0件 |
| 子から `idol_body_records` | `visible_to_child` の1行のみ（非公開の体重は0件） |
| 子が自分の `role` を `parent` に変更 | 拒否（`idol_guard_member_role`） |
| 子が体重記録を書き込み | 拒否（RLS） |
| 子が別家族へメンバー追加 | 拒否（RLS） |
| 他家族の練習記録 / `v_idol_streaks` / `v_idol_points` | 0件・自分の分のみ |
| **`reveal_to_child` を ON 後**、子から `shared_result` | `failed` が見える（転記OK） |
| **同上、子から親メモ・費用** | **0件（伝えた後も見えない）** |
| 他家族の family_id 配下への Storage 保存 | 拒否 |
| 子から `private/` 配下の読み書き | 0件 / 拒否 |
| 子が ごほうびを `redeemed` に / `cost_points` 改ざん | 拒否（`idol_guard_reward_redeem`） |
| 子が親になりすまして応援投稿 | 拒否 |

### 通しで確認できたこと（2026-08-15）
- Supabase の Redirect URLs に localhost と GitHub Pages を追加済み
- **公開サイト（GitHub Pages）で Google ログイン → 家族の解決 → ホーム表示まで成功**
  - ローカル（localhost:3000）でも同じ経路を確認
- 親アカウント `mstd0520@gmail.com` で `idol_create_family` が成功
  - 練習メニュー5種の自動投入も確認
- こどもモードのホーム画面がコンソールエラー0件で描画
- おとなモードへの切替で PIN 設定モーダルが起動することを確認

### まだやっていないこと（次にやるべきこと）
1. **PIN の設定**（番号は親が決めるので未設定のまま）と、
   忘れた場合の Google 再ログイン導線の実地確認
2. **娘アカウント `kyoka.endo1006@gmail.com` での参加**
   - 招待コードは設定画面から取得する（★コードはこのファイルに書かない。
     漏れると他人が家族に入れる）
   - 参加後に、子アカウントで機密が返らないことを実アカウントで再確認する
     （DB層では `supabase/tests/idol_rls_probe.sql` で検証済み）
3. 親の呼び名が既定値「おとうさん・おかあさん」のままなので設定画面で変更する
   （下記の novalidate バグを踏んだ名残）
4. 実機（スマホ）で PWA インストールとオフライン起動を確認
5. 写真アップロード〜署名付きURL表示の実地確認（Canvas圧縮まわり）

### 踏んだ落とし穴（同じことを繰り返さないため）
- **Service Worker の `fetch(req)` は既定でHTTPキャッシュを経由する**
  ビルドしない＝ファイル名にハッシュが付かないので、一度HTTPキャッシュに
  載った CSS/JS はサーバーを更新しても古いまま返り続ける。
  「Network First にしてあるから大丈夫」は**嘘になる**。
  実際 `stage.css` を直したのに旧値が適用され続ける事故を踏んだ。
  → `sw.js` の `ALWAYS_FRESH`（html/css/js/json）に対して
    `fetch(req, { cache: 'no-store' })` を指定して回避している。
    画像は差し替え頻度が低く4Gで毎回落とすと重いのでHTTPキャッシュに任せる。
- **フォームの `novalidate` と `required` の組み合わせ**
  ブラウザ既定の吹き出しを避けるため `novalidate` を付けているので、
  markup の `required` は一切効かない。必須チェックは JS 側で自前で書くこと。
  （呼び名が空のまま家族が作れてしまった）
- **Service Worker 更新後のタブがハングすることがある**
  更新バーの「更新」を押した直後のタブが応答しなくなる場合がある。
  タブを開き直せば正常。新しいタブでは再現しない。

### 既知の割り切り
- **ダークモード非対応**（意図的）。kid×adult で既に2テーマあり検証コストが倍増するため。
  色はすべて意味トークン経由なので、後から `[data-mode="adult"][data-theme="dark"]` を
  1ブロック足すだけで対応できる
- レッスン料（`idol_lessons.fee_yen`）は家族共有。隠したくなったら
  `idol_audition_results` と同じ「親限定の別テーブル」に切り出す
- outbox は upsert/soft-delete のみ対応。写真アップロードはオフライン不可
- 孤児ファイル掃除の定期ジョブは未実装（削除時にクライアントが `deletePhotos` を呼ぶ運用）
