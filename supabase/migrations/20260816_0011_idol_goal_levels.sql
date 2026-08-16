-- =====================================================================
-- 0011: 目標の階層に「中間目標」を足す
--
-- これまで big → month → week → task の4段だったが、
-- 「最終目標 → 中間目標 → 月の目標 → 行動目標」で管理したい。
-- 週の目標という段は、月の目標と行動目標にはさまれると
-- 実際には何を書けばいいのか決まらず、空のまま残っていた。
--
-- ★'week' は消さない。既存の行が入っているかもしれず、
--   check 制約から外すと以後その行を UPDATE できなくなる
--   （制約は更新時にも評価されるので、進捗ロールアップのトリガーごと
--    落ちてしまう）。新規作成の導線から外すだけにする。
--
-- 新しい段の並び:
--   big       最終目標   … 2026-12-26 のコンクールで優秀賞、など
--   milestone 中間目標   … 逆算のチェックポイント（暗譜完成、など）
--   month     月の目標   … その月に何を終わらせるか
--   task      行動目標   … 「今日それをやったか」が言える粒度
--
-- テーブルも RLS も増やしていないので、ポリシーの追加は不要。
-- （idol_goals は 0004 で RLS 有効・4ポリシー・GRANT 済み）
-- =====================================================================

alter table public.idol_goals
  drop constraint if exists idol_goals_level_check;

alter table public.idol_goals
  add constraint idol_goals_level_check
  check (level in ('big', 'milestone', 'month', 'week', 'task'));

-- タイムライン（横軸＝時間）は期日の順に並べて描くので、
-- family 単位で period_end を引ける形にしておく。
create index if not exists idol_goals_period_idx
  on public.idol_goals (family_id, period_end)
  where deleted_at is null;

-- =====================================================================
-- 備考: ロードマップの雛形について
--   0004 で作った public.idol_seed_roadmap() は残してあるが、
--   アプリからは呼ばなくなった。雛形は js/goal-templates.js に移した。
--   理由は「雛形は増えるし書き換わる」ものなので、1文字直すのに
--   マイグレーションを1本足す形にしたくないため。
--   idol_goals は家族の誰でも書ける普通のテーブルで、
--   雛形の投入に特別な権限が要らない（＝RPC にする理由がない）。
--   ★権限が絡むもの（idol_create_family / idol_join_family /
--     idol_rotate_invite_code）は今まで通り RPC のままにしてある。
-- =====================================================================
