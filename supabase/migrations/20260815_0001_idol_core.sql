-- =====================================================================
-- 010.idol : アイドルノート
-- 0001: コア（家族・メンバー・共通関数・参加RPC）
--
-- ★このマイグレーションは taskra と同じ Supabase プロジェクトに相乗りする。
--   既存テーブルとの衝突を避けるため、すべての識別子に idol_ 接頭辞を付ける。
--
-- ★RLSの中核方針:
--   「同じ family に属する認証ユーザーだけが読み書きできる」を、
--   SECURITY DEFINER 関数 idol_family_id() 経由で判定する。
--   ポリシー内で idol_family_members を直接サブクエリすると
--   そのテーブル自身のポリシーが再帰評価され 42P17 (infinite recursion)
--   になるため、必ず関数を使うこと。
-- =====================================================================

create extension if not exists pgcrypto;   -- gen_random_uuid()

-- =====================================================
-- 共通: updated_at 自動更新トリガー関数
--   差分同期(updated_at > lastSyncAt)の前提になるので全テーブルに付ける
-- =====================================================
create or replace function public.idol_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =====================================================
-- 共通: 日本時間の「今日」
--   log_date 等の既定値に使う。端末のタイムゾーン設定に依存させない。
--   「夜中2時の練習を前日扱いにしたい」となったら、ここだけ
--   ((now() at time zone 'Asia/Tokyo') - interval '4 hours')::date に変えればよい。
-- =====================================================
create or replace function public.idol_jst_today()
returns date
language sql
stable
as $$
  select (now() at time zone 'Asia/Tokyo')::date;
$$;

-- =====================================================
-- idol_families : 家族
-- =====================================================
create table if not exists public.idol_families (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null default 'わたしの家族',
  invite_code text        not null unique,          -- 8文字。子アカウントの参加に使う
  created_by  uuid        not null references auth.users(id) on delete restrict,
  timezone    text        not null default 'Asia/Tokyo',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists trg_idol_families_updated on public.idol_families;
create trigger trg_idol_families_updated
  before update on public.idol_families
  for each row execute function public.idol_set_updated_at();

-- =====================================================
-- idol_family_members : 家族メンバー（profiles を兼ねる）
--   role: 'parent' | 'child'
--   is_talent: アイドルを目指す本人（＝娘）フラグ。練習/身体記録の主体
--   unique(user_id) → 1ユーザー=1家族。ヘルパー関数をスカラー化するために必須。
-- =====================================================
create table if not exists public.idol_family_members (
  id           uuid        primary key default gen_random_uuid(),
  family_id    uuid        not null references public.idol_families(id) on delete cascade,
  user_id      uuid        not null references auth.users(id) on delete cascade,
  role         text        not null default 'child' check (role in ('parent','child')),
  display_name text        not null default '',
  nickname     text        not null default '',
  avatar_path  text,                                -- Storage のパス（URLではない）
  birthday     date,
  is_talent    boolean     not null default false,
  color        text        not null default '#ff8fb1',
  joined_at    timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id)
);

create index if not exists idol_family_members_family_idx
  on public.idol_family_members (family_id);

drop trigger if exists trg_idol_family_members_updated on public.idol_family_members;
create trigger trg_idol_family_members_updated
  before update on public.idol_family_members
  for each row execute function public.idol_set_updated_at();

-- =====================================================================
-- ★★★ 再帰回避の要: SECURITY DEFINER ヘルパー関数 ★★★
--
-- なぜ再帰するか:
--   create policy on idol_family_members using (
--     family_id in (select family_id from idol_family_members where user_id = auth.uid())
--   )
--   → サブクエリの idol_family_members にも同じ SELECT ポリシーが適用され、
--     その評価でまた同じサブクエリが走る → 42P17 infinite recursion。
--
-- なぜ SECURITY DEFINER で解けるか:
--   関数は所有者(postgres)権限で実行され、postgres は BYPASSRLS 相当なので
--   関数内の参照にはポリシーが適用されない＝再帰が断ち切れる。
--
-- 必須の作法（どれか欠けると脆弱 or 遅い）:
--   1. set search_path = public, pg_temp  … search_path 乗っ取り対策（必須）
--   2. stable                              … 同一ステートメント内でキャッシュされる
--   3. revoke execute from public, anon    … 未認証に叩かせない
--   4. ポリシー内では (select public.idol_family_id()) と★サブクエリで包む★
--      … Postgres が InitPlan として1回だけ評価する。行ごとの関数呼び出しを回避
--   5. テーブルに force row level security を付けない
--      … 付けると所有者にも RLS が適用され、この回避策が効かなくなる
-- =====================================================================

-- 現在ユーザーが所属する family_id（未所属なら NULL → 全ポリシーが false になり安全）
create or replace function public.idol_family_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select fm.family_id
  from public.idol_family_members fm
  where fm.user_id = auth.uid()
  limit 1;
$$;

-- 現在ユーザーが親か
create or replace function public.idol_is_parent()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.idol_family_members fm
    where fm.user_id = auth.uid() and fm.role = 'parent'
  );
$$;

revoke execute on function public.idol_family_id() from public, anon;
revoke execute on function public.idol_is_parent() from public, anon;
grant   execute on function public.idol_family_id() to authenticated;
grant   execute on function public.idol_is_parent() to authenticated;
grant   execute on function public.idol_jst_today() to authenticated, anon;

-- =====================================================
-- idol_families の RLS
-- =====================================================
alter table public.idol_families enable row level security;

drop policy if exists "idol_families: member select" on public.idol_families;
create policy "idol_families: member select"
  on public.idol_families for select to authenticated
  using (id = (select public.idol_family_id()));

-- INSERT ポリシーは作らない（＝拒否）。idol_create_family() RPC 経由のみ。

drop policy if exists "idol_families: parent update" on public.idol_families;
create policy "idol_families: parent update"
  on public.idol_families for update to authenticated
  using      (id = (select public.idol_family_id()) and (select public.idol_is_parent()))
  with check (id = (select public.idol_family_id()) and (select public.idol_is_parent()));

drop policy if exists "idol_families: creator delete" on public.idol_families;
create policy "idol_families: creator delete"
  on public.idol_families for delete to authenticated
  using (id = (select public.idol_family_id()) and created_by = auth.uid());

-- =====================================================
-- idol_family_members の RLS（★再帰の震源地。関数のみを使う）
-- =====================================================
alter table public.idol_family_members enable row level security;

drop policy if exists "idol_family_members: same family select" on public.idol_family_members;
create policy "idol_family_members: same family select"
  on public.idol_family_members for select to authenticated
  using (family_id = (select public.idol_family_id()));

-- INSERT ポリシーは作らない（＝拒否）。idol_create_family / idol_join_family RPC 経由のみ。
-- ※ with check (user_id = auth.uid()) を作ると、family_id を推測できれば
--    他人の家族に勝手に入り込めてしまう。招待コード検証を挟むため RPC に一本化する。

drop policy if exists "idol_family_members: self or parent update" on public.idol_family_members;
create policy "idol_family_members: self or parent update"
  on public.idol_family_members for update to authenticated
  using (
    family_id = (select public.idol_family_id())
    and (user_id = auth.uid() or (select public.idol_is_parent()))
  )
  with check (
    family_id = (select public.idol_family_id())
    and (user_id = auth.uid() or (select public.idol_is_parent()))
  );

drop policy if exists "idol_family_members: self or parent delete" on public.idol_family_members;
create policy "idol_family_members: self or parent delete"
  on public.idol_family_members for delete to authenticated
  using (
    family_id = (select public.idol_family_id())
    and (user_id = auth.uid() or (select public.idol_is_parent()))
  );

-- =====================================================
-- ★ 権限昇格防止トリガー
--   上の UPDATE ポリシーだけだと、子が自分の行の role を 'parent' に
--   書き換えて親限定データを読めてしまう。RLS は列単位の制御ができないので
--   トリガーで弾く。あわせて「最後の親」を降格できないようにする。
-- =====================================================
create or replace function public.idol_guard_member_role()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.role is distinct from old.role then
    if not public.idol_is_parent() then
      raise exception 'role の変更は親のみ可能です';
    end if;
    if old.role = 'parent' and new.role <> 'parent'
       and (select count(*) from public.idol_family_members
            where family_id = old.family_id and role = 'parent') <= 1 then
      raise exception '家族に親が1人もいなくなる変更はできません';
    end if;
  end if;
  -- family_id の付け替えも禁止（他家族へのデータ移送防止）
  if new.family_id is distinct from old.family_id then
    raise exception 'family_id は変更できません';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_idol_family_members_guard on public.idol_family_members;
create trigger trg_idol_family_members_guard
  before update on public.idol_family_members
  for each row execute function public.idol_guard_member_role();

-- =====================================================
-- idol_app_settings : ユーザーごとの key-value（モード既定値など）
--   本人のみ read/write。家族条件は入れない。
-- =====================================================
create table if not exists public.idol_app_settings (
  user_id    uuid        not null references auth.users(id) on delete cascade,
  key        text        not null,
  value      jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

alter table public.idol_app_settings enable row level security;

drop policy if exists "idol_app_settings: own select" on public.idol_app_settings;
create policy "idol_app_settings: own select"
  on public.idol_app_settings for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "idol_app_settings: own insert" on public.idol_app_settings;
create policy "idol_app_settings: own insert"
  on public.idol_app_settings for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "idol_app_settings: own update" on public.idol_app_settings;
create policy "idol_app_settings: own update"
  on public.idol_app_settings for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "idol_app_settings: own delete" on public.idol_app_settings;
create policy "idol_app_settings: own delete"
  on public.idol_app_settings for delete to authenticated
  using (user_id = auth.uid());

-- =====================================================
-- RPC: 家族を作る（最初の1人。必ず parent になる）
--   ※ 練習メニューの初期投入は 0003 適用後に有効になる。
--     0003 未適用の状態で呼ぶとエラーになるため、0003 まで通してから使うこと。
-- =====================================================
create or replace function public.idol_create_family(
  p_family_name  text default 'わたしの家族',
  p_display_name text default 'おかあさん'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_family_id uuid;
  v_code      text;
begin
  if auth.uid() is null then
    raise exception '認証が必要です';
  end if;
  if exists (select 1 from public.idol_family_members where user_id = auth.uid()) then
    raise exception 'すでに家族に所属しています';
  end if;

  v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  insert into public.idol_families (name, invite_code, created_by)
  values (p_family_name, v_code, auth.uid())
  returning id into v_family_id;

  insert into public.idol_family_members (family_id, user_id, role, display_name)
  values (v_family_id, auth.uid(), 'parent', p_display_name);

  -- 練習メニューの初期セット（「まだ何も始めていない」前提の家庭練習中心）
  insert into public.idol_practice_menus
    (family_id, name, category, icon, default_minutes, points, sort_order)
  values
    (v_family_id, 'ボイストレーニング', 'vocal',      '🎤', 20, 10, 1),
    (v_family_id, 'ダンス練習',         'dance',      '💃', 30, 10, 2),
    (v_family_id, '表情トレーニング',   'expression', '😊', 10,  5, 3),
    (v_family_id, 'ストレッチ',         'stretch',    '🤸', 10,  5, 4),
    (v_family_id, '発声・滑舌',         'vocal',      '🗣️', 10,  5, 5);

  return v_family_id;
end;
$$;

-- =====================================================
-- RPC: 招待コードで家族に参加（必ず child。親への昇格は既存の親が行う）
-- =====================================================
create or replace function public.idol_join_family(
  p_invite_code  text,
  p_display_name text default '',
  p_is_talent    boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_family_id uuid;
begin
  if auth.uid() is null then
    raise exception '認証が必要です';
  end if;
  if exists (select 1 from public.idol_family_members where user_id = auth.uid()) then
    raise exception 'すでに家族に所属しています';
  end if;

  select id into v_family_id
  from public.idol_families
  where invite_code = upper(trim(p_invite_code));

  if v_family_id is null then
    raise exception '招待コードが見つかりません';
  end if;

  insert into public.idol_family_members (family_id, user_id, role, display_name, is_talent)
  values (v_family_id, auth.uid(), 'child',
          coalesce(nullif(p_display_name, ''), 'こども'), p_is_talent);

  return v_family_id;
end;
$$;

-- =====================================================
-- RPC: 招待コード再発行（親のみ。コード漏れ対策）
-- =====================================================
create or replace function public.idol_rotate_invite_code()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code   text;
  v_family uuid;
begin
  v_family := public.idol_family_id();
  if v_family is null or not public.idol_is_parent() then
    raise exception '親のみ実行できます';
  end if;
  v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  update public.idol_families set invite_code = v_code where id = v_family;
  return v_code;
end;
$$;

revoke execute on function public.idol_create_family(text,text)         from public, anon;
revoke execute on function public.idol_join_family(text,text,boolean)   from public, anon;
revoke execute on function public.idol_rotate_invite_code()             from public, anon;
grant   execute on function public.idol_create_family(text,text)        to authenticated;
grant   execute on function public.idol_join_family(text,text,boolean)  to authenticated;
grant   execute on function public.idol_rotate_invite_code()            to authenticated;

-- =====================================================
-- GRANT（Supabase では public スキーマのテーブルに明示的 GRANT が必要）
-- =====================================================
grant select, update, delete         on public.idol_families       to authenticated;
grant select, update, delete         on public.idol_family_members to authenticated;
grant select, insert, update, delete on public.idol_app_settings   to authenticated;
grant all on public.idol_families, public.idol_family_members, public.idol_app_settings
  to service_role;
