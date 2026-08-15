// =====================================================================
// auth.js — 認証と家族の解決
//
// ★親と娘で「別アカウント」。family 単位でデータを共有する。
// ★家族への参加は必ず RPC 経由（idol_create_family / idol_join_family）。
//   idol_family_members への直接 INSERT は RLS で禁止してある
//   （family_id を推測されて勝手に入られるのを防ぐため）。
// =====================================================================
import { supabase } from './config.js';
import * as Store from './store.js';
import * as LS from './storage.js';

/** サインアップ。メール確認が有効な場合は session が null で返る */
export async function signUp(email, password) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw new Error(translate(error.message));
  return data;
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(translate(error.message));
  return data;
}

export async function signOut() {
  await supabase.auth.signOut();
  LS.clearAll();
  Store.resetSession();
}

export async function resetPassword(email) {
  const redirectTo = location.origin + location.pathname;
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw new Error(translate(error.message));
}

/** パスワードの再確認（PIN忘れのリカバリで本人確認に使う） */
export async function verifyPassword(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return !error;
}

/** 家族を作る（作った人が親になる） */
export async function createFamily(familyName, displayName) {
  const { data, error } = await supabase.rpc('idol_create_family', {
    p_family_name: familyName || 'わたしの家族',
    p_display_name: displayName || 'おとうさん・おかあさん',
  });
  if (error) throw new Error(translate(error.message));
  return data;
}

/** 招待コードで家族に参加する（必ず child として入る） */
export async function joinFamily(inviteCode, displayName, isTalent = true) {
  const { data, error } = await supabase.rpc('idol_join_family', {
    p_invite_code: inviteCode,
    p_display_name: displayName || '',
    p_is_talent: isTalent,
  });
  if (error) throw new Error(translate(error.message));
  return data;
}

/** 招待コードを作り直す（親のみ） */
export async function rotateInviteCode() {
  const { data, error } = await supabase.rpc('idol_rotate_invite_code');
  if (error) throw new Error(translate(error.message));
  return data;
}

/**
 * 現在のセッションから、自分のメンバー行・家族・家族全員を読み込んで Store に入れる。
 * @returns {'ok'|'no-session'|'no-family'}
 */
export async function loadSession() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) {
    Store.resetSession();
    return 'no-session';
  }
  Store.set({ user: session.user });

  const { data: me, error } = await supabase
    .from('idol_family_members')
    .select('*')
    .eq('user_id', session.user.id)
    .maybeSingle();

  if (error) {
    console.error('[auth] メンバー取得に失敗', error);
    throw new Error('家族情報の読み込みに失敗しました');
  }
  if (!me) {
    Store.set({ member: null, family: null, role: 'child' });
    return 'no-family';   // 家族の作成 or 参加へ誘導する
  }

  const [{ data: family }, { data: members }] = await Promise.all([
    supabase.from('idol_families').select('id,name,timezone,created_by').eq('id', me.family_id).maybeSingle(),
    supabase.from('idol_family_members').select('*').eq('family_id', me.family_id).order('joined_at'),
  ]);

  const list = members || [];
  const talent = list.find((m) => m.is_talent) || list.find((m) => m.role === 'child');

  Store.set({
    member: me,
    family: family || null,
    role: me.role,
    members: list,
    talentId: talent?.user_id || me.user_id,
  });
  return 'ok';
}

/** 招待コードは必要なときだけ取りに行く（localStorage に残さない） */
export async function fetchInviteCode() {
  const family = Store.get('family');
  if (!family) return null;
  const { data, error } = await supabase
    .from('idol_families').select('invite_code').eq('id', family.id).maybeSingle();
  if (error) throw new Error(translate(error.message));
  return data?.invite_code || null;
}

/** 自分の表示名などを更新する */
export async function updateMyProfile(patch) {
  const me = Store.get('member');
  if (!me) return;
  const { data, error } = await supabase
    .from('idol_family_members')
    .update(patch)
    .eq('id', me.id)
    .select()
    .maybeSingle();
  if (error) throw new Error(translate(error.message));
  if (data) Store.set({ member: data });
  return data;
}

/** Supabase のエラーメッセージを日本語に寄せる */
function translate(msg) {
  const m = String(msg || '');
  if (/Invalid login credentials/i.test(m)) return 'メールアドレスかパスワードが違います';
  if (/User already registered/i.test(m)) return 'このメールアドレスは登録済みです';
  if (/Password should be at least/i.test(m)) return 'パスワードは6文字以上にしてください';
  if (/Email not confirmed/i.test(m)) return 'メールの確認がまだです。届いたリンクを開いてください';
  if (/rate limit|too many/i.test(m)) return '試行回数が多すぎます。しばらく待ってからお試しください';
  if (/Unable to validate email/i.test(m)) return 'メールアドレスの形式が正しくありません';
  return m;
}
