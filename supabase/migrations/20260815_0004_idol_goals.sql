-- =====================================================================
-- 0004: 目標とロードマップ
--   大目標 → 月目標 → 週目標 → タスク を1テーブルの自己参照で表現。
--   （milestones テーブルを別に持たない。同じ構造なのでテーブル数を抑える）
--   progress_pct は子ノードの平均から自動ロールアップ、手動上書きも可。
-- =====================================================================
create table if not exists public.idol_goals (
  id             uuid        primary key default gen_random_uuid(),
  family_id      uuid        not null references public.idol_families(id) on delete cascade,
  parent_goal_id uuid        references public.idol_goals(id) on delete cascade,
  level          text        not null default 'big'
                 check (level in ('big','month','week','task')),
  title          text        not null,
  description    text        not null default '',
  icon           text        not null default '🌟',
  owner_user_id  uuid        references auth.users(id) on delete set null,
  period_start   date,
  period_end     date,
  target_value   numeric(10,2),                 -- 「週5回」「30分×20日」等の目標値（任意）
  current_value  numeric(10,2) not null default 0,
  unit           text        not null default '',
  progress_pct   smallint    not null default 0 check (progress_pct between 0 and 100),
  progress_mode  text        not null default 'auto' check (progress_mode in ('auto','manual')),
  status         text        not null default 'active'
                 check (status in ('active','done','paused','archived')),
  sort_order     int         not null default 0,
  completed_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  constraint idol_goals_period_order
    check (period_end is null or period_start is null or period_end >= period_start)
);

create index if not exists idol_goals_family_idx on public.idol_goals (family_id, level, sort_order);
create index if not exists idol_goals_parent_idx on public.idol_goals (parent_goal_id);
create index if not exists idol_goals_sync_idx   on public.idol_goals (family_id, updated_at desc);

drop trigger if exists trg_idol_goals_updated on public.idol_goals;
create trigger trg_idol_goals_updated
  before update on public.idol_goals
  for each row execute function public.idol_set_updated_at();

alter table public.idol_goals enable row level security;

drop policy if exists "idol_goals: family select" on public.idol_goals;
create policy "idol_goals: family select"
  on public.idol_goals for select to authenticated
  using (family_id = (select public.idol_family_id()));

drop policy if exists "idol_goals: family insert" on public.idol_goals;
create policy "idol_goals: family insert"
  on public.idol_goals for insert to authenticated
  with check (family_id = (select public.idol_family_id()));

drop policy if exists "idol_goals: family update" on public.idol_goals;
create policy "idol_goals: family update"
  on public.idol_goals for update to authenticated
  using      (family_id = (select public.idol_family_id()))
  with check (family_id = (select public.idol_family_id()));

drop policy if exists "idol_goals: family delete" on public.idol_goals;
create policy "idol_goals: family delete"
  on public.idol_goals for delete to authenticated
  using (family_id = (select public.idol_family_id()));

-- =====================================================
-- 進捗率のロールアップ（子ゴールの平均を親へ。progress_mode='auto' のみ）
-- =====================================================
create or replace function public.idol_rollup_goal_progress()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_parent uuid;
begin
  v_parent := coalesce(new.parent_goal_id, old.parent_goal_id);
  if v_parent is null then return null; end if;

  update public.idol_goals g
     set progress_pct = coalesce((
           select round(avg(case when c.status = 'done' then 100 else c.progress_pct end))
           from public.idol_goals c
           where c.parent_goal_id = v_parent
             and c.deleted_at is null
             and c.status <> 'archived'
         ), 0),
         updated_at = now()
   where g.id = v_parent and g.progress_mode = 'auto';
  return null;
end;
$$;

drop trigger if exists trg_idol_goals_rollup on public.idol_goals;
create trigger trg_idol_goals_rollup
  after insert or update of progress_pct, status, deleted_at or delete on public.idol_goals
  for each row execute function public.idol_rollup_goal_progress();

-- =====================================================
-- RPC: ロードマップ雛形の投入（「まだ何も始めていない」家庭向け）
--   親が設定画面のボタン1つで呼ぶ。既に大目標があれば何もしない。
-- =====================================================
create or replace function public.idol_seed_roadmap(p_owner_user_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_family uuid;
  v_owner  uuid;
  v_big    uuid;
  v_today  date := public.idol_jst_today();
begin
  v_family := public.idol_family_id();
  if v_family is null then
    raise exception '家族に所属していません';
  end if;
  if not public.idol_is_parent() then
    raise exception 'ロードマップの初期投入は親のみです';
  end if;
  if exists (select 1 from public.idol_goals
             where family_id = v_family and level = 'big' and deleted_at is null) then
    return null;   -- すでに大目標がある。上書きしない。
  end if;

  -- 「アイドルを目指す本人」を既定の担当者にする
  v_owner := coalesce(
    p_owner_user_id,
    (select user_id from public.idol_family_members
      where family_id = v_family and is_talent order by joined_at limit 1)
  );

  insert into public.idol_goals
    (family_id, level, title, description, icon, owner_user_id, period_start, period_end, sort_order)
  values
    (v_family, 'big', '1年後、はじめてのオーディションに挑戦する',
     'まずは家で続けられる練習の習慣をつくり、レッスンを体験し、応募までたどりつく。',
     '🌟', v_owner, v_today, v_today + 365, 1)
  returning id into v_big;

  insert into public.idol_goals
    (family_id, parent_goal_id, level, title, description, icon,
     owner_user_id, period_start, period_end, sort_order)
  values
    (v_family, v_big, 'month', '1〜3か月目：まいにち練習の習慣をつくる',
     '短くてもいいので毎日つづける。連続7日・30日をめざす。',
     '🔥', v_owner, v_today, v_today + 90, 1),
    (v_family, v_big, 'month', '4〜6か月目：レッスンを体験してみる',
     'ダンスかボイトレの体験レッスンを2〜3か所うけて、あう先生をさがす。',
     '🩰', v_owner, v_today + 91, v_today + 180, 2),
    (v_family, v_big, 'month', '7〜9か月目：見せられる形にする',
     '自己PR文をつくる。写真をとる。歌とダンスを1曲さいごまで通す。',
     '📸', v_owner, v_today + 181, v_today + 270, 3),
    (v_family, v_big, 'month', '10〜12か月目：応募して本番にのぞむ',
     '応募先をしらべて、書類をそろえて、オーディションをうける。',
     '🎬', v_owner, v_today + 271, v_today + 365, 4);

  return v_big;
end;
$$;

revoke execute on function public.idol_seed_roadmap(uuid) from public, anon;
grant   execute on function public.idol_seed_roadmap(uuid) to authenticated;

grant select, insert, update, delete on public.idol_goals to authenticated;
grant all on public.idol_goals to service_role;
