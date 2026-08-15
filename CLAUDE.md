# 応答言語について

すべての回答は日本語で行ってください。コード内のコメントや説明も日本語で書いてください。

---

## ◾️基本情報

- アプリ名称：アイドルノート
- 目的：9歳の娘が「アイドルになりたい」という夢に向かうプロセスを、親子で管理する
- 構成：バニラJS（ESモジュール）＋ Supabase ＋ PWA。**ビルドステップなし**
- DB：Supabase（**taskra と同じプロジェクトに相乗り**：`sfhtvtcmgueystyuhzvd.supabase.co`）
- 公開：GitHub Pages（publicリポジトリ）

---

## ◾️このプロジェクト固有の絶対ルール

### 1. テーブル・関数・ビューはすべて `idol_` 接頭辞
taskra と同じ Supabase プロジェクトを共有しているため、**接頭辞なしの識別子を作らない**。
Storage バケットも `idol-media`。

### 2. デリケートな情報は「列」ではなく「テーブル」で分ける
Postgres の RLS は行単位でしか効かず、**列マスクができない**。
合否・親メモ・費用・体重を家族共有テーブルの列に置くと、子アカウントから丸見えになる。

| 情報 | 置き場所 | 見える人 |
|---|---|---|
| オーディションの基本情報 | `idol_auditions` | 家族全員 |
| 合否・講評・親メモ・費用 | `idol_audition_results` | **親のみ**（RLS） |
| 身長・体重 | `idol_body_records` | **親のみ**（`visible_to_child = true` の行だけ子も可） |
| PINハッシュ | `idol_parent_pins` | **本人かつ親のみ** |

「娘にも結果を伝える」は `reveal_to_child` を ON にするとトリガーが
共有してよい範囲だけを `idol_auditions.shared_result` に転記する。
`parent_memo` と `fee_yen` は**絶対に転記しない**。

### 3. PIN は防御ではない
4桁 = 10,000通り。PIN は「親がログインしたままの端末を娘が触ったとき」の目隠しでしかない。
**本当の防御線は上記の RLS**。新機能を足すときも「PINで隠したから安全」と考えないこと。

### 4. RLS の再帰（42P17）を避ける
ポリシー内で `idol_family_members` を直接サブクエリすると無限再帰する。
必ず `(select public.idol_family_id())` / `(select public.idol_is_parent())` を使う。
これらは `security definer` + `stable` + `set search_path = public, pg_temp` の3点セットが必須。
サブクエリで包むのは InitPlan 化（行ごとの関数呼び出し回避）のため。

### 5. 日付は必ず JST
`new Date().toISOString().slice(0,10)` は**日本の 0〜9時に前日**になり、連続日数が壊れる。
- クライアント：`js/format.js` の `jstToday()` / `addDays()` を使う
- DB：`public.idol_jst_today()` を使う

### 6. ビューには `security_invoker = true`
付け忘れるとビューがオーナー権限で走り、RLS を貫通して**他家族の行が見える**。

### 7. 署名付きURLを保存しない
Storage の署名付きURLは DB にも localStorage にも入れない（期限切れ＋事実上のアクセス権）。
`js/photos.js` のメモリキャッシュ経由で都度発行する。

---

## ◾️着手前にやること

- リポジトリの最新を取得する
- `HANDOVER.md` を必ず読む（認証方式・テーブルとRLSの状態・PIN設計の意図が書いてある）
- 実装前に現在の動作を確認する（`npm start` → http://localhost:3000）
- 今回の変更が認証・個人情報・写真に関わるかを判定し、該当するなら下記チェックを実施する

---

## ◾️セキュリティチェック（該当する変更がある場合は必須）

### DB・テーブルまわり
- 新しいテーブルを作るときは、**CREATE TABLE と同じマイグレーション内で
  `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;` とポリシーをセットで書く**
- 変更後、Supabase ダッシュボードで対象テーブルの `rls_enabled` を**実際に確認する**（口頭確認で済ませない）
- 末尾に `GRANT` を書く（Supabase の public スキーマは明示的 GRANT が必要）
- anon キーはブラウザに露出している前提で設計する

### 子アカウントでの突破テスト（新テーブルを足したら毎回）
```js
// 子アカウントのセッションで実行し、すべて空 or エラーになること
await supabase.from('idol_body_records').select('*')       // → 0件
await supabase.from('idol_parent_pins').select('*')        // → 0件
await supabase.from('idol_audition_results').select('*')   // → 0件
await supabase.from('idol_family_members')
  .update({ role: 'parent' }).eq('user_id', 子uid)          // → エラー
```

### コード全般
- コミット前に diff に秘匿情報が含まれていないか確認する
- service_role キーは絶対にフロントに置かない（anon キーは public 前提でOK）

---

## ◾️コーディング規約

- **バニラJS（ESモジュール）。React/Vue/TypeScript/Tailwind は使わない。ビルドしない**
- `supabase` を import してよいのは `config.js` / `auth.js` / `db.js` / `sync.js` / `photos.js` / `pin.js` だけ。
  views は必ず `db.js` を通す
- views は `export default { mount(el, params), destroy() }` の形。
  `destroy()` で購読を必ず解除する（リーク防止）
- 色・寸法・文字サイズは `css/style.css` の `:root` トークン経由。
  こども/おとなの差は `kid.css` / `adult.css` で**トークンだけ**上書きする
- テンプレートに値を差し込むときは必ず `esc()` を通す
- 純関数は `js/format.js` に置く（唯一のテスト可能層）

---

## ◾️実装後にやること

- 実際に動作確認する（PCブラウザ＋スマホ幅）
- `node --test tests/format.test.mjs` を通す
- `sw.js` の `CACHE` 版数を上げる（上げないと古いJSが残る）
- `HANDOVER.md` を更新する（変更点、テーブルとRLSの状態、次にやるべきこと）

---

## ◾️PUSH後にやること

- push後、コミットURLと公開URLを共有する
- GitHub Pages のビルドが成功するまで後追いで確認する

---

## ◾️フロントで致命的なエラーが起きた場合

PC環境で Chrome のデベロッパーコンソールを一緒に見ながら原因調査を進める。
スマホ上の会話だけで無理に解決しようとせず、その旨を伝えること。
