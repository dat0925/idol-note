// =====================================================================
// store.js — 最小 pub/sub ストア
//
// 方針: フレームワークを持ち込まないので、状態は「ただのオブジェクト」。
//   ・set(patch) で実際に変わったキーだけ通知する（無駄な再描画を抑える）
//   ・購読はキー単位。必ず unsubscribe を返し、view.destroy() で呼ぶ
//   ・Proxy も immutable も time-travel もやらない（このアプリには過剰）
//
// 注意: 配列やオブジェクトを更新するときは必ず「新しい参照」で渡すこと。
//   同一参照だと変更なしと判定されて通知されない。
// =====================================================================

const state = {
  // ── セッション ──
  user: null,        // Supabase の user
  member: null,      // idol_family_members の自分の行
  family: null,      // idol_families の行
  role: 'child',     // 'parent' | 'child'（サーバー由来。不変）
  members: [],       // 家族全員
  talentId: null,    // アイドルを目指す本人の user_id

  // ── UI ──
  mode: 'kid',       // 'kid' | 'adult'（端末ローカルの表示設定）
  unlocked: false,   // おとなモードのPIN解錠状態（sessionStorage 由来）
  online: navigator.onLine,
  route: null,
  booting: true,

  // ── ドメイン（画面をまたいで使うものだけ置く）──
  menus: [],
  todayLog: null,
  todayItems: [],
  streak: { current_streak: 0, best_streak: 0, total_days: 0, practiced_today: false },
  points: { earned_points: 0, spent_points: 0, balance_points: 0 },
  badges: [],
  goals: [],
  auditions: [],
  lessons: [],
  cheers: [],
  rewards: [],
  portfolio: [],
};

const subs = new Map();   // key -> Set<fn>

/** キーを渡すとその値、省略すると state 全体を返す */
export function get(key) {
  return key === undefined ? state : state[key];
}

/** 変更のあったキーの購読者だけを呼ぶ */
export function set(patch) {
  const changed = [];
  for (const [k, v] of Object.entries(patch)) {
    if (state[k] === v) continue;
    state[k] = v;
    changed.push(k);
  }
  if (!changed.length) return;

  const called = new Set();   // 複数キーを購読している関数の重複呼び出しを防ぐ
  for (const k of changed) {
    const set_ = subs.get(k);
    if (!set_) continue;
    for (const fn of set_) {
      if (called.has(fn)) continue;
      called.add(fn);
      try { fn(state, changed); } catch (e) { console.error('[store] 購読者でエラー', e); }
    }
  }
}

/**
 * キー（文字列 or 配列）を購読する。
 * @returns {() => void} 解除関数。view の destroy() で必ず呼ぶこと。
 */
export function subscribe(keys, fn) {
  const list = Array.isArray(keys) ? keys : [keys];
  for (const k of list) {
    if (!subs.has(k)) subs.set(k, new Set());
    subs.get(k).add(fn);
  }
  return () => { for (const k of list) subs.get(k)?.delete(fn); };
}

/** サインアウト時などに、セッション由来の状態をまとめて初期化する */
export function resetSession() {
  set({
    user: null, member: null, family: null, role: 'child', members: [], talentId: null,
    unlocked: false,
    menus: [], todayLog: null, todayItems: [],
    streak: { current_streak: 0, best_streak: 0, total_days: 0, practiced_today: false },
    points: { earned_points: 0, spent_points: 0, balance_points: 0 },
    badges: [], goals: [], auditions: [], lessons: [], cheers: [], rewards: [], portfolio: [],
  });
}

/** 現在ユーザーが親かどうか（サーバー由来のロールで判定） */
export function isParent() {
  return state.role === 'parent';
}

/** おとなモードの機密画面に入れるか（親 かつ PIN解錠済み） */
export function canSeeSecure() {
  return isParent() && state.unlocked;
}
