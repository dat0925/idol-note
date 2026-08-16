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

/** 'YYYY-MM-DD' に月を足す（月末は行き過ぎないよう丸める。1/31 + 1か月 = 2/28） */
export function addMonths(dateKey, n) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const total = (y * 12 + (m - 1)) + n;
  const ny = Math.floor(total / 12);
  const nm = total % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0, 12)).getUTCDate();
  return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/** その月の1日 */
export function monthStart(dateKey) {
  return dateKey.slice(0, 7) + '-01';
}

/** その月の末日 */
export function monthEnd(dateKey) {
  const [y, m] = dateKey.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0, 12)).getUTCDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
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

// =====================================================================
// 年齢
//   生年月日は idol_family_members.birthday に入れる。
//   ★「その日に何歳だったか」を出せるようにしている。
//     目標の期日は未来なので、「本番のとき10歳2か月」のように
//     未来の年齢を出す必要がある。today 固定で計算してはいけない。
// =====================================================================

/**
 * 指定日の年齢を { years, months } で返す。生年月日より前なら null。
 * @param {string} birthday 'YYYY-MM-DD'
 * @param {string} dateKey  'YYYY-MM-DD'
 */
export function ageAt(birthday, dateKey = jstToday()) {
  if (!birthday || !dateKey) return null;
  const [by, bm, bd] = birthday.split('-').map(Number);
  const [y, m, d] = dateKey.split('-').map(Number);
  if ([by, bm, bd, y, m, d].some((n) => !Number.isFinite(n))) return null;
  // 誕生日が来ていない月はまだ加算しない
  let months = (y - by) * 12 + (m - bm) - (d < bd ? 1 : 0);
  if (months < 0) return null;
  return { years: Math.floor(months / 12), months: months % 12 };
}

/** '9歳10か月' / '10歳'（ちょうどのとき）。不明なら空文字 */
export function ageText(birthday, dateKey = jstToday()) {
  const a = ageAt(birthday, dateKey);
  if (!a) return '';
  return a.months ? `${a.years}歳${a.months}か月` : `${a.years}歳`;
}

// =====================================================================
// 目標の階層
//   最終目標 → 中間目標 → 月の目標 → 行動目標 の4階層。
//   ★'week' は旧データ（アイドル版の週目標）が残っていても壊れないように
//     残してあるだけ。新規作成では使わない。
// =====================================================================
export const GOAL_LEVELS = {
  big:       { label: '最終目標', kid: '大きな目標',   child: 'milestone', rank: 0 },
  milestone: { label: '中間目標', kid: 'とちゅうの目標', child: 'month',   rank: 1 },
  month:     { label: '月の目標', kid: '今月の目標',   child: 'task',      rank: 2 },
  week:      { label: '週の目標', kid: '今週の目標',   child: 'task',      rank: 2 },
  task:      { label: '行動目標', kid: 'やること',     child: null,        rank: 3 },
};

/** 見た目（色の濃さ）に使う 0〜3。未知の level は行動目標あつかい */
export function levelRank(level) {
  return GOAL_LEVELS[level]?.rank ?? 3;
}

/** 表示名。mode='kid' のときは子ども向けの言い方にする */
export function levelLabel(level, mode = 'adult') {
  const def = GOAL_LEVELS[level];
  if (!def) return '';
  return mode === 'kid' ? def.kid : def.label;
}

// =====================================================================
// タイムライン（横軸＝時間のチャート）の目盛りと棒の位置
//   ★DOM を作らず「％」だけ返す。だからここでテストできる。
//     描画は components/timeline.js の仕事。
// =====================================================================

/**
 * 目標群を収める表示期間を決める。
 * 期日を持つ目標が1つも無ければ null（＝チャートを描かない）。
 * @param {{period_start?:string, period_end?:string}[]} goals
 */
export function timelineRange(goals, today = jstToday()) {
  const dates = [];
  for (const g of goals || []) {
    if (g.period_start) dates.push(g.period_start);
    if (g.period_end) dates.push(g.period_end);
  }
  if (!dates.length) return null;
  dates.sort();
  // 今日が範囲の外でも「いまここ」の線が出せるよう、今日を必ず含める
  const start = monthStart(dates[0] < today ? dates[0] : today);
  const end = monthEnd(dates[dates.length - 1] > today ? dates[dates.length - 1] : today);
  return { start, end, days: diffDays(end, start) + 1 };
}

/**
 * 期間を月の目盛りに割る。
 * @returns {{key:string, label:string, leftPct:number, widthPct:number}[]}
 */
export function monthTicks(range) {
  if (!range) return [];
  const out = [];
  let cur = monthStart(range.start);
  while (cur <= range.end) {
    const last = monthEnd(cur);
    const [y, m] = cur.split('-').map(Number);
    out.push({
      key: cur.slice(0, 7),
      label: m === 1 ? `${y}年1月` : `${m}月`,
      ...barSpan(cur, last < range.end ? last : range.end, range),
    });
    cur = addMonths(cur, 1);
  }
  return out;
}

/**
 * 棒の左端と幅を％で返す。範囲からはみ出す分は切り詰める。
 * 期日だけ／開始日だけの目標も描けるよう、片方が無ければもう片方で補う。
 * 収まらない（範囲外）なら null。
 */
export function barSpan(start, end, range) {
  if (!range) return null;
  const s0 = start || end;
  const e0 = end || start;
  if (!s0 || !e0) return null;
  const s = s0 < range.start ? range.start : s0;
  const e = e0 > range.end ? range.end : e0;
  if (s > range.end || e < range.start) return null;
  const left = diffDays(s, range.start);
  // 1日だけの目標が線にならないよう、最小1日ぶんの幅を持たせる
  const width = Math.max(1, diffDays(e, s) + 1);
  return {
    leftPct: (left / range.days) * 100,
    widthPct: (width / range.days) * 100,
  };
}

/** 「いまここ」の縦線の位置（％）。範囲外なら null */
export function todayPct(range, today = jstToday()) {
  if (!range || today < range.start || today > range.end) return null;
  return (diffDays(today, range.start) / range.days) * 100;
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
