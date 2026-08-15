-- =====================================================================
-- idol_* の RLS 突破テスト（本番DBで安全に実行できる）
--
-- 【使い方】
--   Supabase SQL Editor（または MCP の execute_sql）に
--   ★1ブロックずつ★ 貼って実行する。
--   各ブロックは最後に必ず raise exception でトランザクションを巻き戻すので、
--   本番データには何も残らない。結果は「エラーメッセージ」として返る。
--   → エラー表示になるのが正常。中身の判定結果を読むこと。
--
-- 【なぜこの形か】
--   postgres ロールは RLS を素通りするため、そのまま select しても検証にならない。
--   set local role authenticated + request.jwt.claims で
--   「アプリが実際に使う権限」になりすまして初めて意味のあるテストになる。
--
--   既存の auth.users から2人ぶんの id を借りるが、auth.users は一切変更しない。
--   （idol_* 側に family_id の外部キーがあるため id だけ必要）
--
-- 【CLAUDE.md との対応】
--   新しいテーブルを足したら、このファイルに判定行を追加してから実行すること。
--
-- 最終実行: 2026-08-15 → 全項目 期待どおり
-- =====================================================================


-- =====================================================================
-- ブロック1: 子アカウントから機密が見えない / 権限昇格できない
-- =====================================================================
do $$
declare
  v_p uuid; v_c uuid;          -- 親役 / 子役
  v_f uuid; v_other uuid;      -- 自分の家族 / 別家族
  v_a uuid;
  r text := E'\n';
  n int; t text;
begin
  select id into v_p from auth.users order by created_at limit 1;
  select id into v_c from auth.users order by created_at offset 1 limit 1;

  insert into public.idol_families(name, invite_code, created_by)
  values ('__probe_family__', '__PRB01_', v_p) returning id into v_f;

  insert into public.idol_family_members(family_id, user_id, role, display_name, is_talent)
  values (v_f, v_p, 'parent', 'おかあさん', false),
         (v_f, v_c, 'child',  'むすめ',     true);

  insert into public.idol_families(name, invite_code, created_by)
  values ('__probe_other__', '__PRB02_', v_p) returning id into v_other;
  insert into public.idol_practice_logs(family_id, subject_user_id, log_date, total_minutes)
  values (v_other, v_p, public.idol_jst_today() - 3, 30);

  insert into public.idol_auditions(family_id, title, status)
  values (v_f, '○○プロダクション オーディション', 'applied') returning id into v_a;

  insert into public.idol_audition_results
    (audition_id, family_id, result, feedback, parent_memo, fee_yen, reveal_to_child)
  values (v_a, v_f, 'failed', '表情はよいがリズムが弱い',
          '本人には言えないが今回は準備不足だった', 12000, false);

  insert into public.idol_body_records(family_id, subject_user_id, measured_on, height_cm, weight_kg, visible_to_child)
  values (v_f, v_c, public.idol_jst_today(),     132.5, 28.40, false),
         (v_f, v_c, public.idol_jst_today() - 1, 132.4, 28.30, true);

  insert into public.idol_parent_pins(user_id, family_id, pin_salt, pin_hash)
  values (v_p, v_f, 'c2FsdA==', 'aGFzaA==');   -- ダミー

  -- ===== 娘のアカウントになりすます =====
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_c::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into n from public.idol_body_records;
  r := r || format('1. 子: idol_body_records          = %s件（期待 1）%s', n, E'\n');

  select count(*) into n from public.idol_body_records where weight_kg = 28.40;
  r := r || format('2. 子: 非公開の体重行             = %s件（期待 0）%s', n, E'\n');

  select count(*) into n from public.idol_parent_pins;
  r := r || format('3. 子: idol_parent_pins           = %s件（期待 0）%s', n, E'\n');

  select count(*) into n from public.idol_audition_results;
  r := r || format('4. 子: idol_audition_results      = %s件（期待 0）%s', n, E'\n');

  select coalesce(shared_result, '(null)') into t from public.idol_auditions where id = v_a;
  r := r || format('5. 子: auditions.shared_result    = %s（期待 (null)）%s', t, E'\n');

  select count(*) into n from public.idol_practice_logs;
  r := r || format('6. 子: 他家族の練習記録           = %s件（期待 0）%s', n, E'\n');

  select count(*) into n from public.idol_families;
  r := r || format('7. 子: 見える家族の数             = %s件（期待 1）%s', n, E'\n');

  begin
    update public.idol_family_members set role = 'parent' where user_id = v_c;
    r := r || '8. 子: 自分を親に昇格            = ★成功してしまった（NG）' || E'\n';
  exception when others then
    r := r || format('8. 子: 自分を親に昇格            = 拒否 [%s]%s', sqlerrm, E'\n');
  end;

  begin
    insert into public.idol_body_records(family_id, subject_user_id, measured_on, weight_kg)
    values (v_f, v_c, public.idol_jst_today() - 5, 99.9);
    r := r || '9. 子: 体重記録を書き込み        = ★成功してしまった（NG）' || E'\n';
  exception when others then
    r := r || format('9. 子: 体重記録を書き込み        = 拒否 [%s]%s', sqlerrm, E'\n');
  end;

  begin
    insert into public.idol_family_members(family_id, user_id, role, display_name)
    values (v_other, v_c, 'parent', 'のっとり');
    r := r || '10. 子: 別家族へ直接メンバー追加 = ★成功してしまった（NG）' || E'\n';
  exception when others then
    r := r || format('10. 子: 別家族へ直接メンバー追加 = 拒否 [%s]%s', sqlerrm, E'\n');
  end;

  reset role;
  raise exception 'PROBE:%', r;
end $$;


-- =====================================================================
-- ブロック2: 「娘にも結果を伝える」フローと Storage のパス制御
--   親メモ・費用は reveal 後も子に見えないことがポイント
-- =====================================================================
do $$
declare
  v_p uuid; v_c uuid; v_f uuid; v_other uuid; v_a uuid;
  r text := E'\n'; n int; t text;
begin
  select id into v_p from auth.users order by created_at limit 1;
  select id into v_c from auth.users order by created_at offset 1 limit 1;

  insert into public.idol_families(name, invite_code, created_by)
  values ('__probe_family__', '__PRB01_', v_p) returning id into v_f;
  insert into public.idol_families(name, invite_code, created_by)
  values ('__probe_other__', '__PRB02_', v_p) returning id into v_other;

  insert into public.idol_family_members(family_id, user_id, role, display_name, is_talent)
  values (v_f, v_p, 'parent', 'おかあさん', false),
         (v_f, v_c, 'child',  'むすめ',     true);

  insert into public.idol_auditions(family_id, title, status)
  values (v_f, '○○プロダクション オーディション', 'applied') returning id into v_a;
  insert into public.idol_audition_results
    (audition_id, family_id, result, feedback, parent_memo, fee_yen, reveal_to_child, child_note)
  values (v_a, v_f, 'failed', '表情はよいがリズムが弱い',
          '本人には言えないが今回は準備不足だった', 12000, false, '');

  -- ===== 親アカウント =====
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_p::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into n from public.idol_audition_results;
  r := r || format('A. 親: idol_audition_results     = %s件（期待 1）%s', n, E'\n');

  update public.idol_audition_results
     set reveal_to_child = true, child_note = 'つぎがあるよ！よくがんばったね'
   where audition_id = v_a;
  r := r || 'B. 親: reveal_to_child を ON にした' || E'\n';

  begin
    insert into storage.objects(bucket_id, name, owner, owner_id)
    values ('idol-media', v_f::text || '/practice/2026/ok.webp', v_p, v_p::text);
    r := r || 'C. 親: 自分の家族パスへ保存      = 許可（期待どおり）' || E'\n';
  exception when others then
    r := r || format('C. 親: 自分の家族パスへ保存      = ★拒否 [%s]（NG）%s', sqlerrm, E'\n');
  end;

  begin
    insert into storage.objects(bucket_id, name, owner, owner_id)
    values ('idol-media', v_other::text || '/practice/2026/steal.webp', v_p, v_p::text);
    r := r || 'D. 親: 他家族パスへ保存          = ★成功してしまった（NG）' || E'\n';
  exception when others then
    r := r || 'D. 親: 他家族パスへ保存          = 拒否（期待どおり）' || E'\n';
  end;

  begin
    insert into storage.objects(bucket_id, name, owner, owner_id)
    values ('idol-media', v_f::text || '/private/2026/secret.webp', v_p, v_p::text);
    r := r || 'E. 親: private 領域へ保存        = 許可（期待どおり）' || E'\n';
  exception when others then
    r := r || format('E. 親: private 領域へ保存        = ★拒否 [%s]（NG）%s', sqlerrm, E'\n');
  end;

  -- ===== 娘アカウントに切り替え =====
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_c::text, 'role', 'authenticated')::text, true);

  select coalesce(shared_result, '(null)') into t from public.idol_auditions where id = v_a;
  r := r || format('F. 子: shared_result             = %s（期待 failed）%s', t, E'\n');

  select coalesce(shared_result_note, '(null)') into t from public.idol_auditions where id = v_a;
  r := r || format('G. 子: 子ども向けメッセージ      = %s%s', t, E'\n');

  select count(*) into n from public.idol_audition_results;
  r := r || format('H. 子: 親メモ・費用のテーブル    = %s件（期待 0）%s', n, E'\n');

  select count(*) into n from storage.objects
   where bucket_id = 'idol-media' and name like v_f::text || '/private/%';
  r := r || format('I. 子: private 領域のファイル    = %s件（期待 0）%s', n, E'\n');

  select count(*) into n from storage.objects
   where bucket_id = 'idol-media' and name like v_f::text || '/practice/%';
  r := r || format('J. 子: 練習写真は見える          = %s件（期待 1）%s', n, E'\n');

  begin
    insert into storage.objects(bucket_id, name, owner, owner_id)
    values ('idol-media', v_f::text || '/private/2026/child.webp', v_c, v_c::text);
    r := r || 'K. 子: private 領域へ保存        = ★成功してしまった（NG）' || E'\n';
  exception when others then
    r := r || 'K. 子: private 領域へ保存        = 拒否（期待どおり）' || E'\n';
  end;

  reset role;
  raise exception 'PROBE:%', r;
end $$;


-- =====================================================================
-- ブロック3: ごほうびの改ざん防止・なりすまし防止・ビューの家族分離
-- =====================================================================
do $$
declare
  v_p uuid; v_c uuid; v_f uuid; v_other uuid; v_r uuid; v_log uuid;
  r text := E'\n'; n int;
begin
  select id into v_p from auth.users order by created_at limit 1;
  select id into v_c from auth.users order by created_at offset 1 limit 1;

  insert into public.idol_families(name, invite_code, created_by)
  values ('__probe_family__', '__PRB01_', v_p) returning id into v_f;
  insert into public.idol_families(name, invite_code, created_by)
  values ('__probe_other__', '__PRB02_', v_p) returning id into v_other;
  insert into public.idol_family_members(family_id, user_id, role, display_name, is_talent)
  values (v_f, v_p, 'parent', 'おかあさん', false),
         (v_f, v_c, 'child',  'むすめ',     true);

  insert into public.idol_rewards(family_id, title, cost_points)
  values (v_f, 'ディズニーに行く', 500) returning id into v_r;

  insert into public.idol_practice_logs(family_id, subject_user_id, log_date, total_minutes)
  values (v_f, v_c, public.idol_jst_today(),     30),
         (v_f, v_c, public.idol_jst_today() - 1, 20),
         (v_f, v_c, public.idol_jst_today() - 2, 25);
  insert into public.idol_practice_logs(family_id, subject_user_id, log_date, total_minutes)
  values (v_other, v_p, public.idol_jst_today(), 60);

  select id into v_log from public.idol_practice_logs
   where family_id = v_f and log_date = public.idol_jst_today();

  -- ===== 娘アカウント =====
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_c::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  begin
    update public.idol_rewards set status = 'requested', requested_at = now() where id = v_r;
    r := r || 'L. 子: ごほうびを「交換したい」   = 許可（期待どおり）' || E'\n';
  exception when others then
    r := r || format('L. 子: ごほうびを「交換したい」   = ★拒否 [%s]（NG）%s', sqlerrm, E'\n');
  end;

  begin
    update public.idol_rewards set status = 'redeemed' where id = v_r;
    r := r || 'M. 子: ごほうびを自分で承認      = ★成功してしまった（NG）' || E'\n';
  exception when others then
    r := r || format('M. 子: ごほうびを自分で承認      = 拒否 [%s]%s', sqlerrm, E'\n');
  end;

  begin
    update public.idol_rewards set cost_points = 1 where id = v_r;
    r := r || 'N. 子: 必要ポイントを改ざん      = ★成功してしまった（NG）' || E'\n';
  exception when others then
    r := r || format('N. 子: 必要ポイントを改ざん      = 拒否 [%s]%s', sqlerrm, E'\n');
  end;

  begin
    insert into public.idol_cheer_messages(family_id, author_user_id, practice_log_id, body)
    values (v_f, v_p, v_log, 'ママになりすました応援');
    r := r || 'O. 子: 親になりすまして投稿      = ★成功してしまった（NG）' || E'\n';
  exception when others then
    r := r || 'O. 子: 親になりすまして投稿      = 拒否（期待どおり）' || E'\n';
  end;

  select count(*) into n from public.v_idol_streaks;
  r := r || format('P. 子: v_idol_streaks の行数     = %s件（期待 1）%s', n, E'\n');

  select coalesce(max(current_streak), -1) into n from public.v_idol_streaks;
  r := r || format('Q. 子: 連続日数                  = %s日（期待 3）%s', n, E'\n');

  select count(*) into n from public.v_idol_points;
  r := r || format('R. 子: v_idol_points の行数      = %s件（期待 1）%s', n, E'\n');

  reset role;
  raise exception 'PROBE:%', r;
end $$;


-- =====================================================================
-- 後始末の確認（すべて 0 になるはず。1件でも残っていたらロールバックが効いていない）
-- =====================================================================
-- select
--   (select count(*) from public.idol_families)         as families,
--   (select count(*) from public.idol_family_members)   as members,
--   (select count(*) from public.idol_audition_results) as results,
--   (select count(*) from public.idol_body_records)     as body_records,
--   (select count(*) from public.idol_parent_pins)      as pins,
--   (select count(*) from storage.objects where bucket_id = 'idol-media') as media_objects;
