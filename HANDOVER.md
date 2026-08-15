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

- **Supabase Auth（メール＋パスワード）**
- **親と娘で別アカウント**。`idol_family_members` の `role` で `'parent'` / `'child'` を持つ
- `storageKey: 'idol-auth'` にしている理由: 同じ Supabase プロジェクトを使う taskra とセッションを分けるため
- **1ユーザー＝1家族**（`unique(user_id)`）。ヘルパー関数をスカラー化して RLS を単純化するための制約

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

- ハッシュ: PBKDF2-SHA256 20万回 + ランダム16byte salt。**平文は保存しない**
- ハッシュを置く `idol_parent_pins` は「本人かつ親」しか SELECT できない（子は行ごと取得不可）
- 解錠フラグは **sessionStorage + 10分TTL**。localStorage には置かない
- 自動施錠: 無操作10分 / タブ非表示60秒 / リロード
- 失敗ロックアウト: 5回で60秒、以降倍々（最大10分）
- リカバリ: 親のメール＋パスワードで本人確認 → PIN再設定（平文は復元できない）
- `role === 'child'` のときはモードトグル自体を描画しない（存在を見せない）

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
css/                  style.css（トークン・共通） kid.css adult.css
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
  components/         nav.js pin-modal.js
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

### まだやっていないこと（次にやるべきこと）
1. 親・娘の2アカウントを作成し、`idol_create_family` / `idol_join_family` を通す
2. **子アカウントでの RLS 突破テスト**（CLAUDE.md の手順）
   ※ここまでは「スキーマが正しいこと」の確認であって、
     実アカウントで機密が返らないことはまだ検証していない
3. 別家族をもう1つ作り、`v_idol_streaks` に他家族の行が出ないことを確認
4. 他家族の family_id を先頭に付けたパスへの Storage アップロードが 403 になることを確認
5. 実機（スマホ）で PWA インストールとオフライン起動を確認

### 既知の割り切り
- **ダークモード非対応**（意図的）。kid×adult で既に2テーマあり検証コストが倍増するため。
  色はすべて意味トークン経由なので、後から `[data-mode="adult"][data-theme="dark"]` を
  1ブロック足すだけで対応できる
- レッスン料（`idol_lessons.fee_yen`）は家族共有。隠したくなったら
  `idol_audition_results` と同じ「親限定の別テーブル」に切り出す
- outbox は upsert/soft-delete のみ対応。写真アップロードはオフライン不可
- 孤児ファイル掃除の定期ジョブは未実装（削除時にクライアントが `deletePhotos` を呼ぶ運用）
