// =====================================================================
// format.js — 純関数だけを置く層
//
// ★DOM もネットワークも触らない。だから node --test でそのままテストできる。
//   （tests/format.test.mjs）
// ★日付は必ず JST。toISOString().slice(0,10) は日本の 0〜9時に前日になるので
//   このファイル以外でも絶対に使わないこと。
// =====================================================================

const TZ = 'Asia/Tokyo';

/** 日本時間の今日を 'YYYY-MM-DD' で返す */
export function jstToday(now = new Date()) {
  // 'sv-SE' ロケールは ISO 形式 (YYYY-MM-DD) を返す。TZ 指定と組み合わせて使う。
  return now.toLocaleDateString('sv-SE', { timeZone: TZ });
}

/** Date → 'YYYY-MM-DD'（JST） */
export function toDateKey(d) {
  return new Date(d).toLocaleDateString('sv-SE', { timeZone: TZ });
}

/** 'YYYY-MM-DD' に日数を足す（純粋な暦計算。TZ の影響を受けないよう UTC 正午で計算） */
export function addDays(dateKey, days) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d, 12) + days * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

/** 2つの 'YYYY-MM-DD' の日数差（a - b） */
export function diffDays(a, b) {
  const p = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d, 12); };
  return Math.round((p(a) - p(b)) / 86400000);
}

/** その週の日曜始まりの7日分のキーを返す */
export function weekKeys(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();  // 0=日
  return Array.from({ length: 7 }, (_, i) => addDays(dateKey, i - dow));
}

const DOW_JA = ['日', '月', '火', '水', '木', '金', '土'];

/** 曜日（'日'〜'土'） */
export function dowJa(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  return DOW_JA[new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()];
}

/** '8/15(金)' のような表示 */
export function shortDate(dateKey) {
  const [, m, d] = dateKey.split('-').map(Number);
  return `${m}/${d}(${dowJa(dateKey)})`;
}

/** '2026年8月15日' のような表示 */
export function longDate(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  return `${y}年${m}月${d}日`;
}

/** 分 → '1時間20分' / '20分' */
export function minutesText(min) {
  const n = Math.max(0, Math.round(Number(min) || 0));
  if (n < 60) return `${n}分`;
  const h = Math.floor(n / 60);
  const r = n % 60;
  return r ? `${h}時間${r}分` : `${h}時間`;
}

/** 締切までの残り日数を文言にする。null は空文字 */
export function deadlineText(dateKey, today = jstToday()) {
  if (!dateKey) return '';
  const n = diffDays(dateKey, today);
  if (n < 0) return `${-n}日すぎています`;
  if (n === 0) return '今日まで';
  if (n === 1) return 'あと1日';
  return `あと${n}日`;
}

/** 締切の緊急度: 'over' | 'urgent'(3日以内) | 'soon'(7日以内) | 'normal' | '' */
export function deadlineLevel(dateKey, today = jstToday()) {
  if (!dateKey) return '';
  const n = diffDays(dateKey, today);
  if (n < 0) return 'over';
  if (n <= 3) return 'urgent';
  if (n <= 7) return 'soon';
  return 'normal';
}

/**
 * 連続日数のローカル計算。
 * ★オフライン時・サーバー往復前の楽観表示専用。
 *   真値は v_idol_streaks（SQLビュー）。オンラインになったら必ず上書きする。
 * @param {string[]} doneDates 練習した日のキー配列（順不同・重複可）
 */
export function localStreak(doneDates, today = jstToday()) {
  const set = new Set(doneDates);
  // 今日まだ記録がなければ昨日から数える（朝に 0 と表示されて心が折れないように）
  let cur = set.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (set.has(cur)) { n++; cur = addDays(cur, -1); }
  return n;
}

/** 進捗率（0〜100の整数）。分母0なら0 */
export function pct(done, total) {
  const t = Number(total) || 0;
  if (t <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((Number(done) || 0) / t * 100)));
}

/** ヒートマップの濃さ 0〜4 */
export function heatLevel(minutes) {
  const n = Number(minutes) || 0;
  if (n <= 0) return 0;
  if (n < 15) return 1;
  if (n < 30) return 2;
  if (n < 60) return 3;
  return 4;
}

/** HTML エスケープ（テンプレートリテラルに値を差し込むとき必ず通す） */
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * DB のエラーメッセージを、そのまま画面に出せる日本語にする。
 *
 * ★Postgres / PostgREST の生メッセージを娘に見せない。
 *   実際に「duplicate key value violates unique constraint
 *   "idol_cheer_unique_reaction_log"」が応援画面に出てしまった。
 *   怖いし、内部のテーブル名や制約名を漏らす意味もない。
 *
 * db.js の guard() から呼ぶので、views は素の e.message を表示してよい。
 */
export function friendlyError(message) {
  const m = String(message ?? '').trim();
  if (!m) return 'うまくいきませんでした';

  // 同じスタンプを二度押した（idol_cheer_unique_reaction_log）
  if (/idol_cheer_unique_reaction_log/.test(m)) {
    return 'そのスタンプは、もうおくってあります';
  }
  // 1人1日1行（idol_practice_logs の unique）
  if (/idol_practice_logs_subject_user_id_log_date_key|practice_logs.*unique/i.test(m)) {
    return 'その日の記録はもうあります';
  }
  // 同じバッジは1回まで
  if (/idol_earned_badges_user_id_badge_key_key/.test(m)) {
    return 'そのバッジはすでに持っています';
  }
  if (/duplicate key value|unique constraint/i.test(m)) {
    return 'おなじものがすでに登録されています';
  }
  // RLS で弾かれた＝権限がない
  if (/row-level security|violates row-level security policy/i.test(m)) {
    return 'この操作をする権限がありません';
  }
  if (/permission denied/i.test(m)) {
    return 'この操作をする権限がありません';
  }
  if (/violates check constraint/i.test(m)) {
    return '入力できる範囲を超えています';
  }
  if (/violates foreign key constraint/i.test(m)) {
    return '関連するデータが見つかりません';
  }
  if (/not-null constraint/i.test(m)) {
    return '入力がたりません';
  }
  if (/JWT|token is expired|invalid claim/i.test(m)) {
    return 'ログインの有効期限が切れました。もう一度ログインしてください';
  }
  if (/Failed to fetch|NetworkError|network/i.test(m)) {
    return 'つうしんできませんでした。電波を確認してください';
  }
  // トリガーが日本語で raise しているものはそのまま通す
  if (/[ぁ-んァ-ヶ一-龠]/.test(m)) return m;

  return 'うまくいきませんでした';
}

/** オーディションのステータス表示 */
export const AUDITION_STATUS = {
  interested: { label: '検討中',   tag: '' },
  preparing:  { label: '準備中',   tag: 'tag--info' },
  applied:    { label: '応募済',   tag: 'tag--info' },
  passed_doc: { label: '書類通過', tag: 'tag--ok' },
  final:      { label: '最終選考', tag: 'tag--ok' },
  finished:   { label: '終了',     tag: '' },
  declined:   { label: '見送り',   tag: '' },
};

export const RESULT_LABEL = {
  pending: '結果まち', passed: '合格', failed: '不合格',
  declined: '辞退', withdrawn: '取り下げ',
};

/** バッジ定義（DBにマスタを持たない。ここを増やすだけでバッジが増える） */
export const BADGES = [
  { key: 'first_practice', icon: '🌱', name: 'はじめの一歩', desc: 'はじめて練習を記録した' },
  { key: 'streak_3',       icon: '✨', name: '3日つづいた',   desc: '3日連続で練習した' },
  { key: 'streak_7',       icon: '🔥', name: '1しゅうかん',   desc: '7日連続で練習した' },
  { key: 'streak_30',      icon: '👑', name: '1かげつ',       desc: '30日連続で練習した' },
  { key: 'streak_100',     icon: '💎', name: '100日',         desc: '100日連続で練習した' },
  { key: 'total_10h',      icon: '⏰', name: '10時間',        desc: '練習時間の合計が10時間' },
  { key: 'total_50h',      icon: '🎖️', name: '50時間',        desc: '練習時間の合計が50時間' },
  { key: 'total_100h',     icon: '🏆', name: '100時間',       desc: '練習時間の合計が100時間' },
  { key: 'first_audition', icon: '🎬', name: 'はじめての挑戦', desc: 'はじめてオーディションに応募した' },
  { key: 'first_photo',    icon: '📸', name: 'アルバム開始',   desc: 'はじめて写真を記録した' },
];

/**
 * 獲得すべきバッジのキーを判定する（純関数）。
 * @param {{currentStreak:number,bestStreak:number,totalMinutes:number,
 *          practiceCount:number,auditionCount:number,photoCount:number}} stats
 * @param {string[]} already 既に獲得済みのキー
 * @returns {string[]} 新たに獲得したキー
 */
export function newBadges(stats, already = []) {
  const has = new Set(already);
  const hours = (stats.totalMinutes || 0) / 60;
  const best = Math.max(stats.bestStreak || 0, stats.currentStreak || 0);
  const earned = [];
  const check = (key, cond) => { if (cond && !has.has(key)) earned.push(key); };

  check('first_practice', (stats.practiceCount || 0) >= 1);
  check('streak_3',   best >= 3);
  check('streak_7',   best >= 7);
  check('streak_30',  best >= 30);
  check('streak_100', best >= 100);
  check('total_10h',  hours >= 10);
  check('total_50h',  hours >= 50);
  check('total_100h', hours >= 100);
  check('first_audition', (stats.auditionCount || 0) >= 1);
  check('first_photo',    (stats.photoCount || 0) >= 1);
  return earned;
}
