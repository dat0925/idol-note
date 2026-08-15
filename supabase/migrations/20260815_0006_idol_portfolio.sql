-- =====================================================================
-- 0006: 成長の記録（ポートフォリオ）と身体記録
-- =====================================================================

-- =====================================================
-- idol_portfolio_entries
--   写真 / 自己PR文 / できるようになったこと日記 / 動画リンク を1テーブルに統合。
--   photo_paths は Storage のパス配列。★署名付きURLは保存しない（期限切れの温床）。
-- =====================================================
create table if not exists public.idol_portfolio_entries (
  id              uuid        primary key default gen_random_uuid(),
  family_id       uuid        not null references public.idol_families(id) on delete cascade,
  subject_user_id uuid        references auth.users(id) on delete set null,
  entry_date      date        not null default public.idol_jst_today(),
  kind            text        not null default 'diary'
                  check (kind in ('photo','diary','achievement','pr','video','award')),
  title           text        not null default '',
  body            text        not null default '',   -- 日記本文 / 自己PR文
  photo_paths     text[]      not null default '{}', -- 'familyId/portfolio/2026/xxx.webp'
  cover_path      text,                              -- 一覧サムネ用
  video_url       text,                              -- YouTube限定公開などの外部URL
  tags            text[]      not null default '{}',
  is_favorite     boolean     not null default false,
  -- アカウント削除で記録まで消えないよう nullable + set null にする
  created_by      uuid        default auth.uid()
                  references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  constraint idol_portfolio_video_url_https
    check (video_url is null or video_url ~* '^https://')
);

create index if not exists idol_portfolio_family_date_idx
  on public.idol_portfolio_entries (family_id, entry_date desc);
create index if not exists idol_portfolio_kind_idx
  on public.idol_portfolio_entries (family_id, kind);
create index if not exists idol_portfolio_tags_idx
  on public.idol_portfolio_entries using gin (tags);
create index if not exists idol_portfolio_sync_idx
  on public.idol_portfolio_entries (family_id, updated_at desc);

drop trigger if exists trg_idol_portfolio_updated on public.idol_portfolio_entries;
create trigger trg_idol_portfolio_updated
  before update on public.idol_portfolio_entries
  for each row execute function public.idol_set_updated_at();

alter table public.idol_portfolio_entries enable row level security;

drop policy if exists "idol_portfolio: family select" on public.idol_portfolio_entries;
create policy "idol_portfolio: family select"
  on public.idol_portfolio_entries for select to authenticated
  using (family_id = (select public.idol_family_id()));

drop policy if exists "idol_portfolio: family insert" on public.idol_portfolio_entries;
create policy "idol_portfolio: family insert"
  on public.idol_portfolio_entries for insert to authenticated
  with check (family_id = (select public.idol_family_id()));

drop policy if exists "idol_portfolio: family update" on public.idol_portfolio_entries;
create policy "idol_portfolio: family update"
  on public.idol_portfolio_entries for update to authenticated
  using      (family_id = (select public.idol_family_id()))
  with check (family_id = (select public.idol_family_id()));

drop policy if exists "idol_portfolio: family delete" on public.idol_portfolio_entries;
create policy "idol_portfolio: family delete"
  on public.idol_portfolio_entries for delete to authenticated
  using (family_id = (select public.idol_family_id()));

-- =====================================================
-- idol_body_records : 身長・体重（★デリケート。既定は親限定）
--
--   9歳の子に体重の数値を毎日見せ続けるのは体型意識の面でリスクがあるため、
--   既定は親のみが読める。visible_to_child = true にした行だけ子にも見える。
--   「身長だけは本人にも見せたい」という運用が多いので、行単位で選べるようにした。
-- =====================================================
create table if not exists public.idol_body_records (
  id               uuid        primary key default gen_random_uuid(),
  family_id        uuid        not null references public.idol_families(id) on delete cascade,
  subject_user_id  uuid        not null references auth.users(id) on delete cascade,
  measured_on      date        not null default public.idol_jst_today(),
  height_cm        numeric(5,1) check (height_cm between 50 and 250),
  weight_kg        numeric(5,2) check (weight_kg between 5 and 200),
  shoe_size_cm     numeric(4,1),
  note             text        not null default '',
  visible_to_child boolean     not null default false,   -- ★RLSで実効
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  unique (subject_user_id, measured_on)
);

create index if not exists idol_body_records_subject_idx
  on public.idol_body_records (subject_user_id, measured_on desc);
create index if not exists idol_body_records_sync_idx
  on public.idol_body_records (family_id, updated_at desc);

drop trigger if exists trg_idol_body_records_updated on public.idol_body_records;
create trigger trg_idol_body_records_updated
  before update on public.idol_body_records
  for each row execute function public.idol_set_updated_at();

alter table public.idol_body_records enable row level security;

drop policy if exists "idol_body_records: parent always child when visible" on public.idol_body_records;
create policy "idol_body_records: parent always child when visible"
  on public.idol_body_records for select to authenticated
  using (
    family_id = (select public.idol_family_id())
    and ((select public.idol_is_parent()) or visible_to_child)
  );

drop policy if exists "idol_body_records: parent insert" on public.idol_body_records;
create policy "idol_body_records: parent insert"
  on public.idol_body_records for insert to authenticated
  with check (family_id = (select public.idol_family_id()) and (select public.idol_is_parent()));

drop policy if exists "idol_body_records: parent update" on public.idol_body_records;
create policy "idol_body_records: parent update"
  on public.idol_body_records for update to authenticated
  using      (family_id = (select public.idol_family_id()) and (select public.idol_is_parent()))
  with check (family_id = (select public.idol_family_id()) and (select public.idol_is_parent()));

drop policy if exists "idol_body_records: parent delete" on public.idol_body_records;
create policy "idol_body_records: parent delete"
  on public.idol_body_records for delete to authenticated
  using (family_id = (select public.idol_family_id()) and (select public.idol_is_parent()));

grant select, insert, update, delete on public.idol_portfolio_entries to authenticated;
grant select, insert, update, delete on public.idol_body_records      to authenticated;
grant all on public.idol_portfolio_entries, public.idol_body_records to service_role;
