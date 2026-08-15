-- =====================================================================
-- 0008: 集計ビュー
--
-- ★すべて security_invoker = true。
--   これがないとビューはオーナー(postgres)権限で実行され、
--   RLS を貫通して他家族の行まで見えてしまう（重大事故）。
--
-- ★ストリーク（連続日数）をクライアント計算にしない理由:
--   1. ママの端末と娘の端末で数字が食い違ったら台無し。バッジ付与条件にもなる。
--   2. 端末のタイムゾーン設定が変わると壊れる。JST を DB 側に固定する。
--   3. gaps-and-islands は SQL の得意分野。子供のデータ量なら常に数ms。
--   クライアント側の計算（js/format.js の localStreak）はオフライン時の
--   楽観表示専用で、オンラインになったらこのビューの値で上書きする。
-- =====================================================================

-- =====================================================
-- v_idol_streaks : 連続日数（gaps-and-islands）
--   current_streak : 「今日 or 昨日」まで続いている連続日数
--                    （昨日までOK＝今日まだ練習していない朝でも0にならない）
--   best_streak    : 過去最高
-- =====================================================
create or replace view public.v_idol_streaks
with (security_invoker = true) as
with days as (
  select distinct family_id, subject_user_id, log_date
  from public.idol_practice_logs
  where deleted_at is null
    and total_minutes > 0             -- 「記録だけして0分」はカウントしない
),
islands as (
  select
    family_id, subject_user_id, log_date,
    log_date - (row_number() over (
      partition by family_id, subject_user_id order by log_date
    ))::int as grp                    -- 連続していれば同じ grp になる
  from days
),
runs as (
  select family_id, subject_user_id, grp,
         count(*)::int as len,
         min(log_date) as started_on,
         max(log_date) as ended_on
  from islands
  group by family_id, subject_user_id, grp
)
select
  r.family_id,
  r.subject_user_id,
  coalesce(max(r.len) filter (
    where r.ended_on >= (now() at time zone 'Asia/Tokyo')::date - 1
  ), 0)                                        as current_streak,
  coalesce(max(r.len), 0)                      as best_streak,
  coalesce(sum(r.len), 0)::int                 as total_days,
  max(r.ended_on)                              as last_practiced_on,
  ((now() at time zone 'Asia/Tokyo')::date)    as jst_today,
  bool_or(r.ended_on = (now() at time zone 'Asia/Tokyo')::date) as practiced_today
from runs r
group by r.family_id, r.subject_user_id;

-- =====================================================
-- v_idol_points : ポイント残高
--   残高カラムを持たず常に導出する＝改ざん・不整合の余地がない
-- =====================================================
create or replace view public.v_idol_points
with (security_invoker = true) as
-- 練習メニューごとに付与されたポイント
with item_pts as (
  select pl.family_id, pl.subject_user_id as user_id, coalesce(sum(i.points), 0) as pts
  from public.idol_practice_logs pl
  join public.idol_practice_log_items i on i.log_id = pl.id and i.done
  where pl.deleted_at is null
  group by pl.family_id, pl.subject_user_id
),
-- 親が手動で足し引きしたボーナス（ログのある全ユーザーが並ぶので、これを基準表にする）
bonus_pts as (
  select family_id, subject_user_id as user_id, coalesce(sum(bonus_points), 0) as pts
  from public.idol_practice_logs
  where deleted_at is null
  group by family_id, subject_user_id
),
-- 承認済みごほうびで使ったポイント（家族単位）
spent as (
  select family_id, coalesce(sum(cost_points), 0) as pts
  from public.idol_rewards
  where status = 'redeemed' and deleted_at is null
  group by family_id
)
select
  b.family_id,
  b.user_id,
  b.pts + coalesce(i.pts, 0)                          as earned_points,
  coalesce(s.pts, 0)                                  as spent_points,
  b.pts + coalesce(i.pts, 0) - coalesce(s.pts, 0)     as balance_points
from bonus_pts b
left join item_pts i on i.family_id = b.family_id and i.user_id = b.user_id
left join spent    s on s.family_id = b.family_id;

-- =====================================================
-- v_idol_calendar : 締切 / 本番 / 書類期限 / レッスン の統合カレンダー
-- =====================================================
create or replace view public.v_idol_calendar
with (security_invoker = true) as
  select a.family_id, 'audition_deadline'::text as kind, a.id as source_id,
         a.apply_deadline as on_date, null::time as at_time,
         '📮 ' || a.title as title, a.color, a.status
  from public.idol_auditions a
  where a.deleted_at is null and a.apply_deadline is not null
union all
  select a.family_id, 'audition_event', a.id,
         a.event_date, a.event_time, '🎬 ' || a.title, a.color, a.status
  from public.idol_auditions a
  where a.deleted_at is null and a.event_date is not null
union all
  select t.family_id, 'audition_task', t.id,
         t.due_date, null::time, '📄 ' || t.title, '#f5a524',
         case when t.done then 'done' else 'todo' end
  from public.idol_audition_tasks t
  where t.due_date is not null
union all
  select l.family_id, 'lesson', l.id,
         l.lesson_date, l.start_time, '🩰 ' || l.title, l.color,
         case when l.attended is null then 'planned'
              when l.attended then 'attended' else 'absent' end
  from public.idol_lessons l
  where l.deleted_at is null;

grant select on public.v_idol_streaks  to authenticated;
grant select on public.v_idol_points   to authenticated;
grant select on public.v_idol_calendar to authenticated;

-- =====================================================
-- RPC: ホーム画面の1発取得（往復を減らす）
--   ★security invoker（既定）のまま。definer にすると RLS を貫通する。
-- =====================================================
create or replace function public.idol_home_summary(p_user_id uuid default null)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'streak', (select to_jsonb(s) from public.v_idol_streaks s
                where s.subject_user_id = coalesce(p_user_id, auth.uid())),
    'points', (select to_jsonb(p) from public.v_idol_points p
                where p.user_id = coalesce(p_user_id, auth.uid())),
    'today',  (select to_jsonb(l) from public.idol_practice_logs l
                where l.subject_user_id = coalesce(p_user_id, auth.uid())
                  and l.log_date = public.idol_jst_today()
                  and l.deleted_at is null),
    'badges', (select coalesce(jsonb_agg(b.badge_key), '[]'::jsonb)
                from public.idol_earned_badges b
                where b.user_id = coalesce(p_user_id, auth.uid()))
  );
$$;

revoke execute on function public.idol_home_summary(uuid) from public, anon;
grant   execute on function public.idol_home_summary(uuid) to authenticated;
