// =====================================================================
// storage.js — localStorage / sessionStorage のラッパ
//
// 方針:
//   ・Supabase が source of truth。ここは「起動を速くするキャッシュ」と
//     「圏外での書き込みバッファ（outbox）」だけを担う。
//   ・キーは idol:v1:... で始める。スキーマを変えたら v2 に上げて丸ごと捨てる
//     （移行コードを書かない）。
//
// ★ここにキャッシュしてはいけないもの:
//   - idol_body_records / idol_audition_results / idol_parent_pins
//     → デリケート。PINロックの外に平文で残るとロックの意味が消える。メモリのみ。
//   - Storage の署名付きURL → 期限切れ＋事実上のアクセストークン
//   - 画像バイナリ → 容量的に無理。Service Worker の Cache Storage で扱う
//   - families.invite_code → 漏れると他人が家族に入れる。表示時に都度取得
// =====================================================================

const PREFIX = 'idol:v1:';

/** 同期対象テーブル（差分同期＋localStorageキャッシュの対象） */
export const SYNC_TABLES = [
  'idol_practice_menus',
  'idol_practice_logs',
  'idol_practice_log_items',
  'idol_goals',
  'idol_auditions',
  'idol_audition_tasks',
  'idol_lessons',
  'idol_portfolio_entries',
  'idol_cheer_messages',
  'idol_rewards',
  'idol_earned_badges',
];

function safeGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSet(key, val) {
  try { localStorage.setItem(key, val); return true; }
  catch (e) {
    // 容量超過。キャッシュを捨てて再挑戦する（データはサーバーにあるので失っても復旧できる）
    console.warn('[storage] 書き込み失敗。キャッシュを破棄します', e);
    clearCaches();
    try { localStorage.setItem(key, val); return true; } catch { return false; }
  }
}

export function readJSON(key, fallback) {
  const raw = safeGet(PREFIX + key);
  if (raw == null) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

export function writeJSON(key, value) {
  return safeSet(PREFIX + key, JSON.stringify(value));
}

export function removeKey(key) {
  try { localStorage.removeItem(PREFIX + key); } catch { /* noop */ }
}

/** idol:v1: で始まるキーをすべて列挙 */
function ownKeys() {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) out.push(k);
    }
  } catch { /* noop */ }
  return out;
}

/** テーブルキャッシュだけを消す（設定と outbox は残す） */
export function clearCaches() {
  for (const k of ownKeys()) {
    if (k.includes(':table:') || k.includes(':meta')) {
      try { localStorage.removeItem(k); } catch { /* noop */ }
    }
  }
}

/** サインアウト時: このアプリのローカルデータを全部消す */
export function clearAll() {
  for (const k of ownKeys()) {
    try { localStorage.removeItem(k); } catch { /* noop */ }
  }
  try { sessionStorage.removeItem('idol:unlockedUntil'); } catch { /* noop */ }
}

// ── テーブルキャッシュ ───────────────────────────────
export const tableKey = (familyId, table) => `${familyId}:table:${table}`;

export function readTable(familyId, table) {
  return readJSON(tableKey(familyId, table), []);
}
export function writeTable(familyId, table, rows) {
  return writeJSON(tableKey(familyId, table), rows);
}

// ── 同期メタ（テーブルごとの最終同期時刻）────────────
export function readMeta(familyId) {
  return readJSON(`${familyId}:meta`, { lastSyncAt: {} });
}
export function writeMeta(familyId, meta) {
  return writeJSON(`${familyId}:meta`, meta);
}

// ── outbox（オフライン中の書き込みキュー）───────────
export function readOutbox() {
  return readJSON('outbox', []);
}
export function writeOutbox(jobs) {
  return writeJSON('outbox', jobs);
}
export function pushOutbox(job) {
  const jobs = readOutbox();
  jobs.push(job);
  writeOutbox(jobs);
  return jobs.length;
}

// ── UI設定（モードなど。素の localStorage キーを使う）──
export function getMode() {
  const m = safeGet('idol:mode');
  return m === 'adult' ? 'adult' : 'kid';
}
export function setMode(mode) {
  try { localStorage.setItem('idol:mode', mode === 'adult' ? 'adult' : 'kid'); } catch { /* noop */ }
}

// 背景イラストの選択（1..HERO_MAX）。
// 端末ごとの見た目の好みなので mode と同じく localStorage に置く。
// サーバーに置くと、選ぶたびに通信が要るうえ、
// 家族で1つの値を取り合うことになる（親と娘で好みが違う）。
// ★上限は持たない。枚数を知っているのは stage.js だけ（HERO_COUNT）。
//   ここにも枚数を書くと、イラストを増やしたとき片方だけ直して壊れる。
export function getHeroId() {
  const n = Number(safeGet('idol:hero'));
  return Number.isInteger(n) && n >= 1 ? n : 1;
}
export function setHeroId(n) {
  const v = Number.isInteger(n) && n >= 1 ? n : 1;
  try { localStorage.setItem('idol:hero', String(v)); } catch { /* noop */ }
}

// ── PINキャッシュ（別端末ログイン時にサーバーから流し込む）──
export function readPinCache() {
  return readJSON('pin', null);   // { salt, hash, iterations }
}
export function writePinCache(v) {
  return writeJSON('pin', v);
}
export function clearPinCache() {
  removeKey('pin');
}

// ── PIN失敗回数（端末ローカルのクールダウン）──────────
export function readPinFail() {
  return readJSON('pinFail', { count: 0, lockedUntil: 0 });
}
export function writePinFail(v) {
  return writeJSON('pinFail', v);
}
