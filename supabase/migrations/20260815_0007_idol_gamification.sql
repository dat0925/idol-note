-- =====================================================================
-- 0007: こどもモード要素（応援メッセージ / ごほうび / バッジ）
-- =====================================================================

-- =====================================================
-- idol_cheer_messages : 練習記録・ポートフォリオ・目標への応援
--   コメントと「いいね」を1テーブルに統合（reaction 列）
-- =====================================================
create table if not exists public.idol_cheer_messages (
  id                 uuid        primary key default gen_random_uuid(),
  family_id          uuid        not null references public.idol_families(id) on delete cascade,
  author_user_id     uuid        not null default auth.uid()
                     references auth.users(id) on delete cascade,
  practice_log_id    uuid        references public.idol_practice_logs(id) on delete cascade,
  portfolio_entry_id uuid        references public.idol_portfolio_entries(id) on delete cascade,
  goal_id            uuid        references public.idol_goals(id) on delete cascade,
  reaction           text        check (reaction in ('like','star','fire','clap','heart')),
  body               text        not null default '',
  is_read            boolean     not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- 対象はちょうど1つ
  constraint idol_cheer_one_target check (
    (case when practice_log_id    is not null then 1 else 0 end
   + case when portfolio_entry_id is not null then 1 else 0 end
   + case when goal_id            is not null then 1 else 0 end) = 1
  ),
  -- 本文かリアクションのどちらかは必要
  constraint idol_cheer_has_content
    check (reaction is not null or length(btrim(body)) > 0)
);

create index if not exists idol_cheer_log_idx       on public.idol_cheer_messages (practice_log_id);
create index if not exists idol_cheer_portfolio_idx on public.idol_cheer_messages (portfolio_entry_id);
create index if not exists idol_cheer_family_idx    on public.idol_cheer_messages (family_id, created_at desc);

-- 同一対象への同一ユーザーの同一リアクションの重複防止
create unique index if not exists idol_cheer_unique_reaction_log
  on public.idol_cheer_messages (practice_log_id, author_user_id, reaction)
  where practice_log_id is not null and reaction is not null;

drop trigger if exists trg_idol_cheer_updated on public.idol_cheer_messages;
create trigger trg_idol_cheer_updated
  before update on public.idol_cheer_messages
  for each row execute function public.idol_set_updated_at();

alter table public.idol_cheer_messages enable row level security;

drop policy if exists "idol_cheer: family select" on public.idol_cheer_messages;
create policy "idol_cheer: family select"
  on public.idol_cheer_messages for select to authenticated
  using (family_id = (select public.idol_family_id()));

drop policy if exists "idol_cheer: author insert" on public.idol_cheer_messages;
create policy "idol_cheer: author insert"
  on public.idol_cheer_messages for insert to authenticated
  with check (family_id = (select public.idol_family_id()) and author_user_id = auth.uid());

-- 既読フラグは受け取り側も更新する必要があるので家族全体に許可
drop policy if exists "idol_cheer: family update" on public.idol_cheer_messages;
create policy "idol_cheer: family update"
  on public.idol_cheer_messages for update to authenticated
  using      (family_id = (select public.idol_family_id()))
  with check (family_id = (select public.idol_family_id()));

drop policy if exists "idol_cheer: author or parent delete" on public.idol_cheer_messages;
create policy "idol_cheer: author or parent delete"
  on public.idol_cheer_messages for delete to authenticated
  using (
    family_id = (select public.idol_family_id())
    and (author_user_id = auth.uid() or (select public.idol_is_parent()))
  );

-- リアルタイム購読（ママの応援が娘の画面に即座に出る＝このアプリの核）
--   publication が無い環境／既に追加済みでも失敗させない
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public' and tablename = 'idol_cheer_messages'
     ) then
    alter publication supabase_realtime add table public.idol_cheer_messages;
  end if;
exception
  when others then
    raise notice 'Realtime への追加をスキップしました: %', sqlerrm;
end;
$$;

-- =====================================================
-- idol_rewards : ごほうび（カタログ＋交換履歴を status で統合）
-- =====================================================
create table if not exists public.idol_rewards (
  id           uuid        primary key default gen_random_uuid(),
  family_id    uuid        not null references public.idol_families(id) on delete cascade,
  title        text        not null,
  icon         text        not null default '🎁',
  description  text        not null default '',
  cost_points  int         not null default 100 check (cost_points >= 0),
  status       text        not null default 'open'
               check (status in ('open','requested','redeemed','expired')),
  requested_at timestamptz,                              -- 子が「これ交換したい」を押した
  redeemed_at  timestamptz,                              -- 親が承認した
  approved_by  uuid        references auth.users(id) on delete set null,
  sort_order   int         not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

create index if not exists idol_rewards_family_idx
  on public.idol_rewards (family_id, status, sort_order);

drop trigger if exists trg_idol_rewards_updated on public.idol_rewards;
create trigger trg_idol_rewards_updated
  before update on public.idol_rewards
  for each row execute function public.idol_set_updated_at();

alter table public.idol_rewards enable row level security;

drop policy if exists "idol_rewards: family select" on public.idol_rewards;
create policy "idol_rewards: family select"
  on public.idol_rewards for select to authenticated
  using (family_id = (select public.idol_family_id()));

drop policy if exists "idol_rewards: parent insert" on public.idol_rewards;
create policy "idol_rewards: parent insert"
  on public.idol_rewards for insert to authenticated
  with check (family_id = (select public.idol_family_id()) and (select public.idol_is_parent()));

-- 子は「交換したい(requested)」までは押せる。承認はトリガーで親に限定。
drop policy if exists "idol_rewards: family update" on public.idol_rewards;
create policy "idol_rewards: family update"
  on public.idol_rewards for update to authenticated
  using      (family_id = (select public.idol_family_id()))
  with check (family_id = (select public.idol_family_id()));

drop policy if exists "idol_rewards: parent delete" on public.idol_rewards;
create policy "idol_rewards: parent delete"
  on public.idol_rewards for delete to authenticated
  using (family_id = (select public.idol_family_id()) and (select public.idol_is_parent()));

create or replace function public.idol_guard_reward_redeem()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'redeemed' and old.status is distinct from 'redeemed'
     and not public.idol_is_parent() then
    raise exception 'ごほうびの承認は親のみです';
  end if;
  if new.cost_points is distinct from old.cost_points and not public.idol_is_parent() then
    raise exception '必要ポイントの変更は親のみです';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_idol_rewards_guard on public.idol_rewards;
create trigger trg_idol_rewards_guard
  before update on public.idol_rewards
  for each row execute function public.idol_guard_reward_redeem();

-- =====================================================
-- idol_earned_badges : バッジ/スタンプの獲得記録
--   バッジ定義（条件・見た目）は js/badges.js の定数。DBはマスタを持たない
--   ＝バッジを増やすのにマイグレーションが要らない。
-- =====================================================
create table if not exists public.idol_earned_badges (
  id         uuid        primary key default gen_random_uuid(),
  family_id  uuid        not null references public.idol_families(id) on delete cascade,
  user_id    uuid        not null references auth.users(id) on delete cascade,
  badge_key  text        not null,          -- 'streak_7' / 'total_100h' / 'first_audition' 等
  earned_on  date        not null default public.idol_jst_today(),
  meta       jsonb       not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, badge_key)               -- 同じバッジは1回まで
);

create index if not exists idol_earned_badges_family_idx
  on public.idol_earned_badges (family_id, earned_on desc);

alter table public.idol_earned_badges enable row level security;

drop policy if exists "idol_badges: family select" on public.idol_earned_badges;
create policy "idol_badges: family select"
  on public.idol_earned_badges for select to authenticated
  using (family_id = (select public.idol_family_id()));

drop policy if exists "idol_badges: family insert" on public.idol_earned_badges;
create policy "idol_badges: family insert"
  on public.idol_earned_badges for insert to authenticated
  with check (family_id = (select public.idol_family_id()));

drop policy if exists "idol_badges: parent delete" on public.idol_earned_badges;
create policy "idol_badges: parent delete"
  on public.idol_earned_badges for delete to authenticated
  using (family_id = (select public.idol_family_id()) and (select public.idol_is_parent()));

grant select, insert, update, delete on public.idol_cheer_messages to authenticated;
grant select, insert, update, delete on public.idol_rewards        to authenticated;
grant select, insert, delete         on public.idol_earned_badges  to authenticated;
grant all on public.idol_cheer_messages, public.idol_rewards,
             public.idol_earned_badges to service_role;
