-- =====================================================================
-- 0002: 親専用画面の 4桁PIN
--
-- ★平文は絶対に保存しない。PBKDF2-SHA256(20万回, ランダムsalt) のハッシュのみ。
-- ★ただし「4桁 = 10,000通り」なので、ハッシュが読めれば総当たりは一瞬で終わる。
--   → ハッシュ自体を子アカウントから読めないようにすることが本質。
--   → 別テーブル + 「本人かつ親のみSELECT」の RLS にする。
--     （idol_family_members の列にすると RLS は列マスクできないので子に漏れる）
--
-- ★そもそも PIN は「親がログインしたままの端末を娘が触ったとき」の目隠しであり、
--   本当の防御線は 0005 / 0006 のデリケート情報テーブルの RLS。
-- =====================================================================
create table if not exists public.idol_parent_pins (
  user_id      uuid        primary key references auth.users(id) on delete cascade,
  family_id    uuid        not null references public.idol_families(id) on delete cascade,
  pin_salt     text        not null,                    -- base64(16 bytes)
  pin_hash     text        not null,                    -- base64(PBKDF2-SHA256 32 bytes)
  iterations   int         not null default 200000,
  failed_count int         not null default 0,
  locked_until timestamptz,                             -- 連続失敗時のクールダウン
  updated_at   timestamptz not null default now()
);

alter table public.idol_parent_pins enable row level security;

-- ★家族条件を「あえて」入れない。本人かつ親のみ。
--   子アカウントは行そのものを取得できない。
drop policy if exists "idol_parent_pins: own parent select" on public.idol_parent_pins;
create policy "idol_parent_pins: own parent select"
  on public.idol_parent_pins for select to authenticated
  using (user_id = auth.uid() and (select public.idol_is_parent()));

drop policy if exists "idol_parent_pins: own parent insert" on public.idol_parent_pins;
create policy "idol_parent_pins: own parent insert"
  on public.idol_parent_pins for insert to authenticated
  with check (
    user_id = auth.uid()
    and family_id = (select public.idol_family_id())
    and (select public.idol_is_parent())
  );

drop policy if exists "idol_parent_pins: own parent update" on public.idol_parent_pins;
create policy "idol_parent_pins: own parent update"
  on public.idol_parent_pins for update to authenticated
  using      (user_id = auth.uid() and (select public.idol_is_parent()))
  with check (user_id = auth.uid() and (select public.idol_is_parent()));

drop policy if exists "idol_parent_pins: own parent delete" on public.idol_parent_pins;
create policy "idol_parent_pins: own parent delete"
  on public.idol_parent_pins for delete to authenticated
  using (user_id = auth.uid() and (select public.idol_is_parent()));

drop trigger if exists trg_idol_parent_pins_updated on public.idol_parent_pins;
create trigger trg_idol_parent_pins_updated
  before update on public.idol_parent_pins
  for each row execute function public.idol_set_updated_at();

grant select, insert, update, delete on public.idol_parent_pins to authenticated;
grant all on public.idol_parent_pins to service_role;
