-- =====================================================================
-- 0005: オーディション / レッスン
--
-- ★列マスク不可問題への対処:
--   合否・講評・親の本音メモ・費用は、娘にそのまま見せたくない場合がある。
--   Postgres の RLS は「行」単位でしか効かず、列マスクはできない。
--   → 家族共有の idol_auditions と、親限定の idol_audition_results に分離する。
--
-- ★「合格したから娘にも伝えたい」への対応:
--   idol_audition_results.reveal_to_child を true にすると、トリガーが
--   共有してよい範囲（結果と日付、子ども向けメッセージ）だけを
--   idol_auditions.shared_result / shared_result_note に転記する。
--   parent_memo と fee_yen は転記されないので、絶対に子には見えない。
-- =====================================================================

-- =====================================================
-- idol_auditions : 応募案件（子にも見せてよい情報のみ）
-- =====================================================
create table if not exists public.idol_auditions (
  id                 uuid        primary key default gen_random_uuid(),
  family_id          uuid        not null references public.idol_families(id) on delete cascade,
  title              text        not null,
  organizer          text        not null default '',    -- 主催・事務所名
  kind               text        not null default 'audition'
                     check (kind in ('audition','contest','workshop','interview','other')),
  url                text,
  apply_deadline     date,                               -- 応募締切
  document_due       date,                               -- 書類提出締切
  event_date         date,                               -- 本番日
  event_time         time,
  venue              text        not null default '',
  belongings         text        not null default '',    -- 持ち物メモ（自由記述）
  memo               text        not null default '',
  status             text        not null default 'interested'
                     check (status in ('interested','preparing','applied',
                                       'passed_doc','final','finished','declined')),
  -- ↓ 親が「伝える」と決めたときだけ埋まる（トリガーが転記）。子にも見える。
  shared_result      text        check (shared_result in ('passed','failed','declined','withdrawn')),
  shared_result_note text        not null default '',
  color              text        not null default '#7c8cff',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz
);

create index if not exists idol_auditions_family_idx   on public.idol_auditions (family_id, event_date);
create index if not exists idol_auditions_deadline_idx on public.idol_auditions (family_id, apply_deadline);
create index if not exists idol_auditions_sync_idx     on public.idol_auditions (family_id, updated_at desc);

drop trigger if exists trg_idol_auditions_updated on public.idol_auditions;
create trigger trg_idol_auditions_updated
  before update on public.idol_auditions
  for each row execute function public.idol_set_updated_at();

alter table public.idol_auditions enable row level security;

drop policy if exists "idol_auditions: family select" on public.idol_auditions;
create policy "idol_auditions: family select"
  on public.idol_auditions for select to authenticated
  using (family_id = (select public.idol_family_id()));

drop policy if exists "idol_auditions: parent insert" on public.idol_auditions;
create policy "idol_auditions: parent insert"
  on public.idol_auditions for insert to authenticated
  with check (family_id = (select public.idol_family_id()) and (select public.idol_is_parent()));

drop policy if exists "idol_auditions: parent update" on public.idol_auditions;
create policy "idol_auditions: parent update"
  on public.idol_auditions for update to authenticated
  using      (family_id = (select public.idol_family_id()) and (select public.idol_is_parent()))
  with check (family_id = (select public.idol_family_id()) and (select public.idol_is_parent()));

drop policy if exists "idol_auditions: parent delete" on public.idol_auditions;
create policy "idol_auditions: parent delete"
  on public.idol_auditions for delete to authenticated
  using (family_id = (select public.idol_family_id()) and (select public.idol_is_parent()));

-- =====================================================
-- idol_audition_results : 合否・講評・親メモ・費用（★親限定。子は行ごと見えない）
-- =====================================================
create table if not exists public.idol_audition_results (
  audition_id     uuid        primary key references public.idol_auditions(id) on delete cascade,
  family_id       uuid        not null references public.idol_families(id) on delete cascade,
  result          text        not null default 'pending'
                  check (result in ('pending','passed','failed','declined','withdrawn')),
  result_date     date,
  feedback        text        not null default '',   -- 講評・落選理由など
  parent_memo     text        not null default '',   -- ★親のみの本音メモ。転記しない
  fee_yen         int,                               -- ★応募料・交通費など。転記しない
  reveal_to_child boolean     not null default false,-- true で共有欄へ転記
  child_note      text        not null default '',   -- 子に見せる言葉（親が書く）
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idol_audition_results_family_idx
  on public.idol_audition_results (family_id, updated_at desc);

drop trigger if exists trg_idol_audition_results_updated on public.idol_audition_results;
create trigger trg_idol_audition_results_updated
  before update on public.idol_audition_results
  for each row execute function public.idol_set_updated_at();

alter table public.idol_audition_results enable row level security;

-- ★ここが「UIで隠す」ではなく「RLSで本当に見せない」層。すべて親限定。
drop policy if exists "idol_audition_results: parent select" on public.idol_audition_results;
create policy "idol_audition_results: parent select"
  on public.idol_audition_results for select to authenticated
  using (family_id = (select public.idol_family_id()) and (select public.idol_is_parent()));

drop policy if exists "idol_audition_results: parent insert" on public.idol_audition_results;
create policy "idol_audition_results: parent insert"
  on public.idol_audition_results for insert to authenticated
  with check (family_id = (select public.idol_family_id()) and (select public.idol_is_parent()));

drop policy if exists "idol_audition_results: parent update" on public.idol_audition_results;
create policy "idol_audition_results: parent update"
  on public.idol_audition_results for update to authenticated
  using      (family_id = (select public.idol_family_id()) and (select public.idol_is_parent()))
  with check (family_id = (select public.idol_family_id()) and (select public.idol_is_parent()));

drop policy if exists "idol_audition_results: parent delete" on public.idol_audition_results;
create policy "idol_audition_results: parent delete"
  on public.idol_audition_results for delete to authenticated
  using (family_id = (select public.idol_family_id()) and (select public.idol_is_parent()));

-- =====================================================
-- reveal_to_child の転記トリガー
--   共有してよい範囲だけを idol_auditions 側にコピーする。
--   false に戻せば共有欄はクリアされる。
-- =====================================================
create or replace function public.idol_sync_shared_result()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.reveal_to_child and new.result <> 'pending' then
    update public.idol_auditions
       set shared_result      = new.result,
           shared_result_note = new.child_note,
           updated_at         = now()
     where id = new.audition_id;
  else
    update public.idol_auditions
       set shared_result      = null,
           shared_result_note = '',
           updated_at         = now()
     where id = new.audition_id
       and (shared_result is not null or shared_result_note <> '');
  end if;
  return null;
end;
$$;

drop trigger if exists trg_idol_audition_results_share on public.idol_audition_results;
create trigger trg_idol_audition_results_share
  after insert or update of reveal_to_child, result, child_note
  on public.idol_audition_results
  for each row execute function public.idol_sync_shared_result();

-- =====================================================
-- idol_audition_tasks : 書類・持ち物・やることチェックリスト
--   （子も見て準備できるよう家族共有）
-- =====================================================
create table if not exists public.idol_audition_tasks (
  id          uuid        primary key default gen_random_uuid(),
  family_id   uuid        not null references public.idol_families(id) on delete cascade,
  audition_id uuid        not null references public.idol_auditions(id) on delete cascade,
  title       text        not null,
  kind        text        not null default 'todo'
              check (kind in ('document','belonging','todo')),
  due_date    date,
  done        boolean     not null default false,
  done_at     timestamptz,
  file_path   text,                                   -- Storage パス（履歴書PDF等）
  sort_order  int         not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idol_audition_tasks_audition_idx
  on public.idol_audition_tasks (audition_id, sort_order);
create index if not exists idol_audition_tasks_family_idx
  on public.idol_audition_tasks (family_id, due_date);

drop trigger if exists trg_idol_audition_tasks_updated on public.idol_audition_tasks;
create trigger trg_idol_audition_tasks_updated
  before update on public.idol_audition_tasks
  for each row execute function public.idol_set_updated_at();

alter table public.idol_audition_tasks enable row level security;

drop policy if exists "idol_audition_tasks: family select" on public.idol_audition_tasks;
create policy "idol_audition_tasks: family select"
  on public.idol_audition_tasks for select to authenticated
  using (family_id = (select public.idol_family_id()));

drop policy if exists "idol_audition_tasks: family insert" on public.idol_audition_tasks;
create policy "idol_audition_tasks: family insert"
  on public.idol_audition_tasks for insert to authenticated
  with check (family_id = (select public.idol_family_id()));

drop policy if exists "idol_audition_tasks: family update" on public.idol_audition_tasks;
create policy "idol_audition_tasks: family update"
  on public.idol_audition_tasks for update to authenticated
  using      (family_id = (select public.idol_family_id()))
  with check (family_id = (select public.idol_family_id()));

drop policy if exists "idol_audition_tasks: parent delete" on public.idol_audition_tasks;
create policy "idol_audition_tasks: parent delete"
  on public.idol_audition_tasks for delete to authenticated
  using (family_id = (select public.idol_family_id()) and (select public.idol_is_parent()));

-- =====================================================
-- idol_lessons : レッスンの予定と受講記録（家族共有）
--   fee_yen は家族共有のまま。レッスン料は「習い事の月謝」であり、
--   合否や体重ほど繊細ではないと判断した。隠したくなったら
--   idol_audition_results と同じ「親限定の別テーブル」に切り出す。
-- =====================================================
create table if not exists public.idol_lessons (
  id          uuid        primary key default gen_random_uuid(),
  family_id   uuid        not null references public.idol_families(id) on delete cascade,
  title       text        not null,
  category    text        not null default 'other'
              check (category in ('vocal','dance','acting','walking','other')),
  studio      text        not null default '',
  teacher     text        not null default '',
  lesson_date date        not null,
  start_time  time,
  end_time    time,
  repeat_rule text,                                   -- 'WEEKLY:MON' 等の簡易ルール（任意）
  attended    boolean,                                -- null=未来 / true=出席 / false=欠席
  memo        text        not null default '',        -- 先生からのアドバイス
  fee_yen     int,
  color       text        not null default '#59c8a5',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create index if not exists idol_lessons_family_date_idx on public.idol_lessons (family_id, lesson_date desc);
create index if not exists idol_lessons_sync_idx        on public.idol_lessons (family_id, updated_at desc);

drop trigger if exists trg_idol_lessons_updated on public.idol_lessons;
create trigger trg_idol_lessons_updated
  before update on public.idol_lessons
  for each row execute function public.idol_set_updated_at();

alter table public.idol_lessons enable row level security;

drop policy if exists "idol_lessons: family select" on public.idol_lessons;
create policy "idol_lessons: family select"
  on public.idol_lessons for select to authenticated
  using (family_id = (select public.idol_family_id()));

drop policy if exists "idol_lessons: family insert" on public.idol_lessons;
create policy "idol_lessons: family insert"
  on public.idol_lessons for insert to authenticated
  with check (family_id = (select public.idol_family_id()));

drop policy if exists "idol_lessons: family update" on public.idol_lessons;
create policy "idol_lessons: family update"
  on public.idol_lessons for update to authenticated
  using      (family_id = (select public.idol_family_id()))
  with check (family_id = (select public.idol_family_id()));

drop policy if exists "idol_lessons: parent delete" on public.idol_lessons;
create policy "idol_lessons: parent delete"
  on public.idol_lessons for delete to authenticated
  using (family_id = (select public.idol_family_id()) and (select public.idol_is_parent()));

grant select, insert, update, delete on public.idol_auditions        to authenticated;
grant select, insert, update, delete on public.idol_audition_results to authenticated;
grant select, insert, update, delete on public.idol_audition_tasks   to authenticated;
grant select, insert, update, delete on public.idol_lessons          to authenticated;
grant all on public.idol_auditions, public.idol_audition_results,
             public.idol_audition_tasks, public.idol_lessons to service_role;
