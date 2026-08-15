-- =====================================================================
-- 0010: Supabase セキュリティアドバイザーの指摘対応
--
-- 0001〜0009 を実適用したあと、Supabase の security advisor が
-- idol_* について2種類の警告を出したので潰す。
--
-- 1) function_search_path_mutable
--    idol_set_updated_at / idol_jst_today に set search_path が無かった。
--    （他の関数には最初から付いている）
--    search_path を固定しないと、呼び出し側が search_path を差し替えて
--    同名の偽テーブル・偽関数を先に引かせられる。
--
-- 2) anon/authenticated_security_definer_function_executable
--    トリガー専用関数が PostgREST に RPC として口を開けていた。
--    トリガー関数は直接呼ぶと Postgres 側で弾かれる（実害は無い）が、
--    API に見えている状態そのものを消す。
--
-- ★EXECUTE を剥がしてもトリガーは動く。
--   Postgres が EXECUTE 権限を見るのは CREATE TRIGGER の時点で、
--   トリガー発火時には再チェックしないため。
--   （authenticated ロールで実際に UPDATE してトリガー発火を実測確認済み）
-- =====================================================================

alter function public.idol_set_updated_at() set search_path = public, pg_temp;
alter function public.idol_jst_today()     set search_path = public, pg_temp;

revoke execute on function public.idol_set_updated_at()       from public, anon, authenticated;
revoke execute on function public.idol_guard_member_role()    from public, anon, authenticated;
revoke execute on function public.idol_guard_reward_redeem()  from public, anon, authenticated;
revoke execute on function public.idol_recalc_log_total()     from public, anon, authenticated;
revoke execute on function public.idol_rollup_goal_progress() from public, anon, authenticated;
revoke execute on function public.idol_sync_shared_result()   from public, anon, authenticated;

-- 残る警告のうち idol_* のものは意図通り（消さない）:
--   idol_family_id / idol_is_parent … RLSポリシーが呼ぶので authenticated に EXECUTE が必要
--   idol_create_family / idol_join_family / idol_rotate_invite_code / idol_seed_roadmap
--                                     … アプリから呼ぶ RPC。関数の中で auth.uid() と
--                                       親判定を自前でチェックしている
