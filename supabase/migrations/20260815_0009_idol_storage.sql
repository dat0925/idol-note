-- =====================================================================
-- 0009: Storage — idol-media（非公開バケット）
--
-- パス規約:
--   {family_id}/avatar/{user_id}.webp
--   {family_id}/practice/{yyyy}/{uuid}.webp
--   {family_id}/portfolio/{yyyy}/{uuid}.webp
--   {family_id}/docs/{audition_id}/{uuid}.pdf
--   {family_id}/private/{yyyy}/{uuid}.webp   ← ★親限定領域
--
-- ポイント:
--   - 第1階層を必ず family_id にする → storage.foldername(name)[1] で判定できる
--   - 第2階層が 'private' の場合だけ idol_is_parent() を要求する
--   - 公開URLは存在しない。表示は毎回 createSignedUrl。
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'idol-media', 'idol-media', false,
  10485760,   -- 10MB（クライアント圧縮後は 200〜400KB 程度を想定）
  array['image/webp','image/jpeg','image/png','image/heic','application/pdf']
)
on conflict (id) do update
  set public             = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- storage.objects は Supabase 側で既に RLS 有効。ポリシーだけ追加する。

-- ---------- SELECT（ダウンロード / 署名付きURL発行） ----------
drop policy if exists "idol-media: family read" on storage.objects;
create policy "idol-media: family read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'idol-media'
    and (storage.foldername(name))[1] = (select public.idol_family_id())::text
    and (
      (storage.foldername(name))[2] is distinct from 'private'
      or (select public.idol_is_parent())
    )
  );

-- ---------- INSERT（アップロード） ----------
drop policy if exists "idol-media: family upload" on storage.objects;
create policy "idol-media: family upload"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'idol-media'
    and owner = auth.uid()
    and (storage.foldername(name))[1] = (select public.idol_family_id())::text
    and (
      (storage.foldername(name))[2] is distinct from 'private'
      or (select public.idol_is_parent())
    )
  );

-- ---------- UPDATE（上書き / メタ更新） ----------
drop policy if exists "idol-media: family update" on storage.objects;
create policy "idol-media: family update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'idol-media'
    and (storage.foldername(name))[1] = (select public.idol_family_id())::text
    and (
      (storage.foldername(name))[2] is distinct from 'private'
      or (select public.idol_is_parent())
    )
  )
  with check (
    bucket_id = 'idol-media'
    and (storage.foldername(name))[1] = (select public.idol_family_id())::text
  );

-- ---------- DELETE ----------
drop policy if exists "idol-media: uploader or parent delete" on storage.objects;
create policy "idol-media: uploader or parent delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'idol-media'
    and (storage.foldername(name))[1] = (select public.idol_family_id())::text
    and (owner = auth.uid() or (select public.idol_is_parent()))
  );
