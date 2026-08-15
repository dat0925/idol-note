// =====================================================================
// auth.js — 認証と家族の解決
//
// ★ログインは Google のみ。メール＋パスワードは扱わない。
//   理由: この Supabase プロジェクトは全ユーザーが Google 認証で、
//   パスワードを持つアカウントが1つも存在しない。
//   パスワードを併用すると「覚えられない／使い回す／再設定導線が要る」を
//   9歳の娘に背負わせることになるので、入口を1つに絞っている。
//
// ★親と娘で「別アカウント」。family 単位でデータを共有する。
// ★家族への参加は必ず RPC 経由（idol_create_family / idol_join_family）。
//   idol_family_members への直接 INSERT は RLS で禁止してある
//   （family_id を推測されて勝手に入られるのを防ぐため）。
// =====================================================================
import { supabase } from './config.js';
import * as Store from './store.js';
import * as LS from './storage.js';

// PIN リセットのために Google 再ログインへ飛ばしたことを覚えておく印。
// sessionStorage はタブを閉じると消え、OAuth のリダイレクトは同じタブに
// 戻ってくるので、この用途にちょうどよい。
const REAUTH_KEY = 'idol-reauth-pin';
const REAUTH_TTL_MS = 10 * 60 * 1000;

/**
 * Google でログインする。呼ぶとページごと Google へ遷移するので、
 * この関数のあとに処理を続けないこと。
 *
 * @param {{forceReauth?: boolean}} opts
 *   forceReauth=true で prompt=login を付け、Google 側でパスワードの
 *   再入力を強制する（PIN リセットの本人確認に使う）。
 *   通常時は prompt=select_account。家族で端末を共有するため、
 *   「前回の人のまま黙って入ってしまう」のを防ぐ。
 */
export async function signInWithGoogle({ forceReauth = false } = {}) {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: location.origin + location.pathname,
      queryParams: { prompt: forceReauth ? 'login' : 'select_account' },
    },
  });
  if (error) throw new Error(translate(error.message));
}

export async function signOut() {
  await supabase.auth.signOut();
  LS.clearAll();
  Store.resetSession();
}

/** PIN リセットのための再ログインを始める直前に呼ぶ */
export function beginPinReauth() {
  sessionStorage.setItem(REAUTH_KEY, String(Date.now()));
}

/**
 * 再ログインから戻ってきたかを判定して、印を消す（1回きり）。
 *
 * 印だけを条件にすると、印を自分で書き込んで再読み込みするだけで
 * PIN リセットに入れてしまう。そこで「実際に今しがた Google で
 * 認証し直したか」を last_sign_in_at で裏取りする。
 */
export async function consumePinReauth() {
  const at = sessionStorage.getItem(REAUTH_KEY);
  sessionStorage.removeItem(REAUTH_KEY);
  if (!at || Date.now() - Number(at) > REAUTH_TTL_MS) return false;

  const { data: { session } } = await supabase.auth.getSession();
  const signedInAt = Date.parse(session?.user?.last_sign_in_at || '');
  if (!Number.isFinite(signedInAt)) return false;
  return Date.now() - signedInAt < REAUTH_TTL_MS;
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
  if (/provider is not enabled/i.test(m)) return 'Google ログインが有効になっていません';
  if (/redirect|invalid.*url/i.test(m)) return 'ログイン後の戻り先が許可されていません（Supabase の設定を確認してください）';
  if (/rate limit|too many/i.test(m)) return '試行回数が多すぎます。しばらく待ってからお試しください';
  if (/招待コードが見つかりません/.test(m)) return '招待コードが見つかりません';
  if (/すでに家族に所属しています/.test(m)) return 'すでに家族に参加しています';
  return m;
}
