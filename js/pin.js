// =====================================================================
// pin.js — おとなモードの4桁PIN
//
// ★これは「目隠し」であって「防御」ではない。
//   4桁 = 10,000通り。ハッシュを入手できれば総当たりは一瞬で終わる。
//   本当の防御線は RLS：
//     - idol_audition_results / idol_body_records は親アカウントしか読めない
//     - idol_parent_pins の行自体を子アカウントは取得できない
//   娘が自分のアカウントでログインしている限り、PINの有無に関わらず
//   デリケートな情報は API から返ってこない。
//   PIN が守るのは「親がログインしたままの端末を娘が触った」ケースだけ。
//
// ★保存方式: PBKDF2-SHA256(20万回) + ランダム16byte salt。平文は保存しない。
// ★解錠状態は sessionStorage + 10分TTL。localStorage には絶対に置かない。
// =====================================================================
import { supabase } from './config.js';
import * as Store from './store.js';
import * as LS from './storage.js';

const UNLOCK_KEY = 'idol:unlockedUntil';
const UNLOCK_MS = 10 * 60 * 1000;      // 解錠の有効期限 10分
const ITERATIONS = 200000;

const enc = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** PBKDF2-SHA256 で PIN からハッシュを導出する */
export async function derive(pin, saltB64, iterations = ITERATIONS) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: unb64(saltB64), iterations, hash: 'SHA-256' }, key, 256);
  return b64(bits);
}

/** タイミング差で当たりを推測されないよう、長さも含めて定数時間で比較する */
function constantTimeEqual(a, b) {
  let diff = a.length ^ b.length;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** サーバー（またはローカルキャッシュ）から PIN レコードを取る */
async function fetchPinRecord() {
  const user = Store.get('user');
  if (!user) return null;
  const { data, error } = await supabase
    .from('idol_parent_pins').select('*').eq('user_id', user.id).maybeSingle();

  if (error) {
    // オフラインなど。端末キャッシュにフォールバックする
    console.warn('[pin] サーバー取得に失敗。ローカルキャッシュを使います', error.message);
    return LS.readPinCache();
  }
  if (data) {
    // 別端末でも同じ PIN が使えるよう、ハッシュだけ端末にも置く
    LS.writePinCache({ pin_salt: data.pin_salt, pin_hash: data.pin_hash, iterations: data.iterations });
  }
  return data || LS.readPinCache();
}

/** PIN が設定済みか */
export async function hasPin() {
  return !!(await fetchPinRecord());
}

/** PIN を設定・変更する（親のみ） */
export async function setPin(pin) {
  const user = Store.get('user');
  const family = Store.get('family');
  if (!user || !family) throw new Error('ログインが必要です');
  if (!/^\d{4}$/.test(pin)) throw new Error('4桁の数字を入力してください');

  const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  const hash = await derive(pin, salt, ITERATIONS);

  const { error } = await supabase.from('idol_parent_pins').upsert({
    user_id: user.id,
    family_id: family.id,
    pin_salt: salt,
    pin_hash: hash,
    iterations: ITERATIONS,
    failed_count: 0,
    locked_until: null,
  }, { onConflict: 'user_id' });
  if (error) throw new Error(error.message);

  LS.writePinCache({ pin_salt: salt, pin_hash: hash, iterations: ITERATIONS });
  LS.writePinFail({ count: 0, lockedUntil: 0 });
  unlock();
}

/**
 * PIN を検証する。
 * @returns {{ok:boolean, reason?:'no_pin'|'locked'|'wrong', wait?:number, left?:number}}
 */
export async function verifyPin(pin) {
  // 端末ローカルのクールダウン（オフラインでも効かせるため）
  const fail = LS.readPinFail();
  if (fail.lockedUntil > Date.now()) {
    return { ok: false, reason: 'locked', wait: Math.ceil((fail.lockedUntil - Date.now()) / 1000) };
  }

  const rec = await fetchPinRecord();
  if (!rec) return { ok: false, reason: 'no_pin' };

  const hash = await derive(pin, rec.pin_salt, rec.iterations || ITERATIONS);
  if (constantTimeEqual(hash, rec.pin_hash)) {
    LS.writePinFail({ count: 0, lockedUntil: 0 });
    supabase.from('idol_parent_pins')
      .update({ failed_count: 0, locked_until: null })
      .eq('user_id', Store.get('user').id)
      .then(() => {}, () => {});   // 失敗しても解錠は妨げない
    unlock();
    return { ok: true };
  }

  // 失敗: 5回で60秒、以降は倍々（最大10分）
  const count = (fail.count || 0) + 1;
  let lockedUntil = 0;
  if (count >= 5) {
    const wait = Math.min(600, 60 * Math.pow(2, count - 5)) * 1000;
    lockedUntil = Date.now() + wait;
  }
  LS.writePinFail({ count, lockedUntil });
  return { ok: false, reason: 'wrong', left: Math.max(0, 5 - count) };
}

/** PIN を削除する（リカバリ後の再設定前などに使う） */
export async function clearPin() {
  const user = Store.get('user');
  if (user) {
    await supabase.from('idol_parent_pins').delete().eq('user_id', user.id);
  }
  LS.clearPinCache();
  LS.writePinFail({ count: 0, lockedUntil: 0 });
  lock();
}

// ── 解錠状態 ─────────────────────────────────────────

export function unlock() {
  try { sessionStorage.setItem(UNLOCK_KEY, String(Date.now() + UNLOCK_MS)); } catch { /* noop */ }
  Store.set({ unlocked: true });
}

export function lock() {
  try { sessionStorage.removeItem(UNLOCK_KEY); } catch { /* noop */ }
  Store.set({ unlocked: false });
  // 解錠中に読み込んだデリケートなデータはメモリからも捨てる
  window.dispatchEvent(new CustomEvent('idol:locked'));
}

export function isUnlocked() {
  let until = 0;
  try { until = Number(sessionStorage.getItem(UNLOCK_KEY) || 0); } catch { /* noop */ }
  return until > Date.now();
}

/** 解錠の有効期限を延ばす（操作があるたびに呼ぶ） */
export function touch() {
  if (isUnlocked()) unlock();
}

/**
 * 自動施錠の監視を開始する。
 *   - 無操作10分
 *   - タブが非表示になって60秒
 *   - リロード（sessionStorage は残るが TTL で失効する）
 */
export function startAutoLock() {
  let idleTimer = null;
  let hiddenAt = 0;

  const resetIdle = () => {
    if (!Store.get('unlocked')) return;
    touch();
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { if (Store.get('unlocked')) lock(); }, UNLOCK_MS);
  };

  ['pointerdown', 'keydown', 'wheel'].forEach((t) =>
    window.addEventListener(t, resetIdle, { passive: true }));

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenAt = Date.now();
    } else {
      if (hiddenAt && Date.now() - hiddenAt > 60000 && Store.get('unlocked')) lock();
      if (!isUnlocked() && Store.get('unlocked')) lock();
      hiddenAt = 0;
      resetIdle();
    }
  });

  // 起動時に sessionStorage の状態を Store へ反映
  Store.set({ unlocked: isUnlocked() });
  if (Store.get('unlocked')) resetIdle();
}
