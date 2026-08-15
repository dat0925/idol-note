-- =====================================================================
-- 0003: 毎日の練習記録
--   idol_practice_logs      : 1人1日1行（サマリ）
--   idol_practice_log_items : メニューごとのチェック/時間
-- =====================================================================

-- =====================================================
-- idol_practice_menus : 家族ごとのメニューマスタ
-- =====================================================
create table if not exists public.idol_practice_menus (
  id              uuid        primary key default gen_random_uuid(),
  family_id       uuid        not null references public.idol_families(id) on delete cascade,
  name            text        not null,
  category        text        not null default 'other'
                  check (category in ('vocal','dance','expression','stretch','acting','study','other')),
  icon            text        not null default '⭐',
  default_minutes int         not null default 10 check (default_minutes between 0 and 600),
  points          int         not null default 5   check (points between 0 and 1000),
  sort_order      int         not null default 0,
  is_active       boolean     not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

create index if not exists idol_practice_menus_family_idx
  on public.idol_practice_menus (family_id, sort_order);

drop trigger if exists trg_idol_practice_menus_updated on public.idol_practice_menus;
create trigger trg_idol_practice_menus_updated
  before update on public.idol_practice_menus
  for each row execute function public.idol_set_updated_at();

alter table public.idol_practice_menus enable row level security;

drop policy if exists "idol_practice_menus: family select" on public.idol_practice_menus;
create policy "idol_practice_menus: family select"
  on public.idol_practice_menus for select to authenticated
  using (family_id = (select public.idol_family_id()));

drop policy if exists "idol_practice_menus: family insert" on public.idol_practice_menus;
create policy "idol_practice_menus: family insert"
  on public.idol_practice_menus for insert to authenticated
  with check (family_id = (select public.idol_family_id()));

drop policy if exists "idol_practice_menus: family update" on public.idol_practice_menus;
create policy "idol_practice_menus: family update"
  on public.idol_practice_menus for update to authenticated
  using      (family_id = (select public.idol_family_id()))
  with check (family_id = (select public.idol_family_id()));

drop policy if exists "idol_practice_menus: parent delete" on public.idol_practice_menus;
create policy "idol_practice_menus: parent delete"
  on public.idol_practice_menus for delete to authenticated
  using (family_id = (select public.idol_family_id()) and (select public.idol_is_parent()));

-- =====================================================
-- idol_practice_logs : 1日分の練習サマリ
--   log_date は「日本時間の暦日」の date 型。
--   timestamptz からクライアント側で日付を作らない（端末TZがずれると連続日数が壊れる）。
-- =====================================================
create table if not exists public.idol_practice_logs (
  id              uuid        primary key default gen_random_uuid(),
  family_id       uuid        not null references public.idol_families(id) on delete cascade,
  subject_user_id uuid        not null references auth.users(id) on delete cascade, -- 練習した本人
  log_date        date        not null default public.idol_jst_today(),
  total_minutes   int         not null default 0 check (total_minutes between 0 and 1440),
  mood            smallint    check (mood between 1 and 5),   -- 1:つらい 〜 5:さいこう
  note            text        not null default '',
  photo_path      text,                                       -- Storage パス（任意・1枚）
  bonus_points    int         not null default 0
                  check (bonus_points between -1000 and 1000),-- 親からのボーナス
  -- 記録した人。アカウント削除時に記録まで消えると困るので nullable + set null。
  -- （not null + on delete set default にすると、削除時に default が評価されず FK 違反になる）
  created_by      uuid        default auth.uid()
                  references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  unique (subject_user_id, log_date),                         -- 1人1日1行
  constraint idol_practice_logs_not_future
    check (log_date <= (now() at time zone 'Asia/Tokyo')::date + 1)
);

-- ストリーク算出（gaps-and-islands）で使う複合インデックス
create index if not exists idol_practice_logs_streak_idx
  on public.idol_practice_logs (subject_user_id, log_date desc);
create index if not exists idol_practice_logs_family_date_idx
  on public.idol_practice_logs (family_id, log_date desc);
create index if not exists idol_practice_logs_sync_idx
  on public.idol_practice_logs (family_id, updated_at desc);   -- 差分同期用

drop trigger if exists trg_idol_practice_logs_updated on public.idol_practice_logs;
create trigger trg_idol_practice_logs_updated
  before update on public.idol_practice_logs
  for each row execute function public.idol_set_updated_at();

alter table public.idol_practice_logs enable row level security;

drop policy if exists "idol_practice_logs: family select" on public.idol_practice_logs;
create policy "idol_practice_logs: family select"
  on public.idol_practice_logs for select to authenticated
  using (family_id = (select public.idol_family_id()));

drop policy if exists "idol_practice_logs: family insert" on public.idol_practice_logs;
create policy "idol_practice_logs: family insert"
  on public.idol_practice_logs for insert to authenticated
  with check (
    family_id = (select public.idol_family_id())
    and subject_user_id in (
      select user_id from public.idol_family_members
      where family_id = (select public.idol_family_id())
    )
  );

drop policy if exists "idol_practice_logs: family update" on public.idol_practice_logs;
create policy "idol_practice_logs: family update"
  on public.idol_practice_logs for update to authenticated
  using      (family_id = (select public.idol_family_id()))
  with check (family_id = (select public.idol_family_id()));

drop policy if exists "idol_practice_logs: family delete" on public.idol_practice_logs;
create policy "idol_practice_logs: family delete"
  on public.idol_practice_logs for delete to authenticated
  using (family_id = (select public.idol_family_id()));

-- =====================================================
-- idol_practice_log_items : メニュー単位のチェック
-- =====================================================
create table if not exists public.idol_practice_log_items (
  id         uuid        primary key default gen_random_uuid(),
  family_id  uuid        not null references public.idol_families(id) on delete cascade, -- RLS用に非正規化
  log_id     uuid        not null references public.idol_practice_logs(id) on delete cascade,
  menu_id    uuid        references public.idol_practice_menus(id) on delete set null,
  menu_name  text        not null default '',    -- メニュー削除後も履歴が壊れないようスナップショット
  done       boolean     not null default true,
  minutes    int         not null default 0 check (minutes between 0 and 1440),
  points     int         not null default 0,     -- 付与時点のポイントをスナップショット
  memo       text        not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (log_id, menu_id)
);

create index if not exists idol_practice_log_items_log_idx
  on public.idol_practice_log_items (log_id);
create index if not exists idol_practice_log_items_family_idx
  on public.idol_practice_log_items (family_id, updated_at desc);

drop trigger if exists trg_idol_practice_log_items_updated on public.idol_practice_log_items;
create trigger trg_idol_practice_log_items_updated
  before update on public.idol_practice_log_items
  for each row execute function public.idol_set_updated_at();

alter table public.idol_practice_log_items enable row level security;

drop policy if exists "idol_practice_log_items: family select" on public.idol_practice_log_items;
create policy "idol_practice_log_items: family select"
  on public.idol_practice_log_items for select to authenticated
  using (family_id = (select public.idol_family_id()));

drop policy if exists "idol_practice_log_items: family insert" on public.idol_practice_log_items;
create policy "idol_practice_log_items: family insert"
  on public.idol_practice_log_items for insert to authenticated
  with check (family_id = (select public.idol_family_id()));

drop policy if exists "idol_practice_log_items: family update" on public.idol_practice_log_items;
create policy "idol_practice_log_items: family update"
  on public.idol_practice_log_items for update to authenticated
  using      (family_id = (select public.idol_family_id()))
  with check (family_id = (select public.idol_family_id()));

drop policy if exists "idol_practice_log_items: family delete" on public.idol_practice_log_items;
create policy "idol_practice_log_items: family delete"
  on public.idol_practice_log_items for delete to authenticated
  using (family_id = (select public.idol_family_id()));

-- =====================================================
-- total_minutes を items から自動集計
--   （クライアントの計算ミス・同時編集による食い違いを防ぐ。サーバーが正）
-- =====================================================
create or replace function public.idol_recalc_log_total()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_log uuid;
begin
  v_log := coalesce(new.log_id, old.log_id);
  update public.idol_practice_logs pl
     set total_minutes = coalesce(
           (select sum(i.minutes) from public.idol_practice_log_items i
             where i.log_id = v_log and i.done), 0),
         updated_at = now()
   where pl.id = v_log;
  return null;
end;
$$;

drop trigger if exists trg_idol_practice_log_items_recalc on public.idol_practice_log_items;
create trigger trg_idol_practice_log_items_recalc
  after insert or update or delete on public.idol_practice_log_items
  for each row execute function public.idol_recalc_log_total();

grant select, insert, update, delete on public.idol_practice_menus     to authenticated;
grant select, insert, update, delete on public.idol_practice_logs      to authenticated;
grant select, insert, update, delete on public.idol_practice_log_items to authenticated;
grant all on public.idol_practice_menus, public.idol_practice_logs,
             public.idol_practice_log_items to service_role;
